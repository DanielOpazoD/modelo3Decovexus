/**
 * Mapa de tejidos (CPU, `classifyWorld`) de una región del plano de una ventana, en caracteres: qué clasifica el modelo en cada
 * punto del sector, para leer una lámina del modo B con la anatomía al lado. Las columnas van como en la pantalla (la izquierda
 * es θ positivo, el lado del marcador) y las filas, de menos a más profundidad. Con el servidor en marcha:
 *
 *   node --import tsx tools/fidelity/tissue-map.ts 'http://localhost:6600/?person=s0028' portalSubcostal
 *   node --import tsx tools/fidelity/tissue-map.ts 'http://localhost:6600/?person=s0028' portalSubcostal --theta=-0.25:0.10 --depth=60:110 --cols 90 --rows 40
 *
 * θ en radianes desde el eje de la sonda y la profundidad en mm desde su cara, a lo largo de cada línea (las mismas coordenadas
 * de los `roi` de `tools/anatomy/s0028Windows.ts`). Sin `--theta` ni `--depth`, el sector entero hasta 160 mm.
 */
import { parseArgs } from 'node:util';
import { TISSUE_COUNT } from '../../src/anatomy/tissues';
import { UsageError, parseCount, parseRange, runTool } from '../toolArgs';
import { GLYPH_CAPACITY, renderTissueMap } from './windowGrid';
import { selectWindow, withWindowSession } from './windowSession';

const USAGE = `Uso: node --import tsx tools/fidelity/tissue-map.ts <url> <ventana> [opciones]
  url                   aplicación ya servida con los ganchos de prueba, p. ej. 'http://localhost:6600/?person=s0028'
  ventana               id del menú (subxiphoid, portalSubcostal, renal…)
  --theta=DESDE:HASTA   ángulos de la región, rad (el sector entero; el convexo abre ±0,593)
  --depth=DESDE:HASTA   profundidades de la región, mm desde la cara de la sonda (0:160)
  --cols N              columnas del mapa (70)
  --rows N              filas del mapa (30)`;

interface MapOptions {
  /** Ángulos de la primera y la última columna (rad); null: el sector entero. */
  theta: [number, number] | null;
  depthMm: [number, number];
  cols: number;
  rows: number;
}

/** Corre en la página. Sin funciones con nombre dentro: `tsx` las envolvería con un ayudante que la página no tiene. */
function mapInPage({ theta, depthMm, cols, rows }: MapOptions) {
  const sim = window.__vexusTest!.sim(),
    tr = sim.transducer,
    frame = sim.frame;
  // Como en la pantalla: θ positivo a la izquierda.
  const [left, right] = theta ? [theta[1], theta[0]] : [tr.halfSector, -tr.halfSector];
  const grid: number[][] = [];
  const notes: Record<number, string[]> = {};
  for (let j = 0; j < rows; j++) {
    const row: number[] = [];
    for (let i = 0; i < cols; i++) {
      const angle = left + ((right - left) * i) / Math.max(1, cols - 1),
        rho = tr.curvatureRadius + depthMm[0] + ((depthMm[1] - depthMm[0]) * j) / Math.max(1, rows - 1);
      const q = sim.anatomy.classifyWorld(
        [
          frame.curvatureCenter[0] + rho * (Math.cos(angle) * frame.axial[0] + Math.sin(angle) * frame.lateral[0]),
          frame.curvatureCenter[1] + rho * (Math.cos(angle) * frame.axial[1] + Math.sin(angle) * frame.lateral[1]),
          frame.curvatureCenter[2] + rho * (Math.cos(angle) * frame.axial[2] + Math.sin(angle) * frame.lateral[2]),
        ],
        sim.sample,
      );
      row.push(q.tissue);
      for (const note of [q.approximation, q.wall]) if (note && !(notes[q.tissue] ??= []).includes(note)) notes[q.tissue].push(note);
    }
    grid.push(row);
  }
  return { grid, notes, left, right };
}

await runTool(USAGE, async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      theta: { type: 'string' },
      depth: { type: 'string', default: '0:160' },
      cols: { type: 'string', default: '70' },
      rows: { type: 'string', default: '30' },
    },
  });
  const [url, id] = positionals;
  if (!url || !id || positionals.length > 2) throw new UsageError('Se esperan dos argumentos: la URL y la ventana.');
  if (TISSUE_COUNT > GLYPH_CAPACITY) throw new Error(`Hay ${TISSUE_COUNT} tejidos y el mapa solo tiene ${GLYPH_CAPACITY} caracteres`);
  const options: MapOptions = {
    theta: values.theta === undefined ? null : (parseRange(values.theta, '--theta', 2) as [number, number]),
    depthMm: parseRange(values.depth, '--depth', 2) as [number, number],
    cols: parseCount(values.cols, '--cols'),
    rows: parseCount(values.rows, '--rows'),
  };
  await withWindowSession(url, async (session) => {
    await selectWindow(session, id);
    const map = await session.page.evaluate(mapInPage, options);
    console.log(
      `${id}: tejido CPU; columnas de θ ${map.left.toFixed(3)} (izquierda de la pantalla) a ${map.right.toFixed(3)} rad, ` +
        `filas de ${options.depthMm[0]} a ${options.depthMm[1]} mm`,
    );
    console.log(renderTissueMap(map.grid, map.notes).join('\n'));
  });
});
