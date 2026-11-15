import type { Vec3 } from '../../../core/vec3';
import { S0028_FIELD_MASK as M } from '../../s0028FieldMaskData';
import { S0028_BUNDLE as B } from './descriptor';
import { S0028_MASK_FIELDS } from './fieldMaskFields';

/** 16 mm en half float: el tope al que están recortados todos los campos fuente de s0028 (y lo que vale fuera de su caja). */
const SIXTEEN = 0x4c00;

/**
 * Mapa de ocupación de los campos fuente de s0028 (decisión 400): un bit por campo y celda de 6 mm, encendido si algún nodo del
 * campo que pueda intervenir en un punto de la celda (con un nodo de margen por el redondeo de float32) vale menos de 16 mm. Los
 * campos están recortados a 16 y la trilineal no sale del intervalo de sus nodos: con el bit apagado, el campo vale exactamente 16
 * en toda la celda, y la GPU puede no leerlo sin cambiar nada (`s28P`). Se calcula al cargar, desde los propios campos.
 */
export function buildS0028FieldMask(abdominal: Uint16Array | undefined, thoracic: Uint16Array | undefined): Uint32Array {
  const [nx, ny, nz] = M.dimensions,
    nxy = nx * ny,
    mask = new Uint32Array(M.cells);
  S0028_MASK_FIELDS.forEach((name, bit) => {
    const f = B.fields.find((x) => x.name === name);
    if (!f || f.pitchMm !== 1.5) throw new Error('Campo del mapa sin procedencia: ' + name);
    const data = f.asset === 'abdominal' ? abdominal : thoracic;
    // Sin su atlas (una persona de apoyo de pruebas), el campo se lee siempre: el bit encendido en todas las celdas es exacto.
    if (!data) {
      for (let i = 0; i < mask.length; i++) mask[i] |= 1 << bit;
      return;
    }
    const tex = B[f.asset].textureDimensions,
      sy = 2 * tex[0],
      sz = sy * tex[1];
    // Para cada nodo i de un eje, el rango de celdas cuyos puntos pueden usarlo: la trilineal de un punto q usa los nodos floor(q)
    // y floor(q) + 1, así que la celda [a, b) usa los nodos de floor(a) a floor(b) + 1; un nodo más a cada lado cubre el redondeo.
    const range = (k: number): [Int32Array, Int32Array] => {
      const n = M.dimensions[k],
        first = new Int32Array(f.dimensions[k]).fill(n),
        last = new Int32Array(f.dimensions[k]).fill(-1);
      for (let c = 0; c < n; c++) {
        const a = (M.originMm[k] + c * M.cellMm - f.originMm[k]) / 1.5,
          b = (M.originMm[k] + (c + 1) * M.cellMm - f.originMm[k]) / 1.5,
          i0 = Math.max(0, Math.floor(a) - 1),
          i1 = Math.min(f.dimensions[k] - 1, Math.floor(b) + 2);
        for (let i = i0; i <= i1; i++) {
          first[i] = Math.min(first[i], c);
          last[i] = Math.max(last[i], c);
        }
      }
      return [first, last];
    };
    const [ax, bx] = range(0),
      [ay, by] = range(1),
      [az, bz] = range(2),
      m = 1 << bit,
      w = f.dimensions[0];
    for (let z = 0; z < f.dimensions[2]; z++)
      for (let y = 0; y < f.dimensions[1]; y++) {
        const base = (z + f.offset[2]) * sz + (y + f.offset[1]) * sy + 2 * f.offset[0];
        // tramos de nodos < 16 de la fila: cada uno enciende de una vez su rango de celdas en x
        let x = 0;
        while (x < w) {
          while (x < w && data[base + 2 * x] === SIXTEEN) x++;
          if (x >= w) break;
          const x0 = x;
          while (x < w && data[base + 2 * x] !== SIXTEEN) x++;
          for (let c2 = az[z]; c2 <= bz[z]; c2++)
            for (let c1 = ay[y]; c1 <= by[y]; c1++) {
              const row = c2 * nxy + c1 * nx;
              for (let c0 = ax[x0]; c0 <= bx[x - 1]; c0++) mask[row + c0] |= m;
            }
        }
      }
  });
  if (nz * nxy !== M.cells) throw new Error('Rejilla del mapa de campos distinta');
  return mask;
}

/** La celda del mapa que contiene p, o −1 fuera de la rejilla (allí todos los campos valen 16). Par GLSL: `nearS28`. @twin s0028-mapa-campos */
export function s0028FieldMaskCell(p: Vec3): number {
  const v = [0, 1, 2].map((k) => Math.floor((p[k] - M.originMm[k]) / M.cellMm));
  if (v.some((x, k) => x < 0 || x >= M.dimensions[k])) return -1;
  return (v[2] * M.dimensions[1] + v[1]) * M.dimensions[0] + v[0];
}

/** Colocación xyz de cada página 32×32 RG16F del mapa en el atlas abdominal, con el mismo código que la grasa P3. */
export const s0028FieldMaskPages = (): number[][] =>
  Array.from({ length: M.pages.length / 3 }, (_, i) => {
    const c = parseInt(M.pages.slice(3 * i, 3 * i + 3), 36);
    return [(c % 6) * 32, (Math.floor(c / 6) % 8) * 32, Math.floor(c / 48)];
  });

/** Entero exacto (0–2047) como half float. */
const intHalf = (n: number): number => {
  if (n === 0) return 0;
  const e = Math.floor(Math.log2(n));
  return ((e + 15) << 10) | ((n / 2 ** e - 1) * 1024);
};

/**
 * Las páginas del mapa en sus colocaciones del atlas abdominal ya asignado: un téxel RG16F por celda, los bits 0–10 en R y los
 * 11–18 en G, como enteros exactos (texSubImage, sin textura ni sampler nuevos). La celda i va a la página i >> 10, téxel
 * (i & 31, (i >> 5) & 31).
 */
export function s0028FieldMaskUploads(
  mask: Uint32Array,
): ReadonlyArray<{ offset: readonly number[]; size: readonly number[]; data: Uint16Array }> {
  const pages = s0028FieldMaskPages(),
    words = new Uint16Array(2048 * pages.length);
  for (let i = 0; i < mask.length; i++) {
    words[2 * i] = intHalf(mask[i] & 2047);
    words[2 * i + 1] = intHalf(mask[i] >>> 11);
  }
  return pages.map((offset, i) => ({ offset, size: [32, 32, 1], data: words.subarray(2048 * i, 2048 * (i + 1)) }));
}
