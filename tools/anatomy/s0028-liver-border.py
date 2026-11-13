"""Borde anterior del hígado de s0028 lineal y liso (decisión 361): cierra la boca de su fisura anterior y alisa esa cara.

El responsable pidió un borde anterior como el de un hígado promedio y un modelo de bordes regulares, aunque el TAC de esta
persona tenga ahí la fisura del ligamento falciforme y su máscara, ondulaciones de 2 mm. Tres pasos sobre el campo `liver`, solo
en la cara anterior (sin hígado por delante; y creciente = anterior):
  1. cierre morfológico de 12 mm: puentea la fisura donde es estrecha;
  2. cierre de la altura de la cara anterior con un disco de 20 mm (tope 30 mm): rellena el valle que queda;
  3. alisado gaussiano de 3 mm de la distancia, que se apaga de 6 a 15 mm bajo la cara anterior.
Lo que pasa a ser hígado se filtra con el clasificador del simulador (`s0028-liver-border-filter.ts`): fuera de la pared y sin
otro dueño. El borde inferior y las caras hacia el riñón, la vesícula, la cava y el hilio no cambian.

  python -I s0028-liver-border.py candidates <abdominal-direct.gzip.bin> <candidatos.json>
  node --import tsx tools/anatomy/s0028-liver-border-filter.ts <candidatos.json> <aceptados.json>
  python -I s0028-liver-border.py apply <abdominal-direct.gzip.bin> <aceptados.json> <salida.gzip.bin>

`apply` exige el recurso original (sha256 del crudo) y vuelve a escribir solo los vóxeles cuya distancia cambia.
"""
import gzip, hashlib, json, sys
import numpy as np
from scipy import ndimage as ndi

ORIGINAL_RAW_SHA256 = 'cb91610c5ad9421d4ceb4f42bd301b7ee7588ae066048e010d665165a4be9a08'
TEXTURE = (189, 256, 685)  # ancho, alto, cortes del atlas abdominal RG16F
ORIGIN = np.array([-133.98527431275116, -81.71478450019774, -142.48879268882285])
DIMS = (173, 117, 112)
OFFSET = (0, 105, 477)
PITCH = 1.5
CLOSE_MM, DISK_MM, LIFT_MM, SMOOTH_MM = 12.0, 20.0, 30.0, 3.0


def load(path):
    raw = gzip.open(path).read()
    volume = np.frombuffer(raw, dtype=np.float16).reshape(TEXTURE[2], TEXTURE[1], TEXTURE[0], 2).copy()
    return raw, volume


def block(volume):
    (ox, oy, oz), (nx, ny, nz) = OFFSET, DIMS
    return volume[oz:oz + nz, oy:oy + ny, ox:ox + nx]  # vista (z, y, x, canal)


def ball(r):
    g = np.arange(-r, r + 1)
    z, y, x = np.meshgrid(g, g, g, indexing='ij')
    return x * x + y * y + z * z <= r * r


def additions(mask):
    r = int(round(CLOSE_MM / PITCH))
    padded = np.pad(mask, r + 2)
    closed = ndi.binary_erosion(ndi.binary_dilation(padded, ball(r)), ball(r))[r + 2:-r - 2, r + 2:-r - 2, r + 2:-r - 2]
    ahead = np.flip(np.cumsum(np.flip(mask, 1), 1), 1) - mask  # vóxeles de hígado con y mayor en la misma columna
    bridged = mask | (closed & ~mask & (ahead == 0))
    ny = mask.shape[1]
    top = np.where(bridged.any(1), ny - 1 - np.argmax(np.flip(bridged, 1), 1), -1)  # (z, x): vóxel más anterior
    d = int(round(DISK_MM / PITCH))
    g = np.arange(-d, d + 1)
    disk = g[:, None] ** 2 + g[None, :] ** 2 <= d * d
    level = ndi.grey_closing(np.where(top < 0, -1000.0, top), footprint=disk, mode='constant', cval=-1000.0)
    lift = np.where(top >= 0, np.clip(level - top, 0, LIFT_MM / PITCH), 0)
    y = np.arange(ny)[None, :, None]
    valley = (y > top[:, None, :]) & (y <= (top + lift)[:, None, :]) & (top[:, None, :] >= 0)
    return (bridged | valley) & ~mask


def signed_distance(mask, clip=True):
    inside = ndi.distance_transform_edt(mask) * PITCH - PITCH / 2
    outside = ndi.distance_transform_edt(~mask) * PITCH - PITCH / 2
    return np.where(mask, -inside, np.minimum(outside, 16.0) if clip else outside)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def reshaped(mask):
    """Distancia del hígado con la fisura cerrada y la cara anterior alisada, sin filtrar."""
    grown = mask | additions(mask)
    exact = signed_distance(grown, clip=False)
    smooth = ndi.gaussian_filter(exact, SMOOTH_MM / PITCH)
    ahead = (np.flip(np.cumsum(np.flip(grown, 1), 1), 1) - grown) * PITCH  # mm de hígado por delante
    weight = ndi.gaussian_filter(1 - smoothstep(6.0, 15.0, ahead.astype(np.float32)), 1.5)
    # Solo junto a la superficie (a más de 6 mm la distancia exacta basta) y en pasos de 1/32 mm: el recurso comprime casi igual.
    weight *= 1 - smoothstep(3.0, 6.0, np.abs(exact))
    return np.where(weight > 0.01, np.round((exact + weight * (smooth - exact)) * 32) / 32, exact)


def main():
    mode, source = sys.argv[1:3]
    raw, volume = load(source)
    liver = block(volume)
    old = liver[..., 0].astype(np.float32)
    mask = old < 0
    new = reshaped(mask)
    gained = (new < 0) & ~mask
    if mode == 'candidates':
        zyx = np.argwhere(gained)
        points = (ORIGIN + PITCH * zyx[:, ::-1]).round(6).tolist()
        json.dump({'index': zyx.tolist(), 'points': points}, open(sys.argv[3], 'w'))
        print(f'{len(zyx)} candidatos, {len(zyx) * PITCH ** 3 / 1000:.1f} ml')
        return
    if hashlib.sha256(raw).hexdigest() != ORIGINAL_RAW_SHA256:
        raise SystemExit('El recurso no es el original: aplica sobre el de la decisión 357 o anterior')
    accepted = np.zeros_like(mask)
    accepted[tuple(np.array(json.load(open(sys.argv[3]))['index']).T)] = True
    # Lo rechazado por el filtro (pared u otro dueño) sigue fuera del hígado.
    rejected = gained & ~accepted
    new[rejected] = np.maximum(new[rejected], 0.3)
    new = np.minimum(new, 16.0).astype(np.float32)
    changed = np.abs(new - old) > 0.01
    liver[..., 0][changed] = new[changed].astype(np.float16)
    out = volume.tobytes()
    packed = gzip.compress(out, compresslevel=9, mtime=0)
    open(sys.argv[4], 'wb').write(packed)
    after = liver[..., 0].astype(np.float32) < 0
    print(json.dumps({'gainedMl': round(int((after & ~mask).sum()) * PITCH ** 3 / 1000, 1), 'lostMl': round(int((mask & ~after).sum()) * PITCH ** 3 / 1000, 1),
                      'liverMl': round(int(after.sum()) * PITCH ** 3 / 1000, 1), 'changedVoxels': int(changed.sum()), 'rawBytes': len(out),
                      'gzipBytes': len(packed), 'sha256Raw': hashlib.sha256(out).hexdigest(), 'sha256Gzip': hashlib.sha256(packed).hexdigest()}, indent=1))


main()
