"""Lista de relaciones de `docs/anatomia/relaciones-tac.md` medida en la persona s0028 y en las máscaras de su propio TAC.

    python -I tools/anatomy/s0028-relations.py <rejilla> <caso TAC> <salida>

`<rejilla>` es la carpeta que escribe `s0028-relations-grid.ts`; `<caso TAC>`, la carpeta de TotalSegmentator con `ct.nii.gz` y
`segmentations/`. Cada relación se mide con la misma función sobre la máscara del modelo y sobre la del TAC, en los mismos vóxeles
(sin remuestreo: la rejilla del modelo son los vóxeles del TAC). Escribe `relaciones.json`, `relaciones.md` y tres láminas.
Las máscaras son de TotalSegmentator v3 (CC BY 4.0); no es validación clínica.
"""
import gzip
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use('Agg')
import matplotlib.patches
import matplotlib.pyplot as plt
import nibabel as nib
import numpy as np
from matplotlib.colors import ListedColormap
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull

GRID, CASE, OUT = (Path(p) for p in sys.argv[1:4])
OUT.mkdir(parents=True, exist_ok=True)
P = 1.5
VOX_ML = P**3 / 1000
g = json.load(open(GRID / 'model-grid.json'))
lo = np.array(g['voxelLo'])
dim = np.array(g['dimensions'])
names = {int(k): v for k, v in g['tissueNames'].items()}
T = {v: k for k, v in names.items()}
load = lambda f: np.frombuffer(gzip.decompress((GRID / f).read_bytes()), np.uint8).reshape(dim[::-1]).transpose(2, 1, 0)
tissue, vessel = load('model-grid.u8.gz'), load('model-vessel.u8.gz')
box = tuple(slice(lo[a], lo[a] + dim[a]) for a in range(3))
origin = np.array(g['originLASmm'])


def las(index):
    """Índice (i, j, k) dentro de la caja → mm LAS (x a la izquierda del paciente, y anterior, z craneal)."""
    q = np.asarray(index, float)
    return origin + q * np.array([-P, P, P])


def ct_mask(*parts):
    out = np.zeros(dim, bool)
    for name in parts:
        f = CASE / 'segmentations' / f'{name}.nii.gz'
        if f.exists():
            out |= np.asarray(nib.load(f).dataobj)[box] > 0
    return out


hu = np.asarray(nib.load(CASE / 'ct.nii.gz').dataobj)[box].astype(np.float32)
is_ = lambda *ts: np.isin(tissue, [T[t] for t in ts])
ii = np.indices(dim)[0]
right_side = las(np.stack(np.indices(dim), -1))[..., 0] < 0
kidney_m = is_('RenalCortex', 'RenalMedulla', 'RenalSinus', 'RenalPelvis', 'RenalCapsule')
kidney_m = ndi.binary_fill_holes(ndi.binary_closing(kidney_m, iterations=2))
liver_only = is_('Liver', 'LiverCapsule')
# Las máscaras del TAC incluyen los vasos intrahepáticos: se suman los del modelo que quedan dentro del hígado.
liver_m = ndi.binary_closing(liver_only | (np.isin(vessel, [3, 4]) & ndi.binary_dilation(liver_only, iterations=4)), iterations=2)
# El tubo digestivo del modelo comparte tejidos de pared: cada vóxel de pared o gas se asigna al contenido más cercano (≤ 6 mm).
wall_or_gas = is_('BowelGas', 'GutSubmucosa', 'GutMuscularis', 'SoftCapsule')
to_stomach = ndi.distance_transform_edt(~is_('GastricContents'), sampling=P)
to_colon = ndi.distance_transform_edt(~is_('ColonicContents'), sampling=P)
stomach_m = is_('GastricContents') | (wall_or_gas & (to_stomach <= 6) & (to_stomach <= to_colon))
colon_m = is_('ColonicContents') | (wall_or_gas & (to_colon <= 6) & (to_colon < to_stomach))
body_m = ndi.binary_fill_holes(tissue != T['Air'])
vertebrae = [f'vertebrae_{n}' for n in ('T10', 'T11', 'T12', 'L1', 'L2', 'L3', 'L4', 'L5')]
model = {
    'hígado': liver_m,
    'riñón derecho': kidney_m & right_side,
    'riñón izquierdo': kidney_m & ~right_side,
    'bazo': is_('Spleen'),
    'páncreas': is_('Pancreas'),
    'estómago': stomach_m,
    'colon': colon_m,
    'cuerpo (piel)': body_m,
    'columna T10–L5': is_('Vertebra'),
    'aorta descendente y abdominal': vessel == 1,
    'cava inferior': vessel == 2,
    'pulmones': is_('Lung'),
    'psoas': is_('Psoas'),
}
ct = {
    'hígado': ct_mask('liver'),
    'riñón derecho': ct_mask('kidney_right', 'kidney_cyst_right'),
    'riñón izquierdo': ct_mask('kidney_left', 'kidney_cyst_left'),
    'bazo': ct_mask('spleen'),
    'páncreas': ct_mask('pancreas'),
    'estómago': ct_mask('stomach'),
    'colon': ct_mask('colon'),
    'cuerpo (piel)': None,
    'columna T10–L5': ct_mask(*vertebrae),
    'aorta descendente y abdominal': ct_mask('aorta'),
    'cava inferior': ct_mask('inferior_vena_cava'),
    'pulmones': ct_mask('lung_lower_lobe_left', 'lung_lower_lobe_right', 'lung_middle_lobe_right', 'lung_upper_lobe_left', 'lung_upper_lobe_right'),
    'psoas': ct_mask('iliopsoas_left', 'iliopsoas_right'),
}
# Cuerpo del TAC: la mayor componente de lo que no es aire, con sus huecos rellenos corte a corte (la camilla queda fuera).
dense = ndi.binary_opening(hu > -300, iterations=2)
lab, n = ndi.label(dense)
dense = lab == (1 + np.argmax(ndi.sum(dense, lab, range(1, n + 1))))
ct['cuerpo (piel)'] = np.stack([ndi.binary_fill_holes(dense[:, :, k]) for k in range(dim[2])], axis=2)
model['cuerpo (piel)'] = np.stack([ndi.binary_fill_holes(body_m[:, :, k]) for k in range(dim[2])], axis=2)
# Aorta y cava se comparan en el tramo de alturas que tienen las dos, modelo y TAC.
for tube in ('aorta descendente y abdominal', 'cava inferior'):
    both = model[tube].any(axis=(0, 1)) & ct[tube].any(axis=(0, 1))
    # Por encima de z 30 mm la máscara del TAC incluye la aorta ascendente, que el modelo no tiene (no entra en ninguna ventana).
    both &= las(np.stack([np.zeros(dim[2]), np.zeros(dim[2]), np.arange(dim[2])], -1))[:, 2] <= 30
    model[tube], ct[tube] = model[tube] & both[None, None, :], ct[tube] & both[None, None, :]
# La columna del modelo se compara dentro del tramo de vértebras que cubre la máscara del TAC elegida.
zspan = np.where(ct['columna T10–L5'].any(axis=(0, 1)))[0]
model['columna T10–L5'] = model['columna T10–L5'] & (np.indices(dim)[2] >= zspan.min()) & (np.indices(dim)[2] <= zspan.max())
centroid = lambda m: las(np.array(np.nonzero(m)).mean(axis=1))


def axis_tilt(m):
    """Eje largo (primera componente principal) frente al eje del cuerpo: ángulo 3D y su proyección coronal, en grados."""
    pts = las(np.array(np.nonzero(m)).T)
    u = np.linalg.svd(pts - pts.mean(0), full_matrices=False)[2][0]
    u = u * np.sign(u[2])
    return float(np.degrees(np.arccos(abs(u[2])))), float(np.degrees(np.arctan2(abs(u[0]), abs(u[2]))))


def min_gap(a, b):
    """Separación mínima (mm) entre dos máscaras."""
    if not a.any() or not b.any():
        return float('nan')
    return float(ndi.distance_transform_edt(~b, sampling=P)[a].min())


def hull_fill(section):
    """Área de una sección entre el área de su envolvente convexa."""
    pts = np.array(np.nonzero(section)).T
    if len(pts) < 10:
        return float('nan')
    # Envolvente de las esquinas de cada píxel, no de sus centros: así una sección convexa da 1.
    corners = np.concatenate([pts + d for d in ((-0.5, -0.5), (-0.5, 0.5), (0.5, -0.5), (0.5, 0.5))])
    return float(section.sum() / ConvexHull(corners).volume)


organs = []
for name in model:
    a, b = model[name], ct[name]
    if not a.any() or not b.any():
        organs.append({'órgano': name, 'modelo_ml': float(a.sum() * VOX_ML), 'tac_ml': float(b.sum() * VOX_ML)})
        continue
    organs.append(
        {
            'órgano': name,
            'modelo_ml': float(a.sum() * VOX_ML),
            'tac_ml': float(b.sum() * VOX_ML),
            'dice': float(2 * (a & b).sum() / (a.sum() + b.sum())),
            'centroide_mm': float(np.linalg.norm(centroid(a) - centroid(b))),
        }
    )


def measure(S, gas, fat):
    """Las filas de la lista sobre un juego de máscaras `S` (modelo o TAC), su gas digestivo y su grasa."""
    kr, kl, lv, sp = centroid(S['riñón derecho']), centroid(S['riñón izquierdo']), centroid(S['hígado']), S['columna T10–L5']
    kz = np.where(S['riñón derecho'].any(axis=(0, 1)))[0]
    spine_at_kidney = sp & (np.indices(dim)[2] >= kz.min()) & (np.indices(dim)[2] <= kz.max())
    vk = centroid(spine_at_kidney)
    k_slice = int(round(np.array(np.nonzero(S['riñón derecho'])).mean(axis=1)[2]))
    tilt3d, tilt_cor = axis_tilt(S['riñón derecho'])
    shell = ndi.binary_dilation(S['riñón derecho'], iterations=7) & ~ndi.binary_dilation(S['riñón derecho'], iterations=1)
    ao, cava = S['aorta descendente y abdominal'][:, :, k_slice], S['cava inferior'][:, :, k_slice]
    row_x = lambda sec: float(las(np.append(np.array(np.nonzero(sec)).mean(axis=1), k_slice))[0]) if sec.any() else float('nan')
    return {
        'inclinación del riñón derecho (°)': tilt3d,
        'inclinación coronal del riñón derecho (°)': tilt_cor,
        'hígado sobre el riñón derecho, de centro a centro (mm)': float(lv[2] - kr[2]),
        'hígado sobre el riñón izquierdo, de centro a centro (mm)': float(lv[2] - kl[2]),
        'riñón izquierdo más alto que el derecho (mm)': float(kl[2] - kr[2]),
        'riñón derecho por delante de la vértebra a su altura (mm)': float(kr[1] - vk[1]),
        'grasa en los 10 mm que rodean el riñón derecho (fracción)': float((fat & shell).sum() / shell.sum()),
        'psoas a la columna, separación mínima (mm)': min_gap(S['psoas'], sp),
        'psoas al riñón derecho, separación mínima (mm)': min_gap(S['psoas'], S['riñón derecho']),
        'contorno hepático lleno en el corte axial del polo renal superior (área / envolvente)': hull_fill(S['hígado'][:, :, int(kz.max()) - 6]),
        'volumen del colon (ml)': float(S['colon'].sum() * VOX_ML),
        'colon al riñón izquierdo, separación mínima (mm)': min_gap(S['colon'], S['riñón izquierdo']),
        'gas digestivo (ml)': float(gas.sum() * VOX_ML),
        'estómago sobre el páncreas, de centro a centro (mm)': float(centroid(S['estómago'])[2] - centroid(S['páncreas'])[2]),
        'riñón derecho a la línea media vertebral (mm)': float(abs(kr[0] - vk[0])),
        'cava a la derecha de la aorta en el corte renal (mm)': row_x(ao) - row_x(cava),
        'aorta respecto de la línea media vertebral (mm, + izquierda)': row_x(ao) - float(vk[0]),
    }




def panniculus(body, is_fat):
    """Espesor (mm) de la grasa bajo la piel en el corte axial renal, por rayos desde fuera hacia el centro: percentiles 10, 50 y 90."""
    k = int(round(np.array(np.nonzero(ct['riñón derecho'])).mean(axis=1)[2]))
    sec, fat = body[:, :, k], is_fat[:, :, k]
    cx, cy = np.array(np.nonzero(sec)).mean(axis=1)
    out = []
    # Arco anterior y lateral, donde se apoya la sonda (90° es la línea media anterior); la pared posterior no está modelada.
    for angle in np.radians(np.arange(-45, 226, 5)):
        ux, uy = np.cos(angle), np.sin(angle)
        r = np.arange(max(dim[:2]), 0, -0.5)
        xs, ys = np.round(cx + r * ux).astype(int), np.round(cy + r * uy).astype(int)
        ok = (xs >= 0) & (xs < dim[0]) & (ys >= 0) & (ys < dim[1])
        xs, ys = xs[ok], ys[ok]
        inside = np.where(sec[xs, ys])[0]
        if not len(inside):
            continue
        run = fat[xs[inside[0] + 4 :], ys[inside[0] + 4 :]]
        # Tras 2 mm de piel, la grasa llega hasta el primer tramo de 1,5 mm que ya no lo es.
        stop = next((n for n in range(len(run) - 3) if not run[n : n + 3].any()), len(run))
        out.append(2 + stop * 0.5 * P)
    return [float(v) for v in np.percentile(out, [10, 50, 90])]


gut_ct = ct_mask('colon', 'stomach', 'small_bowel', 'duodenum')
rows_model = measure(model, is_('BowelGas'), is_('Fat', 'PerirenalFat', 'MesentericFat', 'RetroperitonealFat'))
rows_ct = measure(ct, gut_ct & (hu < -400), (hu >= -190) & (hu <= -30))
# Dos filas que no salen de un par de máscaras de órgano: la masa paravertebral y el panículo.
back = ct_mask('autochthon_left', 'autochthon_right') & (np.indices(dim)[2] >= zspan.min()) & (np.indices(dim)[2] <= zspan.max())
rows_model['masa paravertebral T10–L5 (ml)'] = float((is_('Muscle', 'Psoas', 'QuadratusLumborum') & ndi.binary_dilation(back, iterations=2)).sum() * VOX_ML)
rows_ct['masa paravertebral T10–L5 (ml)'] = float(back.sum() * VOX_ML)
pm, pc = panniculus(model['cuerpo (piel)'], is_('Skin', 'Fat')), panniculus(ct['cuerpo (piel)'], (hu >= -190) & (hu <= -30))
for label, at in (('percentil 10', 0), ('mediana', 1), ('percentil 90', 2)):
    rows_model[f'grasa bajo la piel en el arco anterior y lateral del corte renal, {label} (mm)'] = pm[at]
    rows_ct[f'grasa bajo la piel en el arco anterior y lateral del corte renal, {label} (mm)'] = pc[at]
# Tolerancia para dar una fila por cumplida: la relación tiene el mismo sentido y difiere menos que esto.
TOL = {'°': 5, 'mm': 6, 'fracción': 0.15, 'envolvente': 0.05, 'ml': None}
# «Gas digestivo limitado» es una cota: se cumple con menos gas que el TAC.
ONE_SIDED = {'gas digestivo (ml)'}
rows = []
for key in rows_model:
    m, c = rows_model[key], rows_ct[key]
    unit = next(u for u in TOL if u in key)
    tol = TOL[unit] if TOL[unit] is not None else 0.25 * abs(c) + 20
    ok = m <= c + tol if key in ONE_SIDED else abs(m - c) <= tol
    rows.append({'relación': key, 'modelo': m, 'tac': c, 'tolerancia': tol, 'cumple': bool(ok)})
json.dump({'órganos': organs, 'filas': rows}, open(OUT / 'relaciones.json', 'w'), ensure_ascii=False, indent=1)

fmt = lambda v: '–' if v is None or not np.isfinite(v) else (f'{v:.2f}' if abs(v) < 2 else f'{v:.1f}').replace('.', ',')
md = ['| Órgano | Modelo (ml) | TAC (ml) | Dice | Centroide (mm) |', '| --- | ---: | ---: | ---: | ---: |']
md += [f"| {o['órgano']} | {fmt(o['modelo_ml'])} | {fmt(o['tac_ml'])} | {fmt(o.get('dice'))} | {fmt(o.get('centroide_mm'))} |" for o in organs]
md += ['', '| Relación básica | Modelo s0028 | TAC s0028 | ¿Se cumple? |', '| --- | ---: | ---: | --- |']
md += [f"| {r['relación']} | {fmt(r['modelo'])} | {fmt(r['tac'])} | {'Sí' if r['cumple'] else 'No'} |" for r in rows]
(OUT / 'relaciones.md').write_text('\n'.join(md) + '\n')
print('\n'.join(md))

# Láminas: el mismo corte en el TAC y en el modelo, con los contornos de las máscaras del TAC sobre los dos.
COLORS = {
    'Air': '#000000', 'Skin': '#c9b8a8', 'Fat': '#8a7b4f', 'MesentericFat': '#a8955a', 'PerirenalFat': '#c4b06a', 'RetroperitonealFat': '#a8955a',
    'Muscle': '#8c4a4a', 'Psoas': '#b05c3c', 'QuadratusLumborum': '#b05c3c', 'Diaphragm': '#d98a6a', 'Liver': '#7a4a2e', 'LiverCapsule': '#9a6a4e',
    'Spleen': '#7d3f6b', 'Pancreas': '#d9b44a', 'RenalCortex': '#3f8f7a', 'RenalMedulla': '#2f6f6a', 'RenalSinus': '#d8cf9a', 'RenalPelvis': '#9ad0d8',
    'RenalCapsule': '#3f8f7a', 'Blood': '#b01f2e', 'VesselWallPortal': '#e07a7a', 'VesselWallThin': '#e07a7a', 'ArteryWall': '#ff9a9a', 'Lung': '#27313a',
    'Bone': '#e8e4d8', 'Vertebra': '#f4f1e6', 'Cartilage': '#b8c4c8', 'Myocardium': '#a03a4a', 'Bowel': '#5f8fb0', 'BowelGas': '#101820',
    'GutSubmucosa': '#7fa8c4', 'GutMuscularis': '#4f7896', 'SoftCapsule': '#7fa8c4', 'GastricContents': '#6fae8f', 'ColonicContents': '#5a7fb8',
    'Fluid': '#3a6ea5', 'UnsegmentedSoftTissue': '#6f6f6f',
}
palette = np.full((64, 3), 0.45)
for tissue_name, color in COLORS.items():
    if tissue_name in T:
        palette[T[tissue_name]] = matplotlib.colors.to_rgb(color)
cmap = ListedColormap(palette)
LEGEND = [('Grasa', 'Fat'), ('Músculo', 'Muscle'), ('Hígado', 'Liver'), ('Riñón', 'RenalCortex'), ('Bazo', 'Spleen'), ('Páncreas', 'Pancreas'), ('Sangre', 'Blood'), ('Hueso', 'Vertebra'),
          ('Estómago', 'GastricContents'), ('Colon', 'ColonicContents'), ('Intestino', 'Bowel'), ('Pulmón', 'Lung'), ('Sin segmentar', 'UnsegmentedSoftTissue')]
outline = [('hígado', '#ffd166'), ('riñón derecho', '#06d6a0'), ('riñón izquierdo', '#06d6a0'), ('bazo', '#ef476f'), ('columna T10–L5', '#ffffff'), ('aorta descendente y abdominal', '#ff5d5d'), ('cava inferior', '#5da9ff'), ('colon', '#c77dff'), ('estómago', '#f4a261'), ('páncreas', '#e9c46a')]
kc = np.round(np.array(np.nonzero(ct['riñón derecho'])).mean(axis=1)).astype(int)
views = {
    'axial': (lambda a: a[::-1, :, kc[2]].T, f'Axial a la altura del riñón derecho (z {las(kc)[2]:.0f} mm)'),
    'coronal': (lambda a: a[::-1, kc[1], :].T, f'Coronal por el riñón derecho (y {las(kc)[1]:.0f} mm)'),
    'sagital': (lambda a: a[kc[0], :, :].T, f'Sagital por el riñón derecho (x {las(kc)[0]:.0f} mm)'),
}
for name, (cut, title) in views.items():
    fig, ax = plt.subplots(1, 2, figsize=(15, 6.6), facecolor='#101418')
    ax[0].imshow(cut(hu), cmap='gray', vmin=-160, vmax=240, origin='lower', interpolation='nearest')
    ax[1].imshow(cut(tissue), cmap=cmap, vmin=0, vmax=63, origin='lower', interpolation='nearest')
    for a, label in zip(ax, ('TAC de s0028', 'Modelo s0028 (tejido clasificado)')):
        for organ, color in outline:
            sec = cut(ct[organ])
            if sec.any():
                a.contour(sec, levels=[0.5], colors=[color], linewidths=0.9)
        a.set_title(label, color='white', fontsize=13)
        a.set_axis_off()
    fig.suptitle(title + ' · contornos: máscaras del TAC', color='white', fontsize=14)
    handles = [matplotlib.patches.Patch(color=COLORS[t], label=label) for label, t in LEGEND]
    fig.legend(handles=handles, loc='lower center', ncol=7, frameon=False, labelcolor='white', fontsize=10)
    fig.tight_layout(rect=(0, 0.07, 1, 0.96))
    fig.savefig(OUT / f'relaciones-{name}.png', dpi=110, facecolor=fig.get_facecolor())
    plt.close(fig)
print('láminas en', OUT)
