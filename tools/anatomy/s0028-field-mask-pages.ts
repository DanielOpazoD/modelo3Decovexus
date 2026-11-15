/**
 * Rejilla y páginas del mapa de ocupación de los campos fuente de s0028 (decisión 400): celdas de 6 mm que cubren la unión de las
 * cajas de los 19 campos que lee la clasificación (con un nodo de margen) y, para ellas, páginas 32×32 RG16F libres del atlas
 * abdominal ya asignado (fuera de campos P1, EDT, pared P2, grasa P3, interior renal y grasa amplia). El contenido no se guarda:
 * se calcula al cargar a partir de los propios campos (`fieldMask.ts`). Se repite si cambia alguna de esas colocaciones.
 *
 *   node --import tsx tools/anatomy/s0028-field-mask-pages.ts
 *   npx prettier --write src/anatomy/s0028FieldMaskData.ts
 */
import { writeFileSync } from 'node:fs';
import { S0028_BUNDLE as B } from '../../src/anatomy/people/s0028/descriptor';
import { s0028FatPages, s0028RenalPages, s0028WideFatPages } from '../../src/anatomy/people/s0028/solidsData';
import { S0028_MASK_FIELDS } from '../../src/anatomy/people/s0028/fieldMaskFields';

const CELL_MM = 6;
const fields = S0028_MASK_FIELDS.map((name) => B.fields.find((f) => f.name === name)!);
if (fields.some((f) => !f || f.pitchMm !== 1.5)) throw new Error('Campo del mapa sin procedencia');
const lo = [0, 1, 2].map((k) => Math.min(...fields.map((f) => f.originMm[k])) - 1.5);
const hi = [0, 1, 2].map((k) => Math.max(...fields.map((f) => f.originMm[k] + (f.dimensions[k] - 1) * f.pitchMm)) + 1.5);
const dimensions = [0, 1, 2].map((k) => Math.ceil((hi[k] - lo[k]) / CELL_MM));
const cells = dimensions[0] * dimensions[1] * dimensions[2];
const pages = Math.ceil(cells / 1024);

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
s0028RenalPages().forEach((o, i) => occupy(o, [32, 32, 1], 'interior renal ' + i));
s0028WideFatPages().forEach((o, i) => occupy(o, [32, 32, 1], 'grasa amplia ' + i));
let placements = '';
let placed = 0;
for (let z = 0; z < D && placed < pages; z++)
  for (let y = 0; y < 8 && placed < pages; y++)
    for (let x = 0; x < 6 && placed < pages; x++) {
      const o = [32 * x, 32 * y, z];
      if (!free(o, [32, 32, 1])) continue;
      occupy(o, [32, 32, 1], 'mapa de campos');
      placements += (x + 6 * y + 48 * z).toString(36).padStart(3, '0');
      placed++;
    }
if (placed !== pages) throw new Error('El atlas abdominal no tiene páginas libres suficientes');
const data = { cellMm: CELL_MM, originMm: lo, dimensions, cells, pages: placements };
writeFileSync(
  'src/anatomy/s0028FieldMaskData.ts',
  '/** Generado por tools/anatomy/s0028-field-mask-pages.ts: rejilla y páginas del mapa de ocupación de campos (decisión 400). */\n' +
    'export const S0028_FIELD_MASK = ' +
    JSON.stringify(data, null, 2) +
    ' as const;\n',
);
console.log(JSON.stringify({ dimensions, cells, pages }));
