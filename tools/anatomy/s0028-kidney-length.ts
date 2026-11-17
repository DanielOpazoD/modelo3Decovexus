/**
 * Riñón derecho de s0028 de 110 mm (decisión 387). El de su TAC mide 91 mm de polo a polo, en el límite bajo de lo normal, y el
 * responsable lo veía corto en las ventanas renales; el modelo idealizado (decisión 361) toma el riñón de un adulto promedio.
 *
 * El campo `kidneyRight` se estira a lo largo de su eje largo, con el centro fijo (los polos se alejan 9,5 mm cada uno) y sin
 * tocar el ancho ni el grosor: la distancia en q es la del punto de origen p, dividida por el módulo de su gradiente tras el
 * estiramiento, que la deja correcta junto a la superficie. Donde el riñón estirado pisaría otro órgano, un vaso fuente o la
 * banda de la pared, se aplana contra ellos con una unión suave (como las impresiones reales), con la holgura `MARGIN_MM`.
 * El bloque no cabe en su caja (le quedaría 1 mm a los polos): se reubica en una caja mayor en un hueco libre del atlas.
 * El interior renal (corteza, médula, seno; decisión 341) se estira igual, por el vóxel más cercano, y sus páginas se
 * recolocan. El riñón izquierdo no cambia.
 *
 *   node --import tsx tools/anatomy/s0028-kidney-length.ts [--write]
 *   npx prettier --write src/anatomy/s0028RenalInterior*.ts src/anatomy/people/s0028/descriptor.ts
 *
 * Parte del atlas abdominal de la decisión 377, fijado por su hash: no es acumulativo.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { HALF, toHalf } from '../../src/anatomy/halfFloat';
import { S0028_BUNDLE as B } from '../../src/anatomy/people/s0028/descriptor';
import { S0028_KIDNEY_FRAMES } from '../../src/anatomy/people/s0028/cpu';
import { s0028RenalRunCodes } from '../../src/anatomy/people/s0028/solids';
import { s0028FatPages, s0028WideFatPages } from '../../src/anatomy/people/s0028/solidsData';
import { S0028_RENAL_INTERIOR as R } from '../../src/anatomy/s0028RenalInteriorData';
import { S0028_RENAL_INTERIOR_RUNS as RUNS } from '../../src/anatomy/s0028RenalInteriorRuns';
import type { Vec3 } from '../../src/core/vec3';
import { encodeS0028RenalRuns, S0028_RENAL_RUNS_FORMAT } from './s0028RenalRuns';
import { loadS0028 } from './s0028Windows';

const INPUT_RAW_SHA256 = 'f93e2d2ea1870a345fa971fd1a2237c58152e4aea79a14b3e785f2eb4025c4de';
/** Longitud de polo a polo del riñón derecho del TAC (extensión de su máscara a lo largo del eje largo) y la nueva. */
const SOURCE_LENGTH_MM = 91.1;
const TARGET_LENGTH_MM = 110;
/** Nodos que crece la caja del campo a cada lado (x, y, z): con ellos el riñón estirado queda a 9 mm o más del borde. */
const GROW = [2, 3, 6] as const;
/** Holgura (mm) frente a los vecinos y radio (mm) de la unión suave con que se aplana contra ellos. */
const MARGIN_MM = 0.75;
const BLEND_MM = 2;
/** Vecinos contra los que se recorta: los órganos que reclaman un punto y los vasos fuente. */
const NEIGHBOURS = [
  'liver',
  'spleen',
  'pancreas',
  'gallbladder',
  'digestiveTract',
  'posteriorMuscle',
  'lumbarSacralBone',
  'thoracicBone',
  'cartilage',
  'lung',
  'aorta',
  'inferior_vena_cava',
  'portal_vein_and_splenic_vein',
] as const;

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const smax = (a: number, b: number) => {
  const h = Math.max(BLEND_MM - Math.abs(a - b), 0) / BLEND_MM;
  return Math.max(a, b) + (h * h * BLEND_MM) / 4;
};
const path = 'src/anatomy/s0028/abdominal-direct.gzip.bin';
const raw = new Uint8Array(gunzipSync(readFileSync(path)));
if (sha(raw) !== INPUT_RAW_SHA256) throw new Error('Este paso parte del atlas abdominal de la decisión 377: restáurelo antes');
const words = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
const [W, H, D] = B.abdominal.textureDimensions;
const old = B.fields.find((f) => f.name === 'kidneyRight')!;
const frame = S0028_KIDNEY_FRAMES[0],
  c = frame.center,
  norm = Math.hypot(...frame.long),
  u: Vec3 = [frame.long[0] / norm, frame.long[1] / norm, frame.long[2] / norm],
  s = TARGET_LENGTH_MM / SOURCE_LENGTH_MM;
/** Punto de origen (riñón del TAC) del punto q del riñón estirado. */
const source = (q: Vec3): Vec3 => {
  const t = (q[0] - c[0]) * u[0] + (q[1] - c[1]) * u[1] + (q[2] - c[2]) * u[2],
    k = t * (1 / s - 1);
  return [q[0] + k * u[0], q[1] + k * u[1], q[2] + k * u[2]];
};
const at = (offset: readonly number[], i: number, j: number, k: number) =>
  2 * ((k + offset[2]) * W * H + (j + offset[1]) * W + i + offset[0]);
/** Distancia del riñón del TAC en p, trilineal sobre sus nodos; 16 fuera de su caja. */
function oldDistance(p: Vec3): number {
  const g = p.map((v, a) => (v - old.originMm[a]) / 1.5);
  if (g.some((v, a) => !(v >= 0 && v <= old.dimensions[a] - 1))) return 16;
  const i = g.map((v, a) => Math.min(old.dimensions[a] - 2, Math.floor(v))),
    f = g.map((v, a) => v - i[a]);
  let value = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++)
        value +=
          (dx ? f[0] : 1 - f[0]) *
          (dy ? f[1] : 1 - f[1]) *
          (dz ? f[2] : 1 - f[2]) *
          HALF[words[at(old.offset, i[0] + dx, i[1] + dy, i[2] + dz)]];
  return value;
}
const oldLabel = (p: Vec3): number => {
  const i = p.map((v, a) => Math.round((v - old.originMm[a]) / 1.5));
  return i.some((v, a) => !(v >= 0 && v < old.dimensions[a])) ? 0 : words[at(old.offset, i[0], i[1], i[2]) + 1];
};

// Caja nueva: la anterior crecida `GROW` nodos a cada lado, en un hueco libre del atlas sin el bloque anterior.
const dims = old.dimensions.map((n, a) => n + 2 * GROW[a]),
  origin = old.originMm.map((v, a) => v - 1.5 * GROW[a]);
const used = new Uint8Array(W * H * D);
const occupy = (o: readonly number[], size: readonly number[]) => {
  for (let z = o[2]; z < o[2] + size[2]; z++)
    for (let y = o[1]; y < o[1] + size[1]; y++) for (let x = o[0]; x < o[0] + size[0]; x++) used[(z * H + y) * W + x] = 1;
};
const free = (o: readonly number[], size: readonly number[]) => {
  if (o[0] + size[0] > W || o[1] + size[1] > H || o[2] + size[2] > D) return false;
  for (let z = o[2]; z < o[2] + size[2]; z++)
    for (let y = o[1]; y < o[1] + size[1]; y++) for (let x = o[0]; x < o[0] + size[0]; x++) if (used[(z * H + y) * W + x]) return false;
  return true;
};
for (const f of B.fields) if (f.asset === 'abdominal' && f.name !== 'kidneyRight') occupy(f.offset, f.dimensions);
occupy(B.depth.offset, B.depth.dimensions);
B.wall.placements.forEach((o) => occupy(o, B.wall.tileSize));
occupy(B.wall.centerOffset, [1, 181, 1]);
occupy(B.wallDerived.ramps.placement, B.wallDerived.ramps.size);
s0028FatPages().forEach((o) => occupy(o, [32, 32, 1]));
s0028WideFatPages().forEach((o) => occupy(o, [32, 32, 1]));
let offset: number[] | null = null;
search: for (let z = D - dims[2]; z >= 0; z--)
  for (let y = H - dims[1]; y >= 0; y--)
    for (let x = 0; x + dims[0] <= W; x++)
      if (free([x, y, z], dims)) {
        offset = [x, y, z];
        break search;
      }
if (!offset) throw new Error('El atlas abdominal no tiene hueco para el riñón');
occupy(offset, dims);

// Campo nuevo: estirado, corregido por el gradiente y aplanado contra los vecinos.
const { scene } = loadS0028();
const regional = scene.person.cpu.regional!;
const field = new Uint16Array(dims[0] * dims[1] * dims[2] * 2);
let inside = 0,
  flattened = 0,
  lowest = Infinity,
  highest = -Infinity;
for (let k = 0; k < dims[2]; k++)
  for (let j = 0; j < dims[1]; j++)
    for (let i = 0; i < dims[0]; i++) {
      const q: Vec3 = [origin[0] + 1.5 * i, origin[1] + 1.5 * j, origin[2] + 1.5 * k],
        p = source(q);
      let d = oldDistance(p);
      if (d < 16) {
        // ∇q d = J·∇p d, con J el estiramiento inverso a lo largo de u.
        const g = [0, 1, 2].map((a) => {
          const e: Vec3 = [0, 0, 0];
          e[a] = 0.75;
          return (oldDistance(p.map((v, b) => v + e[b]) as Vec3) - oldDistance(p.map((v, b) => v - e[b]) as Vec3)) / 1.5;
        });
        const along = g[0] * u[0] + g[1] * u[1] + g[2] * u[2],
          scaled = g.map((v, a) => v - along * u[a] * (1 - 1 / s)),
          length = Math.hypot(...scaled);
        if (length > 0.2) d /= length;
      }
      if (d < 4) {
        let band = -Infinity;
        for (const name of NEIGHBOURS) band = Math.max(band, MARGIN_MM - regional.s0028SourceValue(q, name).d);
        const wall = regional.s0028WallAt(q);
        if (wall?.kind === 'known' && !wall.estimated) band = Math.max(band, wall.interfaceMm - wall.depthMm + MARGIN_MM);
        if (band > d - BLEND_MM) {
          const next = smax(d, band);
          if (d < 0 && next >= 0) flattened++;
          d = next;
        }
      }
      // En pasos de 1/16 mm, como el resto del campo, y nunca 0: un nodo justo en la superficie es un empate que la CPU y la GPU
      // (con el redondeo del float32) resolverían a lados distintos. El campo del TAC no tenía ninguno.
      const rounded = Math.round(16 * d) / 16;
      d = Math.max(-16, Math.min(16, rounded === 0 ? (d < 0 ? -1 / 16 : 1 / 16) : rounded));
      const n = 2 * ((k * dims[1] + j) * dims[0] + i);
      field[n] = toHalf(d);
      field[n + 1] = oldLabel(p);
      if (d < 0) {
        inside++;
        const t = (q[0] - c[0]) * u[0] + (q[1] - c[1]) * u[1] + (q[2] - c[2]) * u[2];
        lowest = Math.min(lowest, t);
        highest = Math.max(highest, t);
      }
    }
// El bloque anterior se vacía y el nuevo se escribe en su hueco.
for (let k = 0; k < old.dimensions[2]; k++)
  for (let j = 0; j < old.dimensions[1]; j++)
    for (let i = 0; i < old.dimensions[0]; i++) words[at(old.offset, i, j, k)] = words[at(old.offset, i, j, k) + 1] = 0;
for (let k = 0; k < dims[2]; k++)
  for (let j = 0; j < dims[1]; j++)
    for (let i = 0; i < dims[0]; i++) {
      const n = 2 * ((k * dims[1] + j) * dims[0] + i);
      words[at(offset, i, j, k)] = field[n];
      words[at(offset, i, j, k) + 1] = field[n + 1];
    }

// Interior renal: la caja nueva es el campo sin sus 6 nodos de relleno, como la anterior.
const pad = (old.dimensions[0] - R.boxes[0].dimensions[0]) / 2;
const box = { origin: origin.map((v) => v + 1.5 * pad), dims: dims.map((n) => n - 2 * pad) };
const oldBox = R.boxes[0],
  oldCodes = s0028RenalRunCodes(RUNS[0], oldBox.dimensions[0] * oldBox.dimensions[1] * oldBox.dimensions[2]);
const codes = new Uint8Array(box.dims[0] * box.dims[1] * box.dims[2]);
for (let x = 0; x < box.dims[0]; x++)
  for (let y = 0; y < box.dims[1]; y++)
    for (let z = 0; z < box.dims[2]; z++) {
      const p = source([box.origin[0] + 1.5 * x, box.origin[1] + 1.5 * y, box.origin[2] + 1.5 * z]),
        i = p.map((v, a) => Math.round((v - oldBox.originMm[a]) / 1.5));
      if (i.some((v, a) => !(v >= 0 && v < oldBox.dimensions[a]))) continue;
      codes[(x * box.dims[1] + y) * box.dims[2] + z] = oldCodes[(i[0] * oldBox.dimensions[1] + i[1]) * oldBox.dimensions[2] + i[2]];
    }
const rightBytes = Math.ceil(codes.length / 2),
  rightPages = Math.ceil(rightBytes / 2048),
  leftPages = Math.ceil(R.boxes[1].byteCount / 2048),
  pageCount = rightPages + leftPages;
let pages = '',
  placed = 0;
for (let z = 0; z < D && placed < pageCount; z++)
  for (let y = 0; y < 8 && placed < pageCount; y++)
    for (let x = 0; x < 6 && placed < pageCount; x++) {
      const o = [32 * x, 32 * y, z];
      if (!free(o, [32, 32, 1])) continue;
      occupy(o, [32, 32, 1]);
      pages += (x + 6 * y + 48 * z).toString(36).padStart(3, '0');
      placed++;
    }
if (placed !== pageCount) throw new Error('El atlas abdominal no tiene páginas libres suficientes');

// El zlib del sistema (el de Python) comprime estos campos mejor que el de Node: es el que fija el tamaño del recurso.
const packed = new Uint8Array(
  execFileSync(
    'python3',
    ['-c', 'import gzip,sys;sys.stdout.buffer.write(gzip.compress(sys.stdin.buffer.read(),compresslevel=9,mtime=0))'],
    {
      input: raw,
      maxBuffer: 1 << 28,
    },
  ),
);
const labelled = [...codes].filter((v) => v === 9 || v === 10).length;
console.log(
  JSON.stringify(
    {
      stretch: +s.toFixed(4),
      poleToPoleMm: +(highest - lowest).toFixed(1),
      volumeMl: +((inside * 3.375) / 1000).toFixed(1),
      flattenedVoxels: flattened,
      field: { originMm: origin, dimensions: dims, offset },
      interior: { originMm: box.origin, dimensions: box.dims, rightPages, leftPages, parenchymaVoxels: labelled },
      gzipBytes: packed.byteLength,
      sha256Gzip: sha(packed),
      sha256Raw: sha(raw),
    },
    null,
    1,
  ),
);
if (process.argv.includes('--write')) {
  writeFileSync(path, packed);
  const descriptor = 'src/anatomy/people/s0028/descriptor.ts';
  let text = readFileSync(descriptor, 'utf8');
  const entry = `name: 'kidneyRight',\n      asset: 'abdominal',\n      originMm: [${old.originMm.join(', ')}],\n      dimensions: [${old.dimensions.join(', ')}],\n      offset: [${old.offset.join(', ')}],`;
  if (!text.includes(entry)) throw new Error('No encuentro la entrada del riñón derecho en el descriptor');
  text = text.replace(
    entry,
    `name: 'kidneyRight',\n      asset: 'abdominal',\n      originMm: [${origin.join(', ')}],\n      dimensions: [${dims.join(', ')}],\n      offset: [${offset.join(', ')}],`,
  );
  for (const [key, before, after] of [
    ['gzipBytes', B.abdominal.gzipBytes, packed.byteLength],
    ['sha256Gzip', `'${B.abdominal.sha256Gzip}'`, `'${sha(packed)}'`],
    ['sha256Raw', `'${B.abdominal.sha256Raw}'`, `'${sha(raw)}'`],
  ] as const) {
    const from = `${key}: ${before},`;
    if (!text.includes(from)) throw new Error('No encuentro ' + key + ' en el descriptor');
    text = text.replace(from, `${key}: ${after},`);
  }
  writeFileSync(descriptor, text);
  const header = (what: string) =>
    `/** Generado por tools/anatomy/install-s0028-renal-interior.ts y estirado por tools/anatomy/s0028-kidney-length.ts. ${what} Corteza y médula E; seno graso y colector D; resto U. */\n`;
  writeFileSync(
    'src/anatomy/s0028RenalInteriorData.ts',
    header('Cajas y páginas del interior renal s0028.') +
      'export const S0028_RENAL_INTERIOR = ' +
      JSON.stringify(
        {
          ...R,
          boxes: [
            { side: 'right', originMm: box.origin, dimensions: box.dims, pageBase: 0, byteCount: rightBytes },
            { ...R.boxes[1], pageBase: rightPages },
          ],
          pageCount,
          pages,
        },
        null,
        2,
      ) +
      ' as const;\n',
  );
  writeFileSync(
    'src/anatomy/s0028RenalInteriorRuns.ts',
    header(S0028_RENAL_RUNS_FORMAT) +
      'export const S0028_RENAL_INTERIOR_RUNS = ' +
      JSON.stringify([encodeS0028RenalRuns(codes), RUNS[1]]) +
      ' as const;\n',
  );
}
