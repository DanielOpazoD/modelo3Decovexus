/**
 * Instala los troncos vasculares de s0028 (exportador `s0028-trunks.py`): escribe el módulo generado que lee
 * `people/s0028/vessels.ts`. No toca activos, texturas ni GLSL: los tubos llegan a la GPU como datos de escena.
 *
 *   python -I tools/anatomy/s0028-trunks.py <caso s0028> <carpeta>/trunks.json [carpeta del candidato P5 r1]
 *   node --import tsx tools/anatomy/install-s0028-trunks.ts <carpeta>/trunks.json
 *   npx prettier --write src/anatomy/s0028TrunksData.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { MAX_TUBE_SEGMENTS } from '../../src/anatomy/gpu/anatomy.glsl';
import { VESSEL_IDS } from '../../src/physiology/vessels';

const path = process.argv[2];
if (!path) throw new Error('Indicar trunks.json');
const source = JSON.parse(readFileSync(path, 'utf8')) as {
  format: string;
  person: string;
  vessels: Record<string, number[][]>;
  report: Record<string, { radiusMedianMm?: number; fitErrorMm?: number }>;
  witnesses: Record<string, number[][]>;
};
if (source.format !== 's0028-trunks-v1' || source.person !== 's0028') throw new Error('Troncos de otro formato o persona');
const ids = Object.keys(source.vessels);
const same = (a: number[], b: number[]) => a.slice(0, 3).every((x, k) => Math.abs(x - b[k]) < 1e-9);
for (const id of ids) {
  const nodes = source.vessels[id];
  if (!(VESSEL_IDS as readonly string[]).includes(id)) throw new Error('Vaso desconocido: ' + id);
  if (nodes.length < 2 || nodes.length > MAX_TUBE_SEGMENTS + 1) throw new Error('Nodos fuera del techo del tubo: ' + id);
  if (nodes.some((n) => n.length !== 4 || n.some((x) => !Number.isFinite(x)) || n[3] < 1)) throw new Error('Nodo inválido en ' + id);
  if (!((source.report[id].fitErrorMm ?? 9) <= 2)) throw new Error('El eje ajustado se aparta más de 2 mm del medido: ' + id);
}
// La media y la izquierda desembocan en el tronco común, que llega a la luz de la cava.
for (const id of ['hvMiddle', 'hvLeft'])
  if (!same(source.vessels[id].at(-1)!, source.vessels.hvCommonTrunk[0])) throw new Error(id + ' no llega al tronco común');
// El sistema portal es una sola máscara: sus tramos comparten extremos, en el sentido del flujo.
const v = source.vessels;
if (!same(v.portalSplenic.at(-1)!, v.pvTrunk[0]) || !same(v.pvTrunk.at(-1)!, v.pvRight[0]) || !same(v.pvTrunk.at(-1)!, v.pvLeft[0]))
  throw new Error('Los tramos portales no comparten sus extremos');
writeFileSync(
  'src/anatomy/s0028TrunksData.ts',
  '/** Generado por tools/anatomy/install-s0028-trunks.ts. Troncos de s0028 desde sus máscaras: radio de referencia y nodos x, y, z, r (mm LAS), en el sentido del flujo. */\n' +
    'export const S0028_TRUNKS = ' +
    JSON.stringify(Object.fromEntries(ids.map((id) => [id, [Math.round(source.report[id].radiusMedianMm! * 10) / 10, v[id]]]))) +
    ' as const;\n',
);
// Testigos de las máscaras, a más de 2,2 mm (porta) y 3 mm (aorta) de su borde: los lee la prueba, no la aplicación.
if (!(source.witnesses.portal?.length >= 100 && source.witnesses.aorta?.length >= 100 && source.witnesses.hepatic?.length >= 100))
  throw new Error('Faltan testigos de las máscaras o de las suprahepáticas (ejecutar el exportador con el candidato P5 r1)');
writeFileSync('src/validation/fixtures/s0028-trunk-witnesses.json', JSON.stringify(source.witnesses) + '\n');
console.log(JSON.stringify(Object.fromEntries(ids.map((id) => [id, v[id].length]))));
