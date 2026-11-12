"""Reconstruct the resampled tetrahedra with scalar half-cell node averages."""
import hashlib
import json
import math
from pathlib import Path

import numpy as np

here = Path(__file__).resolve().parent
maqueta = here.parent.parent
inputs = here/'datos-120'
source = maqueta/'fuentes/anatomical-maquette-103/FIELDS103G.npz'
data = np.load(source)
original = json.loads((inputs/'SURFACE-POINTS.json').read_text())
edges = json.loads((inputs/'EDGES.json').read_text())
metadata = json.loads((maqueta/'metadatos-103.json').read_text())
result = json.loads((here/'120-RESULT.json').read_text())
gpu = json.loads((here/'112-SURFACE-GPU.json').read_text())
assert hashlib.sha256(source.read_bytes()).hexdigest() == result['sourceSha256']
assert hashlib.sha256((inputs/'SURFACE-POINTS.json').read_bytes()).hexdigest() == gpu['inputSha256']
assert hashlib.sha256((inputs/'SURFACE-REFERENCE.bin').read_bytes()).hexdigest() == gpu['referenceSha256']
pred_bytes = (inputs/'PREDICTED.bin').read_bytes()
assert hashlib.sha256(pred_bytes).hexdigest() == result['predictedSha256']
predicted = np.frombuffer(pred_bytes,dtype='<f8')
reference = np.frombuffer((inputs/'SURFACE-REFERENCE.bin').read_bytes(),dtype='<f4')
assert len(predicted)==len(reference)==27770 and len(edges)==5554
anchor = metadata['origin']

def query(field, source_origin, point, shifted=False):
    u = [(point[k]-anchor[k])/1.5 for k in range(3)]
    base = [math.floor(v) for v in u]
    fraction = [u[k]-base[k] for k in range(3)]
    order = sorted(range(3),key=lambda k:-fraction[k])
    q = [fraction[k] for k in order]
    weights = [1-q[0],q[0]-q[1],q[1]-q[2],q[2]]
    corner = base.copy()
    values = []
    for v in range(4):
        p = [anchor[k]+1.5*corner[k] for k in range(3)]
        r = [(p[k]-source_origin[k])/1.5 for k in range(3)]
        j = [math.floor(v) for v in r]
        assert all(abs((r[k]-j[k])-.5)<1e-10 for k in range(3))
        if shifted: j[0] += 1
        assert all(1 <= j[k] < field.shape[::-1][k]-2 for k in range(3))
        total = 0.
        for dz in range(2):
            for dy in range(2):
                for dx in range(2): total += float(field[j[2]+dz,j[1]+dy,j[0]+dx])
        values.append(total/8.)
        if v<3: corner[order[v]] += 1
    return sum(v*w for v,w in zip(values,weights))

cursor=0
checks=0
max_error=0.
negative_changes=0
for name,field_key,origin_key,point_key in [('ql','qlNew','qlOrigin','qlPoints'),('rib12','rib12New','rib12Origin','ribPoints')]:
    field=data[field_key]
    source_origin=data[origin_key].tolist()
    pts=original[point_key]
    field_edges=[e for e in edges if e['field']==name]
    labels=[]
    for axis in [2,1,0]:
        n=sum(e['axis']==axis for e in field_edges)
        for off in original['offsetsMm']: labels += [off]*n
    changes={str(off):0 for off in original['offsetsMm']}
    for i,p0 in enumerate(pts):
        p=np.asarray(p0,dtype=np.float32).astype(float).tolist()
        answer=query(field,source_origin,p)
        max_error=max(max_error,abs(answer-predicted[cursor+i]))
        assert abs(answer-predicted[cursor+i])<1e-11
        if (answer<=0)!=(reference[cursor+i]<=0): changes[str(labels[i])]+=1
        if i<256 and abs(query(field,source_origin,p,True)-answer)>1e-8: negative_changes+=1
        checks+=1
    assert changes==result['fields'][name]['signChangesByOffset']
    cursor+=len(pts)
assert checks==27770 and negative_changes>0
assert result['changesAt001Mm']==sum(result['fields'][name]['signChangesByOffset'][off]
                                      for name in ('ql','rib12') for off in ('-0.01','0.01'))
verified={'passed':True,'samples':checks,'maxArithmeticDifference':max_error,
          'negativeShiftedNodeChanges':negative_changes,'changesAt001Mm':result['changesAt001Mm'],
          'geometricGatePassed':result['geometricGatePassed'],
          'scope':'Reconstruye valores y conteos; no verifica raíces por bisección ni representa un oráculo anatómico.'}
print(json.dumps(verified,indent=2,ensure_ascii=False))
