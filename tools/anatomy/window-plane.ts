/**
 * Dónde caen los tubos de s0028 en el plano de imagen de una ventana: lateral (hacia el marcador, la izquierda de la pantalla),
 * profundidad desde la cara de la sonda apoyada y elevación (distancia al plano; el haz lo promedia con una σ de unos 1,8 mm
 * hacia los 10 cm, `SLICE_SIGMA_MM` de `s0028Windows.ts`). Sin `--lateral`, las coordenadas de cada nodo; con él, el eje
 * muestreado de cada grupo de tubos leído en esas posiciones laterales, para comparar a qué profundidad corre cada uno (la
 * tríada paralela de la subcostal portal). Desde la raíz:
 *
 *   node --import tsx tools/anatomy/window-plane.ts portalSubcostal pvTrunk,hepaticArtery,cbd
 *   node --import tsx tools/anatomy/window-plane.ts portalSubcostal pvTrunk+pvRight,hepaticArtery,cbd+rightHepaticDuct --lateral=-10:60:5
 *   node --import tsx tools/anatomy/window-plane.ts '{"phi":1.6,"z":-100,"yaw":-1.2,"rock":0.13,"tilt":0.15}' cbd --proposal propuesta.json
 *
 * La ventana es un id de `startPointsFor` para s0028 o una pose JSON (texto o archivo). La profundidad se mide desde la cara de
 * la sonda ya hundida en la pared (`probeContact`), como en la imagen. Un grupo `a+b` une los ejes de varios tubos en una línea.
 */
import { parseArgs } from 'node:util';
import { S0028_BUNDLE } from '../../src/anatomy/people/s0028/descriptor';
import { startPointsFor } from '../../src/app/startPoints';
import { probeContact } from '../../src/probe/contact';
import { CONVEX_C35 } from '../../src/probe/probe';
import { UsageError, parseRange, readJsonArgument, runTool } from '../toolArgs';
import { loadS0028 } from './s0028Windows';
import { atLateral, designTubes, parseProposal, planeCoordinates, resolvePose, sampleAxis, tubeById } from './tubeDesign';

const USAGE = `Uso: node --import tsx tools/anatomy/window-plane.ts <ventana | pose> <tubos> [opciones]
  ventana | pose              id de una ventana de s0028 (portalSubcostal, subxiphoid, renal…) o una pose JSON
                              { "phi", "z", "yaw", "rock"?, "tilt"?, "lift"? } como texto o como archivo
  tubos                       ids separados por comas; a+b une varios tubos en una línea (pvTrunk+pvRight,hepaticArtery)
  --lateral=DESDE:HASTA:PASO  lee el eje muestreado en esas posiciones laterales, mm (sin la opción, los nodos)
  --proposal propuesta.json   nodos propuestos { "<tubo>": [[x, y, z, r], …] } en lugar de los de la escena`;

await runTool(USAGE, () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { lateral: { type: 'string' }, proposal: { type: 'string' } },
  });
  if (positionals.length !== 2) throw new UsageError('Se esperan dos argumentos: la ventana (o una pose) y los tubos.');
  const lateral = values.lateral === undefined ? null : parseRange(values.lateral, '--lateral', 3);
  const proposal = values.proposal ? parseProposal(readJsonArgument(values.proposal, 'propuesta')) : undefined;

  const { scene } = loadS0028();
  const { label, pose } = resolvePose(positionals[0], startPointsFor(scene.torso, S0028_BUNDLE));
  const tubes = designTubes(scene, proposal);
  const groups = positionals[1].split(',').map((group) => group.split('+').map((id) => tubeById(tubes, id)));
  const contact = probeContact(pose, CONVEX_C35, scene.torso);
  console.log(`${label}: pose ${JSON.stringify(pose)}; sonda hundida ${contact.summary.indentMm.toFixed(1)} mm`);

  if (!lateral) {
    console.log('nodos: (lateral, profundidad, elevación) en mm y radio');
    for (const tube of groups.flat()) {
      const nodes = tube.tube.nodes.map((n) => {
        const q = planeCoordinates(n.p, contact.frame);
        return `(${q.lateralMm.toFixed(0)}, ${q.depthMm.toFixed(0)}, ${q.elevationMm.toFixed(1)}) r${n.r.toFixed(1)}`;
      });
      console.log(`${tube.id}${tube.proposed ? ' (propuesto)' : ''}: ${nodes.join(' · ')}`);
    }
    return;
  }
  const lines = groups.map((group) => ({
    name: group.map((t) => t.id).join('+'),
    points: group.flatMap((t) => sampleAxis(t.tube.nodes).map((s) => planeCoordinates(s.p, contact.frame))),
  }));
  const width = Math.max(18, ...lines.map((l) => l.name.length + 2));
  console.log('eje muestreado: profundidad y elevación (mm) en cada posición lateral; — fuera del recorrido del tubo');
  console.log('lateral'.padEnd(9) + lines.map((l) => l.name.padEnd(width)).join(''));
  for (let at = lateral[0]; at <= lateral[1] + 1e-9; at += lateral[2]) {
    const cells = lines.map((l) => {
      const q = atLateral(l.points, at);
      return (q ? `${q.depthMm.toFixed(1)}, ${q.elevationMm.toFixed(1)}` : '—').padEnd(width);
    });
    console.log(String(Number(at.toFixed(3))).padEnd(9) + cells.join(''));
  }
});
