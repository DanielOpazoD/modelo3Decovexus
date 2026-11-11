/**
 * Instala el interior renal s0028 (exportador `s0028-renal-interior.py`, P3 r4) en el simulador: corteza y médula E,
 * seno graso y colector D, lo demás U. No toca el atlas, la reserva de pared ni el manifiesto: escribe dos módulos
 * generados, el descriptor (cajas y páginas del atlas) y los códigos por tramos, que la CPU y la GPU leen igual.
 *
 *   python -I tools/anatomy/s0028-renal-sinus-fill.py <carpeta>          # contenido no subclasificado del seno
 *   node --import tsx tools/anatomy/install-s0028-renal-interior.ts <carpeta con renal-interior.json y .bin>
 *   npx prettier --write src/anatomy/s0028RenalInterior*.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HALF } from '../../src/anatomy/halfFloat';
import { S0028_BUNDLE as B } from '../../src/anatomy/people/s0028/descriptor';
import { s0028FatPages } from '../../src/anatomy/people/s0028/solidsData';

interface SourceBox {
  side: string;
  field: string;
  nodeOffset: number[];
  dimensions: number[];
  originMm: number[];
  pageBase: number;
  pageCount: number;
  byteCount: number;
}
const folder = process.argv[2];
if (!folder) throw new Error('Indicar la carpeta del exportador');
const info = JSON.parse(readFileSync(resolve(folder, 'renal-interior.json'), 'utf8')) as {
  format: string;
  person: string;
  boxes: SourceBox[];
  pageCount: number;
  encodedBytes: number;
  sha256: string;
};
const payload = readFileSync(resolve(folder, 'renal-interior.bin'));
const sha256 = createHash('sha256').update(payload).digest('hex');
if (
  info.format !== 's0028-p3-renal-interior-v1' ||
  info.person !== 's0028' ||
  payload.length !== info.encodedBytes ||
  sha256 !== info.sha256
)
  throw new Error('Interior renal de otro formato, persona o contenido');
if (info.boxes.length !== 2 || info.boxes.some((b, i) => b.side !== ['right', 'left'][i]))
  throw new Error('Se esperan las cajas derecha e izquierda');

/**
 * Código por vóxel: bits 0–2 etiqueta (0 U, 1 corteza, 2 médula, 3 seno graso, 4 colector, 5 seno sin subclasificar);
 * bit 3, hipótesis E.
 */
const SYMBOL: Record<number, string> = { 0: 'U', 3: 'F', 4: 'P', 9: 'C', 10: 'M', 13: 'S' };
const fillPath = resolve(folder, 'sinus-fill.json');
const sinusFill = existsSync(fillPath)
  ? (JSON.parse(readFileSync(fillPath, 'utf8')) as Record<string, { dimensions: number[]; count: number; deltas: number[] }>)
  : undefined;
const halves = new Uint16Array(payload.buffer, payload.byteOffset, payload.length / 2);
const boxes = info.boxes.map((b) => {
  const field = B.fields.find((f) => f.name === b.field);
  // La caja es el campo P1 del riñón sin su relleno: misma rejilla de 1,5 mm, así el vóxel nearest coincide.
  if (
    !field ||
    b.dimensions.some((n, k) => n !== field.dimensions[k] - 2 * b.nodeOffset[k]) ||
    b.originMm.some((v, k) => Math.abs(v - (field.originMm[k] + 1.5 * b.nodeOffset[k])) > 1e-9)
  )
    throw new Error('Caja fuera del campo P1 de ' + b.field);
  const voxels = b.dimensions[0] * b.dimensions[1] * b.dimensions[2];
  if (b.byteCount !== Math.ceil(voxels / 2) || b.pageCount !== Math.ceil(b.byteCount / 2048))
    throw new Error('Tamaño de caja inconsistente');
  // Vasos e interfaces del hilio que el exportador dejó U dentro de la componente del seno: contenido del seno, E.
  const fill = new Set<number>();
  const extra = sinusFill?.[b.side];
  if (extra) {
    if (extra.dimensions.join() !== b.dimensions.join() || extra.deltas.length !== extra.count)
      throw new Error('Relleno del seno de otra caja');
    let at = 0;
    for (const delta of extra.deltas) fill.add((at += delta));
  }
  let runs = '';
  let previous = -1;
  let length = 0;
  const flush = () => {
    if (length) runs += SYMBOL[previous] + (length > 1 ? length.toString(36) : '');
  };
  for (let i = 0; i < voxels; i++) {
    const byte = HALF[halves[b.pageBase * 2048 + (i >> 1)]];
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new Error('Half no entero');
    const source = (byte >> ((i & 1) << 2)) & 15;
    if (!(source in SYMBOL) || source === 13) throw new Error('Código de interior renal inválido: ' + source);
    if (fill.has(i) && source !== 0) throw new Error('El relleno del seno pisa un vóxel ya rotulado');
    const code = fill.has(i) ? 13 : source;
    if (code === previous) length++;
    else {
      flush();
      previous = code;
      length = 1;
    }
  }
  flush();
  return { side: b.side, originMm: b.originMm, dimensions: b.dimensions, pageBase: b.pageBase, byteCount: b.byteCount, runs };
});

// Páginas 32×32 libres del atlas abdominal: fuera de campos P1, EDT, teselas, centros y rampas P2 y de la grasa P3.
const [W, H, D] = B.abdominal.textureDimensions;
const used = new Uint8Array(W * H * D);
const free = (o: readonly number[], s: readonly number[]): boolean => {
  if (o[0] + s[0] > W || o[1] + s[1] > H || o[2] + s[2] > D) return false;
  for (let z = o[2]; z < o[2] + s[2]; z++)
    for (let y = o[1]; y < o[1] + s[1]; y++) for (let x = o[0]; x < o[0] + s[0]; x++) if (used[(z * H + y) * W + x]) return false;
  return true;
};
const occupy = (o: readonly number[], s: readonly number[], what: string) => {
  if (!free(o, s)) throw new Error('Solape o desborde en el atlas: ' + what);
  for (let z = o[2]; z < o[2] + s[2]; z++)
    for (let y = o[1]; y < o[1] + s[1]; y++) for (let x = o[0]; x < o[0] + s[0]; x++) used[(z * H + y) * W + x] = 1;
};
for (const f of B.fields) if (f.asset === 'abdominal') occupy(f.offset, f.dimensions, f.name);
occupy(B.depth.offset, B.depth.dimensions, 'depth');
B.wall.placements.forEach((o, i) => occupy(o, B.wall.tileSize, 'tesela ' + i));
occupy(B.wall.centerOffset, [1, 181, 1], 'centros');
occupy(B.wallDerived.ramps.placement, B.wallDerived.ramps.size, 'rampas');
s0028FatPages().forEach((o, i) => occupy(o, [32, 32, 1], 'grasa ' + i));
let pages = '';
let placed = 0;
for (let z = 0; z < D && placed < info.pageCount; z++)
  for (let y = 0; y < 8 && placed < info.pageCount; y++)
    for (let x = 0; x < 6 && placed < info.pageCount; x++) {
      const o = [32 * x, 32 * y, z];
      if (!free(o, [32, 32, 1])) continue;
      occupy(o, [32, 32, 1], 'interior renal');
      pages += (x + 6 * y + 48 * z).toString(36).padStart(3, '0');
      placed++;
    }
if (placed !== info.pageCount) throw new Error('El atlas abdominal no tiene páginas libres suficientes');

const header = (what: string) =>
  `/** Generado por tools/anatomy/install-s0028-renal-interior.ts. ${what} Corteza y médula E; seno graso y colector D; resto U. */\n`;
writeFileSync(
  'src/anatomy/s0028RenalInteriorData.ts',
  header('Cajas y páginas del interior renal s0028.') +
    'export const S0028_RENAL_INTERIOR = ' +
    JSON.stringify(
      {
        format: info.format,
        sourceSha256: sha256,
        sinusFillVoxels: boxes.map((b) => sinusFill?.[b.side]?.count ?? 0),
        boxes: boxes.map(({ side, originMm, dimensions, pageBase, byteCount }) => ({ side, originMm, dimensions, pageBase, byteCount })),
        pageCount: info.pageCount,
        pages,
      },
      null,
      2,
    ) +
    ' as const;\n',
);
writeFileSync(
  'src/anatomy/s0028RenalInteriorRuns.ts',
  header(
    'Códigos por tramos (xyz, z rápida): U, C corteza, M médula, F seno graso, P colector, S seno sin subclasificar; longitud en base 36.',
  ) +
    'export const S0028_RENAL_INTERIOR_RUNS = ' +
    JSON.stringify(boxes.map((b) => b.runs)) +
    ' as const;\n',
);
console.log(JSON.stringify({ sha256, pages: placed, runChars: boxes.map((b) => b.runs.length) }));
