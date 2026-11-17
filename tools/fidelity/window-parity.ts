/**
 * Discrepancias de tejido entre la CPU (`classifyWorld`) y la GPU (`gpuQuery`) en el plano de una ventana, sobre una rejilla
 * densa de líneas × muestras del sector: el acuerdo, la tabla de pares CPU→GPU y las primeras discrepancias con lo que hace
 * falta para encontrar la causa (punto del mundo, ángulo y profundidad, distancia al borde, dueños P3, capa de pared). La e2e de
 * equivalencia dice si hay paridad; esto dice dónde falla en la ventana que se está mirando. Con el servidor en marcha:
 *
 *   node --import tsx tools/fidelity/window-parity.ts 'http://localhost:6600/?person=s0028' portalSubcostal
 *   node --import tsx tools/fidelity/window-parity.ts 'http://localhost:6600/?person=s0028' hepatorenal --lines 96 --samples 160 --depth 120
 *
 * La GPU es la de la página: con Metal, la del equipo; sin GPU, SwiftShader (la línea de cabecera lo dice). Bloquea la página
 * unos segundos (lee la GPU de vuelta): es una herramienta, no algo que la aplicación haga por cuadro.
 */
import { parseArgs } from 'node:util';
import { UsageError, parseCount, runTool } from '../toolArgs';
import { pairTable, tissueName } from './windowGrid';
import { selectWindow, withWindowSession } from './windowSession';

const USAGE = `Uso: node --import tsx tools/fidelity/window-parity.ts <url> <ventana> [opciones]
  url           aplicación ya servida con los ganchos de prueba, p. ej. 'http://localhost:6600/?person=s0028'
  ventana       id del menú (subxiphoid, portalSubcostal, renal…)
  --lines N     líneas del sector (192)
  --samples N   muestras por línea (320)
  --depth MM    profundidad de la rejilla desde la cara de la sonda (160)
  --rows N      discrepancias que se detallan (40)`;

interface ParityOptions {
  lines: number;
  samples: number;
  depthMm: number;
  rows: number;
}

/** Corre en la página. Sin funciones con nombre dentro: `tsx` las envolvería con un ayudante que la página no tiene. */
function parityInPage({ lines, samples, depthMm, rows }: ParityOptions) {
  const sim = window.__vexusTest!.sim(),
    tr = sim.transducer,
    frame = sim.frame,
    n = lines * samples;
  const points = new Float32Array(n * 3);
  for (let v = 0; v < samples; v++)
    for (let u = 0; u < lines; u++) {
      const theta = -tr.halfSector + (2 * tr.halfSector * (u + 0.5)) / lines,
        rho = tr.curvatureRadius + ((v + 0.5) / samples) * depthMm;
      for (let a = 0; a < 3; a++)
        points[(v * lines + u) * 3 + a] =
          frame.curvatureCenter[a] + rho * (Math.cos(theta) * frame.axial[a] + Math.sin(theta) * frame.lateral[a]);
    }
  // La misma compresión de la sonda en los dos lados: la que ve la CPU.
  const gpu = sim.gpuQuery(points, frame, false, { compression: sim.anatomy.probeCompression ?? undefined });
  const regional = sim.scene.person.cpu.regional;
  const pairs: Record<string, number> = {};
  const detail: {
    world: number[];
    thetaRad: number;
    depthMm: number;
    cpu: number;
    gpu: number;
    boundaryMm: number;
    owners: string;
    wall: string;
    approximation: string;
    insideWallMm: number | null;
  }[] = [];
  let same = 0;
  for (let i = 0; i < n; i++) {
    const p: [number, number, number] = [points[3 * i], points[3 * i + 1], points[3 * i + 2]];
    const cpu = sim.anatomy.classifyWorld(p, sim.sample);
    const cpuTissue: number = cpu.tissue;
    if (cpuTissue === gpu.tissue[i]) {
      same++;
      continue;
    }
    const key = `${cpuTissue}>${gpu.tissue[i]}`;
    pairs[key] = (pairs[key] ?? 0) + 1;
    if (detail.length >= rows) continue;
    const insideWall = regional ? regional.s0028InsideWall(sim.anatomy.deformation.toMaterial(p, sim.sample.resp)) : null;
    detail.push({
      world: p.map((x) => Number(x.toFixed(2))),
      thetaRad: Number((-tr.halfSector + (2 * tr.halfSector * ((i % lines) + 0.5)) / lines).toFixed(4)),
      depthMm: Number((((Math.floor(i / lines) + 0.5) / samples) * depthMm).toFixed(1)),
      cpu: cpuTissue,
      gpu: gpu.tissue[i],
      boundaryMm: Number(cpu.boundaryDistance.toFixed(3)),
      owners: cpu.solids?.owners.map((owner) => `${owner.id}:${owner.d.toFixed(2)}`).join(',') ?? '',
      wall: cpu.wall ?? '',
      approximation: cpu.approximation ?? '',
      insideWallMm: insideWall === null ? null : Number(insideWall.toFixed(3)),
    });
  }
  return { n, same, pairs, detail };
}

await runTool(USAGE, async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      lines: { type: 'string', default: '192' },
      samples: { type: 'string', default: '320' },
      depth: { type: 'string', default: '160' },
      rows: { type: 'string', default: '40' },
    },
  });
  const [url, id] = positionals;
  if (!url || !id || positionals.length > 2) throw new UsageError('Se esperan dos argumentos: la URL y la ventana.');
  const options: ParityOptions = {
    lines: parseCount(values.lines, '--lines'),
    samples: parseCount(values.samples, '--samples'),
    depthMm: Number(values.depth),
    rows: parseCount(values.rows, '--rows', 0),
  };
  if (!(options.depthMm > 0)) throw new UsageError(`--depth: se espera un número mayor que 0 y llegó «${values.depth}»`);
  await withWindowSession(url, async (session) => {
    await selectWindow(session, id);
    const report = await session.page.evaluate(parityInPage, options);
    const different = report.n - report.same;
    console.log(
      `${id} (GPU: ${session.renderer}): ${options.lines} × ${options.samples} puntos hasta ${options.depthMm} mm, ` +
        `acuerdo de tejido CPU/GPU ${((100 * report.same) / report.n).toFixed(3)} % (${different} de ${report.n} distintos)`,
    );
    if (!different) return;
    console.log(
      `pares CPU→GPU: ${pairTable(report.pairs)
        .map((pair) => `${pair.cpu}→${pair.gpu} ${pair.count}`)
        .join(' · ')}`,
    );
    for (const row of report.detail) console.log(JSON.stringify({ ...row, cpu: tissueName(row.cpu), gpu: tissueName(row.gpu) }));
  });
});
