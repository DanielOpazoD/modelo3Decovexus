/**
 * Comprobador de rutas de vasos y conductos de s0028 antes de escribirlas en el código: para cada tubo de la propuesta, el menor
 * hueco de pared con cada uno de los demás (vasos madre y vía biliar) y los milímetros de su eje dentro del tubo digestivo del
 * TAC; después, su hueco con un tubo de referencia a cada altura (por omisión el tronco portal a lo largo del ligamento
 * hepatoduodenal: la tríada). Un hueco negativo es un solape de paredes. Desde la raíz del repositorio:
 *
 *   node --import tsx tools/anatomy/tube-gaps.ts propuesta.json
 *   node --import tsx tools/anatomy/tube-gaps.ts --focus cbd,hepaticArtery          # la escena tal como está
 *   node --import tsx tools/anatomy/tube-gaps.ts propuesta.json --profile pvTrunk --z=-90:-60:3 --top 8
 *
 * La propuesta es `{ "<tubo>": [[x, y, z, r], …], … }` en mm del marco del modelo (x = izquierda del paciente), con los nodos
 * en el sentido del flujo; `<tubo>` es un id de la escena o una abreviatura (cha, ha, rhd, lhd). Las uniones (un extremo de un
 * tubo sobre el eje del otro) no cuentan a menos de `--junction` mm.
 */
import { parseArgs } from 'node:util';
import { UsageError, parseCount, parseRange, readJsonArgument, runTool } from '../toolArgs';
import { loadS0028 } from './s0028Windows';
import { axisAtZ, axisLengthWhere, designTubes, minWallGap, parseProposal, sampleAxis, tubeById, wallGapAt } from './tubeDesign';

const USAGE = `Uso: node --import tsx tools/anatomy/tube-gaps.ts [propuesta.json] [opciones]
  propuesta.json        { "<tubo>": [[x, y, z, r], …], … } en mm; ids de la escena o cha, ha, rhd, lhd. Sin ella, la escena actual.
  --focus a,b           tubos que se miden (por omisión, los de la propuesta; sin propuesta, pvTrunk)
  --top N               vecinos que se listan por tubo, de menor a mayor hueco (6)
  --junction MM         radio alrededor de una unión que no cuenta (8)
  --profile TUBO        tubo de referencia del perfil por alturas (pvTrunk)
  --z=DESDE:HASTA:PASO  alturas del perfil, mm (-90:-60:3: el ligamento hepatoduodenal de s0028)`;

/** Profundidad (mm) dentro de la máscara del tubo digestivo a partir de la cual el eje cuenta como dentro. */
const DIGESTIVE_INSIDE_MM = 1;

await runTool(USAGE, () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      focus: { type: 'string' },
      top: { type: 'string', default: '6' },
      junction: { type: 'string', default: '8' },
      profile: { type: 'string', default: 'pvTrunk' },
      z: { type: 'string', default: '-90:-60:3' },
    },
  });
  if (positionals.length > 1) throw new UsageError('Sobra un argumento: solo se admite una propuesta.');
  const top = parseCount(values.top, '--top'),
    junctionMm = Number(values.junction),
    [zFrom, zTo, zStep] = parseRange(values.z, '--z', 3);
  if (!(junctionMm >= 0)) throw new UsageError(`--junction: se espera un número ≥ 0 y llegó «${values.junction}»`);
  const proposal = positionals[0] ? parseProposal(readJsonArgument(positionals[0], 'propuesta')) : new Map<string, never>();

  const { scene } = loadS0028();
  const regional = scene.person.cpu.regional;
  if (!regional) throw new Error('La escena cargada no trae las consultas de s0028');
  const tubes = designTubes(scene, proposal);
  const axes = new Map(tubes.map((t) => [t.id, sampleAxis(t.tube.nodes)]));
  const axisOf = (id: string) => axes.get(id)!;
  const focus = (values.focus?.split(',') ?? (proposal.size ? [...proposal.keys()] : ['pvTrunk'])).map((id) => tubeById(tubes, id));
  const reference = tubeById(tubes, values.profile);
  const point = (p: readonly number[]) => `(${p.map((x) => x.toFixed(0)).join(', ')})`;

  for (const a of focus) {
    const gaps = tubes
      .filter((b) => b !== a)
      .flatMap((b) => {
        const gap = minWallGap(a, axisOf(a.id), b, axisOf(b.id), junctionMm);
        return gap ? [{ id: b.id, ...gap }] : [];
      })
      .sort((x, y) => x.gapMm - y.gapMm);
    const gutMm = axisLengthWhere(axisOf(a.id), (p) => regional.s0028SourceValue(p, 'digestiveTract').d < -DIGESTIVE_INSIDE_MM);
    const nearest = gaps.slice(0, top).map((g) => `${g.id} ${g.gapMm.toFixed(1)} @${point(g.at)}`);
    console.log(
      `${a.id}${a.proposed ? ' (propuesto)' : ''}: ${gutMm.toFixed(1)} mm de eje dentro del tubo digestivo | ` +
        `menor hueco de pared, mm @(x, y, z): ${nearest.join(' · ')}`,
    );
  }
  for (const a of focus) {
    if (a === reference) continue;
    const levels: string[] = [];
    for (let z = zFrom; z <= zTo + 1e-9; z += zStep)
      for (const s of axisAtZ(axisOf(a.id), z)) levels.push(`z${z.toFixed(0)} ${wallGapAt(a, s, reference).toFixed(1)}`);
    if (levels.length) console.log(`${a.id}: hueco de pared con ${reference.id} a cada altura, mm: ${levels.join(' · ')}`);
  }
});
