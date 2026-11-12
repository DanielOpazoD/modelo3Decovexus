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
from scipy.optimize import least_squares

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


def project(nodes, P):
    """Proyección de los puntos P sobre la poligonal: (distancia, tramo, parámetro en el tramo)."""
    a, b = nodes[:-1], nodes[1:]
    ab = b - a; L = np.maximum((ab * ab).sum(1), 1e-9)
    t = np.clip(((P[:, None, :] - a[None]) * ab[None]).sum(2) / L[None], 0, 1)
    d = np.linalg.norm(P[:, None, :] - (a[None] + t[..., None] * ab[None]), axis=2)
    k = d.argmin(1); i = np.arange(len(P))
    return d[i, k], k, t[i, k]


def turn(nodes):
    """Mayor ángulo (grados) entre dos tramos consecutivos de la poligonal."""
    d = np.diff(nodes, axis=0); d /= np.linalg.norm(d, axis=1)[:, None]
    return float(np.degrees(np.arccos(np.clip((d[:-1] * d[1:]).sum(1), -1, 1))).max()) if len(d) > 1 else 0.0


def turns(nodes):
    """Giro en cada nodo interior como diferencia de las direcciones de sus dos tramos (norma 2·sin(θ/2), suave en θ = 0)."""
    d = np.diff(nodes, axis=0); d = d / np.maximum(np.linalg.norm(d, axis=1), 1e-9)[:, None]
    return (d[1:] - d[:-1]).ravel()


def fit(pts, r, max_nodes=MAX_NODES, sigma=5.0, tol=0.6, reach=1.5):
    """Poligonal de ≤ `max_nodes` nodos que sigue el eje sin quebrarse en los nodos. El eje se suaviza por longitud de arco (σ mm,
    con los extremos fijos: son uniones con otros tramos) y los nodos interiores se colocan por mínimos cuadrados de la distancia
    del eje a la poligonal más el giro en cada nodo: el peso del giro sube mientras la poligonal siga a menos de `reach` mm del
    eje suavizado, de modo que la curvatura se reparte entre todos los nodos; antes caían en los puntos más salientes (esquinas a
    la vista). Un tramo corto y casi recto usa menos nodos. Los radios, por mínimos cuadrados sobre la misma proyección.
    Devuelve (nodos, mayor desvío respecto del eje medido en mm, mayor giro en grados)."""
    pts, r = np.asarray(pts, float), np.asarray(r, float)
    s = arc(pts); L = float(s[-1]); n = max(8, int(np.ceil(L / 0.5)) + 1)
    u = np.linspace(0, L, n); step = L / (n - 1)
    P = np.stack([np.interp(u, s, pts[:, k]) for k in range(3)], 1); R = np.interp(u, s, r)
    sg = min(sigma, L / 6)
    Q = ndi.gaussian_filter1d(P, sg / step, axis=0, mode='nearest'); R = ndi.gaussian_filter1d(R, sg / step, mode='nearest')
    # Extremos fijos: dos correcciones que decaen en 2σ, resueltas a la vez para que un tramo corto también cierre.
    w0, w1 = np.exp(-u / (2 * sg)), np.exp(-(L - u) / (2 * sg))
    c = np.linalg.solve(np.array([[w0[0], w1[0]], [w0[-1], w1[-1]]]), np.stack([P[0] - Q[0], P[-1] - Q[-1]]))
    Q = Q + np.outer(w0, c[0]) + np.outer(w1, c[1])
    D = Q[:: max(1, int(round(1.0 / step)))]
    whole = lambda x: np.vstack([Q[0], x.reshape(-1, 3), Q[-1]])
    best = None
    for k in sorted({2, 3, 4, max_nodes} if L < 40 else {max_nodes}):
        nodes = np.stack([np.interp(np.linspace(0, L, k), u, Q[:, j]) for j in range(3)], 1)
        if k > 2:
            x = nodes[1:-1].ravel()
            # Tramos de longitud pareja (peso pequeño): sin esto dos nodos pueden juntarse y dejar un tramo degenerado.
            even = lambda q: 0.3 * (np.linalg.norm(np.diff(q, axis=0), axis=1) * (k - 1) / L - 1)
            for weight in (0.0, 2.0, 5.0, 10.0, 20.0, 40.0):
                y = least_squares(lambda v: np.r_[project(whole(v), D)[0], weight * turns(whole(v)), even(whole(v))], x, max_nfev=60).x
                if weight and max(project(whole(y), Q)[0].max(), project(whole(y), P)[0].max() - 0.3) > reach: break
                x = y
            nodes = whole(x)
        best = nodes
        if project(nodes, Q)[0].max() <= tol and turn(nodes) <= 6: break
    nodes = best
    _, seg, t = project(nodes, Q)
    H = np.zeros((len(Q), len(nodes))); i = np.arange(len(Q))
    H[i, seg] = 1 - t; H[i, seg + 1] += t
    rad = np.clip(np.linalg.lstsq(H, R, rcond=None)[0], R.min(), R.max())
    out = [[*np.round(q, 1).tolist(), round(float(x), 1)] for q, x in zip(nodes, rad)]
    out[0][:3] = np.round(pts[0], 1).tolist(); out[-1][:3] = np.round(pts[-1], 1).tolist()
    final = np.array([q[:3] for q in out])
    return out, float(project(final, P)[0].max()), turn(final)


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
    # Ramas portales de 2.º orden (decisión 357): los esqueletos `hepatic-portal-*` del candidato son las ramas de esta persona.
    # Cada grupo nace del punto de su esqueleto más cercano al eje de un tronco de la máscara; su rama principal es el camino a la
    # hoja que mejor representa su territorio y las demás hojas dan ramas propias desde donde se separan. Sentido del flujo portal:
    # del tronco a la periferia. El puente recto del tronco al esqueleto (2–19 mm) es E.
    portal_axes = {k: np.asarray(segments[k][0], float) for k in ('pvRight', 'pvLeft')}
    def to_portal(q):
        best = (1e9, None, None)
        for k, a in portal_axes.items():
            for i in range(len(a) - 1):
                ab = a[i + 1] - a[i]; t = np.clip((q - a[i]) @ ab / max(ab @ ab, 1e-9), 0, 1); x = a[i] + t * ab; d = float(np.linalg.norm(q - x))
                if d < best[0]: best = (d, k, x)
        return best
    def branch(ids):
        """Eje y radio medido de una rama, de su origen a su punta; sin realce medible, 1,5 mm."""
        try: pts, r = lumen(ids)
        except SystemExit: pts, r = ndi.gaussian_filter1d(GP[ids], 2, axis=0, mode='nearest'), np.full(len(ids), 1.5)
        # Una rama portal no se ensancha hacia la periferia: el radio medido no vuelve a subir.
        return pts, np.minimum.accumulate(np.minimum(r, 4.5))
    portal_groups = [g for g in manifest['groups'] if g['id'].startswith('hepatic-portal-')]
    # Territorio de cada rama con nombre: grupo (por su raíz) y hoja preferida (puntuación sobre la posición de la punta, mm LAS).
    wanted = {
        'pvRightAnterior': ('pvRight', lambda q, f: f > 0.6, lambda q: q[1] + q[2]),      # sale del final de la derecha, hacia delante y arriba
        'pvRightPosterior': ('pvRight', lambda q, f: f <= 0.6, lambda q: -q[1] - 0.5 * q[0] - abs(q[2] + 60) * 0.5),  # sale pronto, hacia atrás y a la derecha
        'pvLeftLateral': ('pvLeft', lambda q, f: True, lambda q: q[0]),                    # hacia la izquierda del paciente
        'pvLeftMedial': ('pvLeft', lambda q, f: True, lambda q: -q[0] + q[2]),             # segmento IV: hacia la derecha y arriba
    }
    rooted = []
    for g in portal_groups:
        lo, hi = g['nodeRange']
        root0 = min(range(lo, hi), key=lambda i: to_portal(GP[i])[0])
        d, trunk_id, at = to_portal(GP[root0])
        a = portal_axes[trunk_id]; L = arc(a); k = int(np.argmin(np.linalg.norm(a - at, axis=1)))
        root, paths = tree(g, GP[root0])
        paths = [p[::-1] for p in paths]  # de la raíz a la hoja
        rooted.append({'g': g, 'trunk': trunk_id, 'fraction': float(L[k] / L[-1]), 'at': at, 'bridge': d, 'paths': paths})
    named, extra, used_groups = {}, [], {}
    for name, (trunk_id, where, score) in wanted.items():
        cands = [(score(GP[p[-1]]) + 0.2 * sum(np.linalg.norm(np.diff(GP[p], axis=0), axis=1)), n, j) for n, t in enumerate(rooted) if t['trunk'] == trunk_id and where(t['at'], t['fraction']) and n not in used_groups.values()
                 for j, p in enumerate(t['paths']) if sum(np.linalg.norm(np.diff(GP[p], axis=0), axis=1)) >= 45]
        if not cands: raise SystemExit('Sin esqueleto portal para ' + name)
        _, n, j = max(cands); used_groups[name] = n
        t = rooted[n]; pts, r = branch(t['paths'][j])
        named[name] = (np.vstack([t['at'], pts]), np.r_[r[0], r])
        t['main'] = j
    # Ramas propias: las demás hojas de cada grupo, desde donde dejan a las ya tomadas; las de grupos sin nombre, desde su tronco.
    owner_of = {n: name for name, n in used_groups.items()}
    for n, t in enumerate(rooted):
        mother = owner_of.get(n) or ('pvRightPosterior' if t['trunk'] == 'pvRight' else 'pvLeftLateral' if t['at'][0] > -25 or t['fraction'] > 0.85 else 'pvLeftMedial')
        taken = set(t['paths'][t['main']]) if 'main' in t else set()
        order = sorted(range(len(t['paths'])), key=lambda j: -len(t['paths'][j]))
        for j in order:
            if j == t.get('main'): continue
            p = t['paths'][j]
            k = max((i for i, node in enumerate(p) if node in taken), default=-1)
            tail_ids = p[max(k, 0):]
            if sum(np.linalg.norm(np.diff(GP[tail_ids], axis=0), axis=1)) < 25: continue
            pts, r = branch(tail_ids)
            if k < 0: pts, r = np.vstack([t['at'], pts]), np.r_[r[0], r]
            extra.append((mother, pts, np.minimum(r, 3.0)))
            taken |= set(p)
    segments.update(named)
    report['portalBranches'] = {name: {'group': rooted[n]['g']['id'], 'bridgeMm': round(rooted[n]['bridge'], 1)} for name, n in used_groups.items()}
    extras_out = []
    for mother, pts, r in extra:
        nodes, err, bend = fit(pts, r, max_nodes=5)
        extras_out.append([mother, [[round(v, 0 if i < 3 else 1) for i, v in enumerate(q)] for q in nodes]])
    report['portalExtra'] = len(extras_out)
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
    nodes, err, bend = fit(np.asarray(p), np.asarray(r))
    result[name] = nodes
    report[name] = {'lengthMm': round(float(arc(np.asarray(p))[-1]), 1), 'nodes': len(nodes), 'fitErrorMm': round(err, 2), 'maxTurnDeg': round(bend, 1), 'radiusMedianMm': round(float(np.median(r)), 2)}
json.dump({'format': 's0028-trunks-v1', 'person': 's0028', 'frame': meta['frameId'], 'vessels': result, 'portalBranches': extras_out if candidate else [], 'report': report, 'witnesses': witnesses}, open(out, 'w'), indent=1)
print('testigos', {k: len(v) for k, v in witnesses.items()})
print(json.dumps(report, indent=1, ensure_ascii=False))
for k, v in result.items(): print(k, v)
