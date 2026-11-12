"""Troncos vasculares de s0028 desde sus propias máscaras (TotalSegmentator v3, CC BY 4.0): aorta, tronco portal, ramas portales
derecha e izquierda y vena esplénica, como nodos (x, y, z, radio) en mm LAS del simulador, en el sentido del flujo.

    python -I tools/anatomy/s0028-trunks.py <caso s0028> <salida.json>

El eje es el camino más central de la máscara; el radio, el inscrito (EDT) en ese eje. No nombra ramas que la máscara no separa, no
usa HU y no decide identidad: la máscara ya la trae. Las puntas de la máscara son el fin de la segmentación, no el del vaso.
"""
import heapq, json, os, sys
import numpy as np, nibabel as nib
from scipy import ndimage as ndi

case, out = sys.argv[1:3]
here = os.path.dirname(os.path.abspath(__file__))
meta = json.load(open(os.path.join(here, 's0028-case.json')))
A = np.array(meta['rasToLASmm']) @ np.array(meta['affineRASmm'])
PITCH = float(meta['pitchMm'])
MAX_NODES = 9  # MAX_TUBE_SEGMENTS + 1
to_las = lambda ijk: np.asarray(ijk, float) @ A[:3, :3].T + A[:3, 3]
OFF = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1) if (a, b, c) != (0, 0, 0)]


def load(name):
    return np.asarray(nib.load(os.path.join(case, 'segmentations', name + '.nii.gz')).dataobj) > 0


def largest(m):
    lab, n = ndi.label(m, np.ones((3, 3, 3)))
    return lab == int(np.argmax(ndi.sum(m, lab, range(1, n + 1)))) + 1


class Graph:
    """Vóxeles de una máscara conexa; caminos geodésicos y caminos centrales (coste alto junto al borde)."""

    def __init__(self, m):
        self.edt = ndi.distance_transform_edt(m, sampling=PITCH)
        self.idx = np.argwhere(m)
        self.key = {tuple(v): i for i, v in enumerate(self.idx)}

    def spread(self, sources, central):
        dist = np.full(len(self.idx), np.inf); prev = np.full(len(self.idx), -1)
        pq = [(0.0, int(s)) for s in sources]
        for _, s in pq: dist[s] = 0
        heapq.heapify(pq)
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist[u]: continue
            p = self.idx[u]
            for o in OFF:
                v = self.key.get((p[0] + o[0], p[1] + o[1], p[2] + o[2]))
                if v is None: continue
                w = PITCH * float(np.linalg.norm(o))
                if central: w *= 1 + 4.0 / self.edt[tuple(self.idx[v])]
                if d + w < dist[v]:
                    dist[v] = d + w; prev[v] = u; heapq.heappush(pq, (d + w, v))
        return dist, prev

    def path(self, prev, t):
        p = []
        while t != -1: p.append(t); t = int(prev[t])
        return p[::-1]

    def line(self, p):
        pts = ndi.gaussian_filter1d(to_las(self.idx[p]), 2, axis=0, mode='nearest')
        r = ndi.gaussian_filter1d(self.edt[tuple(self.idx[p].T)], 2, mode='nearest')
        return pts, r


def arc(pts):
    return np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]


def fit(pts, r, max_nodes=MAX_NODES):
    """Nodos de una poligonal que sigue el eje: se añade cada vez el punto que más se aparta, hasta `max_nodes`."""
    keep = [0, len(pts) - 1]
    def worst():
        best = (0.0, -1)
        for a, b in zip(keep[:-1], keep[1:]):
            ab = pts[b] - pts[a]; L = float(ab @ ab)
            for i in range(a + 1, b):
                t = np.clip((pts[i] - pts[a]) @ ab / L, 0, 1) if L else 0
                d = float(np.linalg.norm(pts[i] - (pts[a] + t * ab)))
                if d > best[0]: best = (d, i)
        return best
    while len(keep) < max_nodes:
        d, i = worst()
        if d < 0.5: break
        keep = sorted(keep + [i])
    return [[*np.round(pts[i], 1).tolist(), round(float(r[i]), 1)] for i in keep], worst()[0]


def tip_radius(r, s, margin=6.0):
    """El radio inscrito cae a cero en la punta de la máscara: se sostiene el que había `margin` mm antes."""
    r = r.copy()
    head = s < margin; tail = s > s[-1] - margin
    if head.any() and (~head).any(): r[head] = r[np.argmax(~head)]
    if tail.any() and (~tail).any(): r[tail] = r[len(r) - 1 - np.argmax(~tail[::-1])]
    return r


result, report = {}, {}

# Porta y esplénica: una máscara conjunta. Camino principal entre los dos extremos geodésicos (rama derecha ↔ hilio esplénico) y
# rama lateral más larga (rama izquierda). La confluencia es la mayor caída de radio del camino principal aguas arriba de la bifurcación.
g = Graph(largest(load('portal_vein_and_splenic_vein')))
d0, _ = g.spread([0], False); a = int(np.argmax(d0)); da, _ = g.spread([a], False); b = int(np.argmax(da))
if to_las(g.idx[a])[0] > to_las(g.idx[b])[0]: a, b = b, a  # a: extremo hepático (derecha del paciente, x menor)
_, prev = g.spread([a], True)
main = g.path(prev, b)
dm, _ = g.spread(main, False)
third = g.path(prev, int(np.argmax(dm)))
shared = 0
while shared < min(len(main), len(third)) and main[shared] == third[shared]: shared += 1
m_pts, m_r = g.line(main); s = arc(m_pts)
drop = np.gradient(ndi.gaussian_filter1d(m_r, 3, mode='nearest'), s)
window = (s > s[shared - 1] + 25) & (s < s[shared - 1] + 90)
conf = int(np.argmin(np.where(window, drop, np.inf)))
l_pts, l_r = g.line(third[shared - 1:])
l_pts[0] = m_pts[shared - 1]  # la rama izquierda nace en la bifurcación del camino principal
segments = {
    'portalSplenic': (m_pts[conf:][::-1], tip_radius(m_r[conf:], arc(m_pts[conf:]))[::-1]),
    'pvTrunk': (m_pts[shared - 1:conf + 1][::-1], m_r[shared - 1:conf + 1][::-1]),
    'pvRight': (m_pts[:shared][::-1], tip_radius(m_r[:shared], arc(m_pts[:shared]))[::-1]),
    'pvLeft': (l_pts, tip_radius(l_r, arc(l_pts))),
}
# Testigos independientes del eje: vóxeles de la máscara a 2,2 mm o más de su borde, uno de cada tantos en orden de índice.
deep = g.idx[g.edt[tuple(g.idx.T)] >= 2.2]
witnesses = {'portal': np.round(to_las(deep[:: max(1, len(deep) // 150)]), 2).tolist()}
report['portal'] = {'bifurcation': np.round(m_pts[shared - 1], 1).tolist(), 'confluence': np.round(m_pts[conf], 1).tolist(), 'voxels': int(len(g.idx))}

# Aorta: descendente torácica y abdominal. Por corte, la componente que continúa la del corte inferior (deja fuera el cayado y la ascendente).
m = load('aorta'); rows = []; last = None
for k in np.where(m.any(axis=(0, 1)))[0]:
    sl, c = ndi.label(m[:, :, k])
    cents = [np.argwhere(sl == i + 1).mean(0) for i in range(c)]
    pick = int(np.argmax(ndi.sum(m[:, :, k], sl, range(1, c + 1)))) if last is None else int(np.argmin([np.linalg.norm(x - last) for x in cents]))
    if last is not None and np.linalg.norm(cents[pick] - last) > 4: break
    last = cents[pick]; rows.append((k, cents[pick], int((sl == pick + 1).sum())))
edt = ndi.distance_transform_edt(m, sampling=PITCH); deep = []
for k, c, _ in rows:
    sl, _ = ndi.label(m[:, :, k]); own = sl == sl[tuple(np.rint(c).astype(int))]
    deep += [[i, j, k] for i, j in np.argwhere(own & (edt[:, :, k] >= 3.0))]
witnesses['aorta'] = np.round(to_las(np.array(deep)[:: max(1, len(deep) // 150)]), 2).tolist()
pts = ndi.gaussian_filter1d(np.array([to_las([c[0], c[1], k]) for k, c, _ in rows]), 3, axis=0, mode='nearest')
tan = np.gradient(pts, axis=0); tan /= np.linalg.norm(tan, axis=1)[:, None]
rad = ndi.gaussian_filter1d(np.sqrt(np.array([n for _, _, n in rows]) * PITCH ** 2 * np.abs(tan[:, 2]) / np.pi), 3, mode='nearest')
order = np.argsort(-pts[:, 2])  # craneal → caudal: sentido del flujo
segments['aorta'] = (pts[order], rad[order])

for name, (p, r) in segments.items():
    nodes, err = fit(np.asarray(p), np.asarray(r))
    result[name] = nodes
    report[name] = {'lengthMm': round(float(arc(np.asarray(p))[-1]), 1), 'nodes': len(nodes), 'fitErrorMm': round(err, 2), 'radiusMedianMm': round(float(np.median(r)), 2)}
json.dump({'format': 's0028-trunks-v1', 'person': 's0028', 'frame': meta['frameId'], 'vessels': result, 'report': report, 'witnesses': witnesses}, open(out, 'w'), indent=1)
print('testigos', {k: len(v) for k, v in witnesses.items()})
print(json.dumps(report, indent=1, ensure_ascii=False))
for k, v in result.items(): print(k, v)
