"""Grasa compatible D del abdomen s0028 a 3 mm, para `install-s0028-wide-fat.ts`.

La grasa P3 (`s0028-p3-fat-pages-v1`) sólo cubre 30 mm alrededor de cada riñón. Fuera de ahí el modelo dejaba U lo que
en el TAC es grasa retroperitoneal y mesentérica: en la ventana hepatorrenal, el 45 % del sector. Este paso aplica la
misma regla (HU crudo en [-190, -30] y fuera de las 117 máscaras fuente) a la caja del abdomen superior y la reduce a
celdas de 3 mm por mayoría (≥ 5 de sus 8 vóxeles de 1,5 mm), alineadas con la rejilla común del TAC. Es una
derivación D a menor resolución; el HU decide dónde hay grasa, no su brillo. Sin validación clínica.

    python -I tools/anatomy/s0028-wide-fat.py --case-dir "$VEXUS_S0028_CASE_DIR" --out <directorio nuevo>

Escribe `wide-fat.bin` (un bit por celda, xyz con z rápida, bits little-endian), `wide-fat.json` y `samples.json`
(celdas testigo con su punto LAS, para las pruebas).
"""
import argparse
import glob
import hashlib
import json
import os
from pathlib import Path

import nibabel as nib
import numpy as np

FAT_HU = (-190, -30)
MAJORITY = 5
PITCH = 3.0
# Caja LAS (mm) del abdomen superior: del polo inferior renal a la cúpula hepática, de pared a pared.
BOX_LO = np.array([-141.0, -129.0, -240.0])
BOX_HI = np.array([129.0, 120.0, 30.0])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case-dir', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    case = json.loads((Path(__file__).parent/'s0028-case.json').read_text())
    ct_path = os.path.join(args.case_dir, 'ct.nii.gz')
    if hashlib.sha256(Path(ct_path).read_bytes()).hexdigest() != case['ctSha256']:
        raise ValueError('TAC distinto del caso s0028 fijado')
    ct = np.asarray(nib.load(ct_path).dataobj)
    if list(ct.shape) != case['shape']:
        raise ValueError('rejilla del TAC distinta')
    masks = sorted(glob.glob(os.path.join(args.case_dir, 'segmentations', '*.nii.gz')))
    if sorted(os.path.basename(p)[:-7] for p in masks) != sorted(case['requiredMasks']):
        raise ValueError('máscaras fuente distintas de las requeridas')
    known = np.zeros(ct.shape, bool)
    for path in masks:
        known |= np.asarray(nib.load(path).dataobj) > 0
    fat = (ct >= FAT_HU[0]) & (ct <= FAT_HU[1]) & ~known

    vox_to_las = np.array(case['rasToLASmm']) @ np.array(case['affineRASmm'])
    if not np.allclose(vox_to_las[:3, :3], np.diag([-1.5, 1.5, 1.5])):
        raise ValueError('se espera una reflexión en x y paso de 1,5 mm')
    corners = np.array([[x, y, z, 1.0] for x in (BOX_LO[0], BOX_HI[0]) for y in (BOX_LO[1], BOX_HI[1])
                        for z in (BOX_LO[2], BOX_HI[2])]) @ np.linalg.inv(vox_to_las).T
    lo = np.maximum(np.floor(corners[:, :3].min(0)).astype(int), 0)
    hi = np.minimum(np.ceil(corners[:, :3].max(0)).astype(int), np.array(ct.shape)-1)
    hi -= (hi-lo+1) % 2  # número par de vóxeles por eje: celdas completas de 2 × 2 × 2
    sub = fat[lo[0]:hi[0]+1, lo[1]:hi[1]+1, lo[2]:hi[2]+1][::-1]  # x LAS creciente
    n = np.array(sub.shape)//2
    cells = sub.reshape(n[0], 2, n[1], 2, n[2], 2).sum((1, 3, 5)) >= MAJORITY
    # Esquina mínima LAS de la celda (0, 0, 0): centro de su primer vóxel menos medio vóxel.
    first = vox_to_las @ np.array([hi[0], lo[1], lo[2], 1.0])
    origin = first[:3]-0.75

    bits = cells.ravel(order='C')
    packed = np.packbits(bits, bitorder='little')
    out = Path(args.out)
    out.mkdir(parents=True)
    (out/'wide-fat.bin').write_bytes(packed.tobytes())
    info = {
        'format': 's0028-wide-fat-3mm-v1', 'person': 's0028', 'provenance': 'D', 'pitchMm': PITCH,
        'originMm': origin.tolist(), 'dimensions': n.tolist(), 'bitCount': int(bits.size), 'byteCount': int(packed.size),
        'fatCells': int(bits.sum()), 'fatHU': list(FAT_HU), 'majorityOf8': MAJORITY,
        'excluded': f'{len(masks)} source masks', 'flatten': 'C xyz, z fastest; little-endian bits',
        'sha256': hashlib.sha256(packed.tobytes()).hexdigest(), 'ctSha256': case['ctSha256'],
        'clinicalValidation': False,
    }
    (out/'wide-fat.json').write_text(json.dumps(info, indent=1))
    # Testigos reproducibles: celdas repartidas por toda la caja, con el centro LAS de cada una.
    rng = np.random.default_rng(20261112)
    flat = rng.choice(bits.size, 600, replace=False)
    idx = np.stack(np.unravel_index(np.sort(flat), cells.shape), 1)
    rows = [{'cell': c.tolist(), 'pointLASmm': (origin+PITCH*(c+0.5)).tolist(), 'fat': bool(cells[tuple(c)])} for c in idx]
    (out/'samples.json').write_text(json.dumps({'format': info['format'], 'sha256': info['sha256'], 'rows': rows}))
    print(json.dumps({k: info[k] for k in ('originMm', 'dimensions', 'byteCount', 'fatCells', 'sha256')}))


if __name__ == '__main__':
    main()
