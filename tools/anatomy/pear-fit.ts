/**
 * Encaje de una pera vesicular candidata en s0028 antes de escribirla en `src/anatomy/people/s0028/gallbladder.ts`: volumen de
 * su luz, cuánto de la vesícula contraída del TAC (máscara `gallbladder`) queda dentro de ella y, en el volumen que ocuparía
 * (luz + pared + 1 mm), qué dueños P3 pisa, qué máscaras del TAC hay debajo y qué tubos cruza. Desde la raíz:
 *
 *   node --import tsx tools/anatomy/pear-fit.ts                                    # la pera vigente
 *   node --import tsx tools/anatomy/pear-fit.ts '[[-82.4,47.6,-102.9,10.5],[-70.9,39.8,-93.8,12],[-52,27,-79,4]]' --blend 6
 *   node --import tsx tools/anatomy/pear-fit.ts pera.json --step 0.5
 *
 * Los nodos van del fondo al cuello, `[x, y, z, r]` en mm del marco del modelo (x = izquierda del paciente), con el radio de la
 * luz. Los dueños P3 se leen con la pera vigente ya instalada (decisión 413): dentro de ella el hígado, el bazo, el páncreas, la
 * vejiga y el tubo digestivo le ceden y no figuran como dueños, así que su solape con la candidata sale como «gallbladder (pera
 * vigente)» y lo que el TAC tiene debajo se lee en la línea de máscaras, que no depende de la pera instalada. La vesícula del
 * TAC se cuenta en toda la caja de su campo, no solo junto a la candidata.
 */
import { parseArgs } from 'node:util';
import { Interface } from '../../src/anatomy/interfaces';
import { GALLBLADDER_WALL_MM, gallbladderPearSdf } from '../../src/anatomy/organs/gallbladder';
import { S0028_BUNDLE } from '../../src/anatomy/people/s0028/descriptor';
import { BASELINE_CALIBER } from '../../src/anatomy/scene';
import type { Vec3 } from '../../src/core/vec3';
import { UsageError, readJsonArgument, runTool } from '../toolArgs';
import { loadS0028 } from './s0028Windows';
import { parseNodes } from './tubeDesign';

const USAGE = `Uso: node --import tsx tools/anatomy/pear-fit.ts [nodos] [opciones]
  nodos        '[[x, y, z, r], …]' del fondo al cuello (mm, radio de la luz), como texto o como archivo JSON; sin ellos, la pera vigente
  --blend MM   radio de la unión suave entre tramos (el de la pera vigente)
  --step MM    paso de la rejilla de volumen (1)`;

/** Margen (mm) alrededor de la pared en el que un vecino cuenta como pisado. */
const CLEARANCE_MM = 1;
/** Holgura (mm) de la caja de la rejilla alrededor de los nodos: cubre la pared y el margen. */
const BOX_MARGIN_MM = 4;

/** Visita los nodos de una rejilla de `stepMm` entre dos esquinas. */
function eachGridPoint(lo: Vec3, hi: Vec3, stepMm: number, visit: (m: Vec3) => void): void {
  for (let x = lo[0]; x <= hi[0]; x += stepMm)
    for (let y = lo[1]; y <= hi[1]; y += stepMm) for (let z = lo[2]; z <= hi[2]; z += stepMm) visit([x, y, z]);
}

/** Volumen por nombre (ml) con el primer punto donde apareció cada uno. */
class Tally {
  readonly #ml = new Map<string, { ml: number; first: Vec3 }>();
  add(name: string, ml: number, at: Vec3): void {
    const row = this.#ml.get(name);
    if (row) row.ml += ml;
    else this.#ml.set(name, { ml, first: at });
  }
  toString(): string {
    const rows = [...this.#ml].sort((a, b) => b[1].ml - a[1].ml);
    if (!rows.length) return 'ninguno';
    return rows.map(([name, { ml, first }]) => `${name} ${ml.toFixed(2)} @(${first.map((x) => x.toFixed(0)).join(', ')})`).join(' | ');
  }
}

await runTool(USAGE, () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { blend: { type: 'string' }, step: { type: 'string', default: '1' } },
  });
  if (positionals.length > 1) throw new UsageError('Sobra un argumento: los nodos van en un solo JSON.');
  const stepMm = Number(values.step);
  if (!(stepMm > 0)) throw new UsageError(`--step: se espera un número mayor que 0 y llegó «${values.step}»`);

  const { scene } = loadS0028();
  const regional = scene.person.cpu.regional;
  if (!regional) throw new Error('La escena cargada no trae las consultas de s0028');
  const nodes = positionals[0] ? parseNodes(readJsonArgument(positionals[0], 'nodos'), 'nodos') : scene.gallbladder.nodes;
  const blendMm = values.blend === undefined ? scene.gallbladder.blendMm : Number(values.blend);
  if (!(blendMm > 0)) throw new UsageError(`--blend: se espera un número mayor que 0 y llegó «${values.blend}»`);
  const pear = { nodes, blendMm };
  const voxelMl = stepMm ** 3 / 1000;

  // La candidata: su luz y lo que hay en el volumen que ocuparía con su pared y el margen.
  const reach = GALLBLADDER_WALL_MM + CLEARANCE_MM;
  const corner = (side: -1 | 1): Vec3 =>
    [0, 1, 2].map((k) => (side < 0 ? Math.min : Math.max)(...nodes.map((n) => n.p[k] + side * n.r)) + side * BOX_MARGIN_MM) as Vec3;
  let lumenMl = 0;
  const owners = new Tally(),
    masks = new Tally(),
    tubes = new Tally();
  eachGridPoint(corner(-1), corner(1), stepMm, (m) => {
    const d = gallbladderPearSdf(m, pear);
    if (d >= reach) return;
    if (d < 0) lumenMl += voxelMl;
    for (const owner of regional.s0028Owners(m, regional.s0028WallAt(m)).owners)
      owners.add(owner.id === 'gallbladder' ? 'gallbladder (pera vigente)' : owner.id, voxelMl, m);
    for (const field of S0028_BUNDLE.fields) if (regional.s0028SourceValue(m, field.name).d < 0) masks.add(field.name, voxelMl, m);
    const tube = scene.classifyTubes(m, BASELINE_CALIBER);
    if (tube) tubes.add(tube.vessel ?? (tube.interface === Interface.DuctLumen ? 'vía biliar (luz o pared)' : 'pared de vaso'), voxelMl, m);
  });

  // La vesícula del TAC, en toda la caja de su campo: cuánta queda dentro de la luz de la candidata.
  const field = S0028_BUNDLE.fields.find((f) => f.name === 'gallbladder');
  if (!field) throw new Error('El descriptor de s0028 no trae el campo gallbladder');
  const origin = field.originMm as Vec3;
  const far = origin.map((x, k) => x + (field.dimensions[k] - 1) * field.pitchMm) as Vec3;
  let ctMl = 0,
    ctInsideMl = 0;
  eachGridPoint(origin, far, stepMm, (m) => {
    if (regional.s0028SourceValue(m, 'gallbladder').d >= 0) return;
    ctMl += voxelMl;
    if (gallbladderPearSdf(m, pear) < 0) ctInsideMl += voxelMl;
  });

  const inside = ctMl > 0 ? `${((100 * ctInsideMl) / ctMl).toFixed(0)} % dentro de la luz` : 'sin vóxeles en la rejilla';
  console.log(
    `pera de ${nodes.length} nodos (unión ${blendMm} mm, rejilla ${stepMm} mm): luz ${lumenMl.toFixed(1)} ml; ` +
      `vesícula del TAC ${ctMl.toFixed(1)} ml, ${inside}`,
  );
  const where = `en luz + pared + ${CLEARANCE_MM} mm, ml @(primer punto)`;
  console.log(`dueños P3 ${where}: ${owners.toString()}`);
  console.log(`máscaras del TAC ${where}: ${masks.toString()}`);
  console.log(`tubos ${where}: ${tubes.toString()}`);
});
