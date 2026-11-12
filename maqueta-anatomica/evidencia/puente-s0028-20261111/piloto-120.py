import hashlib
import json
from pathlib import Path

import numpy as np

here = Path(__file__).resolve().parent
maqueta = here.parent.parent
inputs = here / 'datos-120'
source = maqueta / 'fuentes/anatomical-maquette-103/FIELDS103G.npz'
fields = np.load(source)
metadata = json.loads((maqueta / 'metadatos-103.json').read_text())
reference = np.frombuffer((inputs / 'SURFACE-REFERENCE.bin').read_bytes(), dtype='<f4')
points = json.loads((inputs / 'SURFACE-POINTS.json').read_text())
edges = json.loads((inputs / 'EDGES.json').read_text())
label_origin = np.asarray(metadata['origin'], dtype=np.float64)
assert metadata['pitch'] == 1.5 and len(edges) == 5554 and len(reference) == 27770

def trilinear(field, origin, p):
    dims = np.asarray(field.shape[::-1])
    u = (p - origin) / 1.5
    cell = np.floor(u).astype(np.int64)
    f = u - cell
    valid = ((cell >= 1) & (cell < dims - 2)).all(axis=1)
    cell = np.minimum(np.maximum(cell, 0), dims - 2)
    x, y, z = cell.T
    out = np.zeros(len(p))
    for dz in range(2):
        for dy in range(2):
            for dx in range(2):
                weight = (f[:,0] if dx else 1-f[:,0]) * (f[:,1] if dy else 1-f[:,1]) * (f[:,2] if dz else 1-f[:,2])
                out += field[z+dz,y+dy,x+dx] * weight
    out[~valid] = np.nan
    return out

def tetra(field, origin, p):
    u = (p - label_origin) / 1.5
    cell = np.floor(u).astype(np.int64)
    f = u - cell
    order = np.argsort(-f, axis=1, kind='stable')
    sorted_f = np.take_along_axis(f, order, axis=1)
    weights = np.column_stack((1-sorted_f[:,0], sorted_f[:,0]-sorted_f[:,1],
                               sorted_f[:,1]-sorted_f[:,2], sorted_f[:,2]))
    corner = cell.copy()
    values = []
    for k in range(4):
        values.append(trilinear(field, origin, label_origin + 1.5 * corner))
        if k < 3:
            corner[np.arange(len(p)), order[:,k]] += 1
    values = np.column_stack(values)
    return np.sum(values * weights, axis=1)

out = {'scope': 'Sondeo de superficies del mismo campo; no simula atlas completo, GPU ni fidelidad clínica.',
       'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
       'labelOrigin': label_origin.tolist(), 'pitchMm': 1.5, 'fields': {}}
offsets = points['offsetsMm']
cursor = 0
predicted = []
all_unresolved = 0
all_changes = 0
max_displacement = 0.0
for name, key, origin_key, point_key in [('ql','qlNew','qlOrigin','qlPoints'),('rib12','rib12New','rib12Origin','ribPoints')]:
    field = fields[key].astype(np.float64)
    origin = fields[origin_key].astype(np.float64)
    sample = np.asarray(points[point_key], dtype=np.float32).astype(np.float64)
    value = tetra(field, origin, sample)
    predicted.append(value.astype('<f8'))
    ref = reference[cursor:cursor+len(sample)]
    cursor += len(sample)
    selected_edges = [edge for edge in edges if edge['field'] == name]
    assert len(sample) == 5 * len(selected_edges)
    # La selección está agrupada por eje y desplazamiento, no por arista.
    offset_labels = []
    for axis in [2, 1, 0]:
        count = sum(edge['axis'] == axis for edge in selected_edges)
        for off in offsets:
            offset_labels.extend([off] * count)
    offset_labels = np.asarray(offset_labels)
    assert len(offset_labels) == len(sample)
    changed = {}
    invalid = {}
    for off in offsets:
        mask = offset_labels == off
        finite = np.isfinite(value[mask])
        invalid[str(off)] = int(np.count_nonzero(~finite))
        changed[str(off)] = int(np.count_nonzero(((value[mask] <= 0) != (ref[mask] <= 0)) & finite))
    all_changes += changed['-0.01'] + changed['0.01']
    roots = np.asarray([edge['rootMm'] for edge in selected_edges], dtype=np.float64)
    axis = np.asarray([edge['axis'] for edge in selected_edges], dtype=np.int64)
    row = np.arange(len(roots))
    def at(delta):
        p = roots.copy()
        p[row,axis] += delta
        return tetra(field, origin, p)
    low = np.full(len(roots),-.125)
    high = np.full(len(roots),.125)
    lv, hv = at(low), at(high)
    valid = np.isfinite(lv) & np.isfinite(hv) & ((lv <= 0) != (hv <= 0))
    all_unresolved += int(np.count_nonzero(~valid))
    for _ in range(24):
        mid = (low + high) / 2
        mv = at(mid)
        finite = np.isfinite(mv)
        valid &= finite
        same = (mv <= 0) == (lv <= 0)
        low = np.where(valid & same, mid, low)
        high = np.where(valid & ~same, mid, high)
    displacement = np.maximum(np.abs(low[valid]),np.abs(high[valid]))
    maximum = float(np.max(displacement)) if len(displacement) else None
    if maximum is not None:
        max_displacement = max(max_displacement, maximum)
    out['fields'][name] = {'samples':len(sample), 'invalidSamplesByOffset':invalid,
                           'signChangesByOffset':changed, 'edges':len(roots),
                           'unresolvedEdges':int(np.count_nonzero(~valid)),
                           'maxResolvedDisplacementUpperMm':maximum,
                           'labelNodeShiftInOriginalVoxels':((label_origin-origin)/1.5 % 1).tolist()}
assert cursor == len(reference)
raw_predictions = np.concatenate(predicted).astype('<f8').tobytes()
invalid_total = sum(sum(v['invalidSamplesByOffset'].values()) for v in out['fields'].values())
out.update({'samples':cursor,'edges':len(edges),'unresolvedEdges':all_unresolved,
            'changesAt001Mm':all_changes,'invalidSamples':invalid_total,
            'predictedSha256':hashlib.sha256(raw_predictions).hexdigest(),
            'maxResolvedDisplacementUpperMm':max_displacement,
            'geometricGatePassed':all_changes==0 and all_unresolved==0 and invalid_total==0 and max_displacement<=.05})
print(json.dumps(out,indent=2,ensure_ascii=False))
