"""Troncos vasculares de s0028 desde su propio TAC (TotalSegmentator v3, CC BY 4.0), como nodos (x, y, z, radio) en mm LAS del
simulador, en el sentido del flujo.

    python -I tools/anatomy/s0028-trunks.py <caso s0028> <salida.json> [carpeta del candidato P5 r1]

Aorta, tronco portal, ramas portales derecha e izquierda y vena esplénica: el eje es el camino más central de su máscara y el radio,
el inscrito (EDT) en ese eje; la máscara ya trae la identidad. Las puntas de la máscara son el fin de la segmentación, no del vaso.

Suprahepáticas (solo con el candidato P5 r1, decisión 323): ninguna máscara las separa. El eje sale de los dos esqueletos que ese
candidato conecta a la cava; el radio se mide aquí, en el corte perpendicular, como el área con HU por encima de la mitad entre el
eje y el parénquima. El HU dice dónde está la luz y cuánto mide, no cómo se ve. El nombre es E, por posición: el sistema que
desemboca en la cara derecha de la cava es la derecha; el que sale hacia delante por la línea media, la izquierda; y el esqueleto
sin raíz que nace junto a ella, la media, unida a la izquierda en un tronco común por un puente E.
"""
import heapq, json, os, sys
import numpy as np, nibabel as nib
from scipy import ndimage as ndi

case, out = sys.argv[1:3]
candidate = sys.argv[3] if len(sys.argv) > 3 else None
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

# Cava inferior hasta el diafragma (z ≤ 15 mm, donde empieza el tramo suprahepático del modelo): centroide de su máscara por corte y
# radio del tubo elíptico del modelo (eje anteroposterior 0,8) con la misma área que el corte. De caudal a craneal: sentido del flujo.
m = load('inferior_vena_cava'); ks = np.where(m.any(axis=(0, 1)))[0]
pts = ndi.gaussian_filter1d(np.array([to_las([*np.argwhere(m[:, :, k]).mean(0), k]) for k in ks]), 3, axis=0, mode='nearest')
tan = np.gradient(pts, axis=0); tan /= np.linalg.norm(tan, axis=1)[:, None]
rad = np.sqrt(np.array([m[:, :, k].sum() for k in ks]) * PITCH ** 2 * np.abs(tan[:, 2]) / (0.8 * np.pi))
order = np.argsort(pts[:, 2]); pts, rad = pts[order], ndi.gaussian_filter1d(rad[order], 3, mode='nearest')
keep = pts[:, 2] <= 15
segments['ivcInfra'] = (pts[keep], tip_radius(rad[keep], arc(pts[keep]), 12.0))


if candidate:
    import gzip, struct, collections
    manifest = json.load(open(os.path.join(candidate, 'manifest.json')))
    if manifest['person'] != 's0028' or manifest['frameId'] != meta['frameId']: raise SystemExit('Candidato de otra persona o marco')
    blob = gzip.open(os.path.join(candidate, 'vessels.gzip.bin')).read()
    if blob[:4] != b'VXV1': raise SystemExit('Formato de grafo desconocido')
    n_nodes, n_edges = struct.unpack('<II', blob[4:12])
    G = np.frombuffer(blob, dtype=np.dtype([('p', '<f4', 3), ('r', '<f4'), ('ijk', '<u2', 3), ('g', 'u1'), ('c', 'u1')]), count=n_nodes, offset=12)
    E = np.frombuffer(blob, dtype=np.dtype([('a', '<u4'), ('b', '<u4'), ('s', 'i1'), ('c', 'u1'), ('g', '<u2')]), count=n_edges, offset=12 + 24 * n_nodes)
    GP = G['p'].astype(float)
    ct = np.asarray(nib.load(os.path.join(case, 'ct.nii.gz')).dataobj).astype(np.float32)
    smooth = ndi.gaussian_filter(ct, 0.8)
    liver = load('liver'); ivc_mask = load('inferior_vena_cava')
    parenchyma = float(np.median(smooth[ndi.binary_erosion(liver, iterations=4)]))
    Ainv = np.linalg.inv(A)
    to_vox = lambda q: np.asarray(q, float) @ Ainv[:3, :3].T + Ainv[:3, 3]
    # Eje de la cava: centroide de su máscara por corte, para llevar cada desembocadura hasta la luz.
    ks = np.where(ivc_mask.any(axis=(0, 1)))[0]
    ivc_axis = ndi.gaussian_filter1d(np.array([to_las([*np.argwhere(ivc_mask[:, :, k]).mean(0), k]) for k in ks]), 3, axis=0, mode='nearest')
    ivc_distance = ndi.distance_transform_edt(~ivc_mask, sampling=PITCH)

    def tree(group, towards=None):
        lo, hi = group['nodeRange']
        adj = collections.defaultdict(list)
        for e in E:
            a, b = int(e['a']), int(e['b'])
            if lo <= a < hi and lo <= b < hi:
                w = float(np.linalg.norm(GP[a] - GP[b])); adj[a].append((b, w)); adj[b].append((a, w))
        ids = range(lo, hi)
        root = min(ids, key=lambda i: ivc_distance[tuple(np.rint(to_vox(GP[i])).astype(int))] if towards is None else np.linalg.norm(GP[i] - towards))
        dist = {root: 0.0}; prev = {root: None}; pq = [(0.0, root)]
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist[u]: continue
            for v, w in adj[u]:
                if d + w < dist.get(v, 1e18): dist[v] = d + w; prev[v] = u; heapq.heappush(pq, (d + w, v))
        leaves = sorted((i for i in ids if len(adj[i]) == 1 and i != root and i in dist), key=lambda i: -dist[i])
        def path(leaf):
            p = []
            while leaf is not None: p.append(leaf); leaf = prev[leaf]
            return p  # de la periferia a la raíz: sentido del flujo venoso
        return root, [path(l) for l in leaves]

    def lumen(ids):
        """Eje suavizado y radio medido: área del corte perpendicular con HU sobre la mitad entre el eje y el parénquima."""
        pts = ndi.gaussian_filter1d(GP[ids], 2, axis=0, mode='nearest')
        tan = np.gradient(pts, axis=0); tan /= np.linalg.norm(tan, axis=1)[:, None]
        g = np.arange(-12, 12.01, 0.75); c0 = len(g) // 2; rs = []
        for q, t in zip(pts, tan):
            u = np.cross(t, [0, 0, 1.0]); u = u / np.linalg.norm(u) if np.linalg.norm(u) > 1e-3 else np.array([1.0, 0, 0]); v = np.cross(t, u)
            X, Y = np.meshgrid(g, g)
            hu = ndi.map_coordinates(smooth, to_vox((q[None, None, :] + X[..., None] * u + Y[..., None] * v).reshape(-1, 3)).T, order=1).reshape(X.shape)
            centre = hu[c0 - 1:c0 + 2, c0 - 1:c0 + 2].max()
            lab, _ = ndi.label(hu > (centre + parenchyma) / 2)
            k = lab[c0 - 1:c0 + 2, c0 - 1:c0 + 2].max()
            rs.append(np.sqrt((lab == k).sum() * 0.75 ** 2 / np.pi) if k and centre > parenchyma + 6 else np.nan)
        rs = np.array(rs); ok = ~np.isnan(rs)
        if ok.sum() < 2: raise SystemExit('Vena sin contraste medible')
        rs = np.interp(np.arange(len(rs)), np.where(ok)[0], rs[ok])
        return pts, np.clip(ndi.gaussian_filter1d(ndi.median_filter(rs, 7, mode='nearest'), 3, mode='nearest'), 1.5, 6.0)

    def to_cava(pts, r):
        """Prolonga la desembocadura hasta el eje de la cava, con el radio de su último tramo."""
        end = ivc_axis[int(np.argmin(np.linalg.norm(ivc_axis - pts[-1], axis=1)))]
        return np.vstack([pts, end]), np.r_[r, r[-1]]

    def tail(path, trunk):
        """Tramo propio de una rama: desde su punta hasta el nodo donde se une al tronco, incluido."""
        on = set(trunk); k = next(i for i, n in enumerate(path) if n in on)
        return path[:k + 1]

    groups = {g['id']: g for g in manifest['groups'] if g['id'].startswith('hepatic-cava-')}
    trees = {gid: tree(g) for gid, g in groups.items()}
    # Derecha: el sistema cuya raíz queda a la derecha del paciente (x menor). El otro sale hacia delante por la línea media: la
    # izquierda. La media no llega a la cava en el candidato: es el esqueleto sin raíz, de 60 mm o más, que nace más cerca de la raíz
    # de la izquierda, con la que forma el tronco común; ese puente de unión es E.
    right_id, left_id = sorted(trees, key=lambda gid: GP[trees[gid][0]][0])[:2]
    _, right_paths = trees[right_id]; left_root, left_paths = trees[left_id]
    loose = [g for g in manifest['groups'] if g['id'].startswith('hepatic-unrooted-') and g['lengthMm'] >= 60]
    gap = lambda g: float(np.min(np.linalg.norm(GP[g['nodeRange'][0]:g['nodeRange'][1]] - GP[left_root], axis=1)))
    middle_group = min(loose, key=gap)
    if gap(middle_group) > 25: raise SystemExit('Ningún esqueleto sin raíz nace junto a la suprahepática izquierda')
    _, middle_paths = tree(middle_group, GP[left_root])
    trunk = min(right_paths, key=lambda p: GP[p[0]][2])  # la punta más caudal: el eje largo de la derecha
    branches = [tail(p, trunk) for p in right_paths if p is not trunk]
    branches = [b for b in branches if sum(np.linalg.norm(np.diff(GP[b], axis=0), axis=1)) >= 15]
    anterior = max(branches, key=lambda b: GP[b[0]][1]); posterior = min(branches, key=lambda b: GP[b[0]][1])
    left = left_paths[0]; middle = middle_paths[0]
    hv = {'hvRight': to_cava(*lumen(trunk)), 'hvRightAnterior': lumen(anterior), 'hvRightPosterior': lumen(posterior),
          'hvLeft': lumen(left), 'hvMiddle': lumen(middle)}
    tributaries = [tail(p, middle) for p in middle_paths[1:]]
    tributaries = [t for t in tributaries if sum(np.linalg.norm(np.diff(GP[t], axis=0), axis=1)) >= 15]
    if tributaries: hv['hvMiddleTributary'] = lumen(max(tributaries, key=len))
    # Cada rama termina en el eje ya suavizado de su tronco; la media, en la raíz de la izquierda; de ahí el tronco común llega a la
    # luz de la cava. La izquierda no tiene en este TAC una tributaria de 15 mm o más: la suya sigue estimada, arrastrada a su tronco.
    for child, parent in (('hvRightAnterior', 'hvRight'), ('hvRightPosterior', 'hvRight'), ('hvMiddleTributary', 'hvMiddle')):
        if child not in hv: continue
        cp, cr = hv[child]; pp = hv[parent][0]
        cp[-1] = pp[int(np.argmin(np.linalg.norm(pp - cp[-1], axis=1)))]
    lp, lr = hv['hvLeft']; mp, mr = hv['hvMiddle']
    hv['hvMiddle'] = (np.vstack([mp, lp[-1]]), np.r_[mr, mr[-1]])
    hv['hvCommonTrunk'] = to_cava(lp[-1:], np.maximum(lr[-1:], mr[-1:]))
    segments.update(hv)
    report['hepaticVeins'] = {'right': right_id, 'left': left_id, 'middle': middle_group['id'], 'bridgeMm': round(gap(middle_group), 1), 'parenchymaHU': round(parenchyma, 1), 'candidateSha256': manifest.get('parametersSha256')}
    # Testigos: vóxeles realzados del hígado (HU ≥ parénquima + 23) fuera de toda componente que toque la porta, a 4 mm o menos del
    # esqueleto que el candidato conecta a la cava. No dependen del ajuste de nodos ni del radio medido aquí.
    enhanced = (smooth >= parenchyma + 23) & liver
    lab, _ = ndi.label(enhanced, np.ones((3, 3, 3)))
    portal_touch = np.unique(lab[ndi.binary_dilation(load('portal_vein_and_splenic_vein'), iterations=2)])
    veins = enhanced & ~np.isin(lab, portal_touch[portal_touch > 0])
    skeleton = np.vstack([GP[g['nodeRange'][0]:g['nodeRange'][1]] for g in (groups[right_id], groups[left_id], middle_group)])
    cand = np.argwhere(veins); pos = to_las(cand)
    near = np.array([np.min(np.linalg.norm(skeleton - q, axis=1)) <= 4 for q in pos])
    pos = pos[near]
    witnesses['hepatic'] = np.round(pos[:: max(1, len(pos) // 200)], 2).tolist()

for name, (p, r) in segments.items():
    nodes, err = fit(np.asarray(p), np.asarray(r))
    result[name] = nodes
    report[name] = {'lengthMm': round(float(arc(np.asarray(p))[-1]), 1), 'nodes': len(nodes), 'fitErrorMm': round(err, 2), 'radiusMedianMm': round(float(np.median(r)), 2)}
json.dump({'format': 's0028-trunks-v1', 'person': 's0028', 'frame': meta['frameId'], 'vessels': result, 'report': report, 'witnesses': witnesses}, open(out, 'w'), indent=1)
print('testigos', {k: len(v) for k, v in witnesses.items()})
print(json.dumps(report, indent=1, ensure_ascii=False))
for k, v in result.items(): print(k, v)
