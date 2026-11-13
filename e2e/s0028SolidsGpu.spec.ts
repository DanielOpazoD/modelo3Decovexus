import { expect, test } from '@playwright/test';
import { Interface } from '../src/anatomy/interfaces';
import { S0028_BUNDLE as B } from '../src/anatomy/people/s0028/descriptor';
import { Tissue } from '../src/anatomy/tissues';
import conflicts from '../src/validation/fixtures/s0028-conflict-witnesses.json' with { type: 'json' };
import cysts from '../src/validation/fixtures/s0028-cyst-witnesses.json' with { type: 'json' };
import { bootWithoutErrors, budget } from './support';

/**
 * P3 r3 (decisión 321): la GPU clasifica los sólidos s0028 con la misma política que la CPU. Mismos puntos MATERIALES
 * (sin sonda y con D = 0, mundo = material; y con respiración y compresión en las ventanas): dueños, conflicto U, riñón
 * con el rótulo de su interior (decisión 341: corteza, médula, seno; sin rótulo, U) y su contorno O, quiste E, grasa D, U sin dueño. La lógica de la comparación vive aquí (no en el bundle): la
 * página sólo expone la simulación. Empate: coordenada a < 1e-5 vóxel de la mitad de celda de la rejilla común del TAC.
 */
interface Row {
  id: string;
  points: number;
  same: number;
  interior: number;
  interiorSame: number;
  renalCpu: number;
  renalBoth: number;
  ifdMax: number;
  normalMin: number;
  ties: number;
  analyticGpu: number;
  labelled: [number, number];
  classes: Record<string, [number, number]>;
  worst: string[];
}

/** Compartimentos de la arquitectura analítica de la otra persona: nunca en s0028. */
// La cápsula analítica de la otra persona. La grasa perirrenal dejó de contarse aquí: desde la decisión 351 es el material con que
// s0028 viste la grasa de su TAC junto al riñón, y su paridad la comprueban las aserciones de tejido de cada fila.
const ANALYTIC = [Tissue.RenalCapsule];
/** Tejidos del rótulo del interior renal s0028 (decisión 341). */
const LABELLED = [Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.RenalPelvis];
const field = (name: string) => B.fields.find((f) => f.name === name)!;
const ARGS = {
  kidneys: [field('kidneyRight'), field('kidneyLeft')].map((f) => ({ o: f.originMm, n: f.dimensions })),
  fat: B.solids.boxes.map((b) => ({ o: b.originMm, n: b.dimensions })),
  wide: { o: B.wideFat.originMm, n: B.wideFat.dimensions },
  conflicts: conflicts.points.flatMap((p) => p.slice(0, 3)),
  fatBand: conflicts.fatBand.flat(),
  cysts: cysts.cyst.flat(),
  lattice: B.fields[0].originMm,
  analytic: ANALYTIC.map(Number),
  labelled: LABELLED.map(Number),
  renal: Number(Interface.RenalCapsule),
  names: {
    tissue: Object.fromEntries(
      Object.entries(Tissue)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => [v, k]),
    ),
  },
};

test('la GPU s0028 clasifica los sólidos con la política P3 de la CPU: dueños, conflicto, riñón rotulado con contorno, grasa D', async ({
  page,
}) => {
  budget(600_000);
  const errors = await bootWithoutErrors(page, '?e2e=1&abdomen=s0028');
  const renderer = await page.evaluate(() => {
    const gl = window.__vexusTest!.sim().renderer.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
  });
  await test.info().attach('renderer', { body: renderer, contentType: 'text/plain' });
  if (process.env.VEXUS_GPU === 'metal') expect(renderer).toContain('Metal');
  const rows = await page.evaluate((a) => {
    const T = window.__vexusTest!;
    const sim = T.sim();
    const NO = {
      center: [0, 0, 0],
      radiusMm: 0,
      axial: [0, 0, 1],
      lateral: [1, 0, 0],
      halfAngle: 0.5,
      halfElevationMm: 0,
      plateMm: 0,
      nodes: Array.from({ length: 64 }, () => [0, 0, 1]),
      reachMm: 0,
      contact: [],
    } as unknown as NonNullable<typeof sim.anatomy.probeCompression>;
    const compare = (id: string, D: number, k: typeof NO, pts: number[], grid?: number): Row => {
      const n = pts.length / 3,
        sample = { ...sim.sample, resp: { ...sim.sample.resp, diaphragmCaudalMm: D } },
        saved = sim.anatomy.probeCompression;
      sim.anatomy.setProbeCompression(k);
      const gpu = sim.renderer.queryPoints(
        new Float32Array(pts),
        {
          sample,
          frame: sim.frame,
          pose: sim.pose,
          compression: k,
          transducer: sim.transducer,
          caliber: sim.anatomy.caliberFor(sample),
          probeVelocity: [0, 0, 0],
          bmode: sim.bmode,
          color: sim.color,
          updateColor: false,
          seed: sim.patient.seed,
        },
        k === NO,
        { normals: true },
      );
      const row: Row = {
        id: `${id} D=${D}`,
        points: n,
        same: 0,
        interior: 0,
        interiorSame: 0,
        renalCpu: 0,
        renalBoth: 0,
        ifdMax: 0,
        normalMin: 1,
        ties: 0,
        analyticGpu: 0,
        labelled: [0, 0],
        classes: {},
        worst: [],
      };
      const cpu: number[] = [];
      try {
        for (let i = 0; i < n; i++) {
          const c = sim.anatomy.classifyWorld([pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]], sample);
          const ct = Number(c.tissue),
            ci = Number(c.interface);
          cpu.push(ct);
          const s = c.solids,
            owner = s?.owners[0]?.id;
          const cls =
            s?.state === 'conflict'
              ? 'conflictU'
              : owner === 'kidney_right' || owner === 'kidney_left'
                ? 'kidneyU'
                : owner === 'kidney_cyst_left'
                  ? 'cystE'
                  : owner === 'compatible_fat'
                    ? 'fatD'
                    : s?.state === 'U'
                      ? 'noOwnerU'
                      : 'known';
          const r = (row.classes[cls] ??= [0, 0]);
          r[0]++;
          if (a.analytic.includes(gpu.tissue[i])) row.analyticGpu++;
          if (a.labelled.includes(ct)) {
            row.labelled[0]++;
            if (ct === gpu.tissue[i]) row.labelled[1]++;
          }
          if (ci === a.renal) {
            row.renalCpu++;
            if (gpu.iface[i] === a.renal && ct === gpu.tissue[i]) {
              row.renalBoth++;
              row.ifdMax = Math.max(row.ifdMax, Math.abs(c.interfaceDistance - gpu.ifd[i]));
              const g = sim.scene.faceGradient(c.material, sim.anatomy.caliberFor(sample));
              const gn = gpu.normal!;
              if (g && D === 0 && k === NO)
                row.normalMin = Math.min(
                  row.normalMin,
                  Math.abs(g.normal[0] * gn[3 * i] + g.normal[1] * gn[3 * i + 1] + g.normal[2] * gn[3 * i + 2]),
                );
            }
          }
          if (ct === gpu.tissue[i]) {
            r[1]++;
            row.same++;
            continue;
          }
          const tie = c.material.some((v, ax) => Math.abs((((((v - a.lattice[ax]) / 1.5) % 1) + 1) % 1) - 0.5) < 1e-5);
          if (tie) row.ties++;
          if (row.worst.length < 12)
            row.worst.push(
              `${[pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]].map((v) => v.toFixed(3)).join(',')} ${cls} CPU ${a.names.tissue[c.tissue]} GPU ${a.names.tissue[gpu.tissue[i]]}${tie ? ' empate' : ''}`,
            );
        }
      } finally {
        sim.anatomy.setProbeCompression(saved);
      }
      if (grid)
        for (let i = 0; i < n; i++) {
          const u = i % grid,
            v = Math.floor(i / grid);
          if (u === 0 || v === 0 || u === grid - 1 || v >= n / grid - 1) continue;
          if ([i - 1, i + 1, i - grid, i + grid].some((j) => cpu[j] !== cpu[i])) continue;
          row.interior++;
          if (cpu[i] === gpu.tissue[i]) row.interiorSame++;
        }
      return row;
    };
    const out: Row[] = [];
    // Puntos materiales junto al borde renal: nodos y genéricos (+0,3 mm) a ≤ 2,25 mm del borde O, un nodo de cada dos.
    for (const [ki, kb] of a.kidneys.entries())
      for (const h of [0, 0.3]) {
        const pts: number[] = [];
        for (let z = 0; z < kb.n[2]; z += 2)
          for (let y = 0; y < kb.n[1]; y += 2)
            for (let x = 0; x < kb.n[0]; x += 2) {
              const p: [number, number, number] = [kb.o[0] + 1.5 * x + h, kb.o[1] + 1.5 * y + h, kb.o[2] + 1.5 * z + h];
              const c = sim.scene.classify(p, sim.anatomy.caliberFor(sim.sample));
              if (c.solids && Math.abs(c.solids.kidneyMm) <= 2.25) pts.push(...p);
            }
        out.push(compare(`riñón ${ki ? 'I' : 'D'} ${h ? 'genéricos' : 'nodos'}`, 0, NO, pts));
      }
    // Cajas de grasa D: centros de vóxel cada cuatro, sin sonda.
    for (const [bi, b] of a.fat.entries()) {
      const pts: number[] = [];
      for (let z = 1; z < b.n[2] - 1; z += 4)
        for (let y = 1; y < b.n[1] - 1; y += 4)
          for (let x = 1; x < b.n[0] - 1; x += 4) pts.push(b.o[0] + 1.5 * x, b.o[1] + 1.5 * y, b.o[2] + 1.5 * z);
      out.push(compare(`grasa ${bi ? 'I' : 'D'}`, 0, NO, pts));
    }
    // Grasa del abdomen a 3 mm (decisión 343): un punto genérico dentro de una celda de cada tres, sin sonda. El desfase
    // lo aparta del centro de la celda, que cae en una mitad de celda de la rejilla de 1,5 mm.
    {
      const pts: number[] = [];
      for (let z = 1; z < a.wide.n[2] - 1; z += 3)
        for (let y = 1; y < a.wide.n[1] - 1; y += 3)
          for (let x = 1; x < a.wide.n[0] - 1; x += 3)
            pts.push(a.wide.o[0] + 3 * (x + 0.5) + 0.37, a.wide.o[1] + 3 * (y + 0.5) + 0.29, a.wide.o[2] + 3 * (z + 0.5) + 0.41);
      out.push(compare('grasa amplia', 0, NO, pts));
    }
    // Diafragma de la persona (decisión 348): los puntos que la CPU da como diafragma bajo la base del pulmón y, de control, el
    // punto 3 mm más abajo, sin sonda.
    {
      const pts: number[] = [],
        diaphragm = Number(Object.keys(a.names.tissue).find((id) => (a.names.tissue as Record<string, string>)[id] === 'Diaphragm'));
      for (let x = -110; x <= 100; x += 6)
        for (let y = -70; y <= 70; y += 6)
          for (let z = -80; z <= 40; z += 1.5)
            if (Number(sim.scene.classify([x + 0.31, y + 0.23, z + 0.17], sim.anatomy.caliberFor(sim.sample)).tissue) === diaphragm)
              pts.push(x + 0.31, y + 0.23, z + 0.17, x + 0.31, y + 0.23, z - 2.83);
      out.push(compare('diafragma', 0, NO, pts));
    }
    // Corazón de la persona (decisión 356): la caja de su máscara y la llegada de la cava, fuera de la rejilla del TAC.
    {
      const pts: number[] = [];
      for (let z = -16; z <= 104; z += 5)
        for (let y = -32; y <= 73; y += 5)
          for (let x = -47; x <= 84; x += 5) {
            // Solo la máscara y su entorno inmediato. En la grasa bajo la pared torácica anterior, a 40–50 mm de la piel, el filtro
            // del hardware (decisión 344) lleva la proyección a la celda vecina de la carta en 10 de 609 puntos en Metal: bordes
            // desplazados menos de una muestra de la imagen, que las filas de las ventanas ya acotan.
            const p: [number, number, number] = [x + 0.31, y + 0.23, z + 0.17];
            if (sim.scene.person.cpu.regional!.s0028SourceValue(p, 'heart').d < 4) pts.push(...p);
          }
      out.push(compare('corazón', 0, NO, pts));
    }
    // Testigos de conflicto (nueve pares del censo, fuera de las mitades de celda): U con los dos dueños, sin elegir material.
    out.push(compare('conflictos', 0, NO, a.conflicts));
    // La banda sola daría Fat en estos puntos; con grasa D superpuesta debe dar conflicto U.
    out.push(compare('conflictos grasa P2', 0, NO, a.fatBand));
    // El quiste es pequeño: los planos y las cajas gruesas no garantizan una clase E con suficientes muestras.
    out.push(compare('quiste E', 0, NO, a.cysts));
    // Tres planos por riñón (fuera de la rejilla del TAC), con respiración D = 0, 10 y 20 mm.
    for (const [ki, kb] of a.kidneys.entries()) {
      const c = kb.o.map((o, ax) => o + (1.5 * (kb.n[ax] - 1)) / 2 + [0.37, 0.29, 0.41][ax]);
      for (const [name, u, v] of [
        ['axial', [1, 0, 0], [0, 1, 0]],
        ['coronal', [1, 0, 0], [0, 0, 1]],
        ['sagital', [0, 1, 0], [0, 0, 1]],
      ] as const) {
        const pts: number[] = [],
          W = 61;
        for (let j = 0; j < W; j++)
          for (let i = 0; i < W; i++) {
            const s = -60 + 2 * i,
              t = -60 + 2 * j;
            pts.push(c[0] + s * u[0] + t * v[0], c[1] + s * u[1] + t * v[1], c[2] + s * u[2] + t * v[2]);
          }
        for (const D of [0, 10, 20]) out.push(compare(`riñón ${ki ? 'I' : 'D'} ${name}`, D, NO, pts, W));
      }
    }
    // Las diez ventanas: plano de imagen con la compresión del contacto de su pose y D = 0, 10 y 20 mm.
    for (const id of [
      'subxiphoid',
      'epigastric',
      'intercostal',
      'subcostal',
      'flank',
      'portal',
      'portalTrunk',
      'renal',
      'hepatorenal',
      'portalSubcostal',
    ] as const) {
      T.goToStartPoint(id);
      const k = sim.anatomy.probeCompression!,
        f = sim.frame,
        tr = sim.transducer,
        pts: number[] = [],
        W = 32;
      for (let v = 0; v < 48; v++)
        for (let u = 0; u < W; u++) {
          const th = -tr.halfSector + (2 * tr.halfSector * (u + 0.5)) / W,
            r = (160 * (v + 0.5)) / 48,
            d = [
              f.axial[0] * Math.cos(th) + f.lateral[0] * Math.sin(th),
              f.axial[1] * Math.cos(th) + f.lateral[1] * Math.sin(th),
              f.axial[2] * Math.cos(th) + f.lateral[2] * Math.sin(th),
            ],
            l = Math.hypot(d[0], d[1], d[2]),
            R = tr.curvatureRadius + r;
          pts.push(f.curvatureCenter[0] + (d[0] / l) * R, f.curvatureCenter[1] + (d[1] / l) * R, f.curvatureCenter[2] + (d[2] / l) * R);
        }
      for (const D of [0, 10, 20]) out.push(compare(id, D, k, pts, W));
    }
    return out;
  }, ARGS);
  await test.info().attach('paridad-solidos-s0028', { body: JSON.stringify(rows, null, 1), contentType: 'application/json' });
  const tag = (r: Row) => `${r.id}: ${JSON.stringify(r)}`;
  for (const [id, cls, count] of [
    ['quiste E D=0', 'cystE', cysts.cyst.length],
    ['conflictos grasa P2 D=0', 'conflictU', conflicts.fatBand.length],
  ] as const) {
    const r = rows.find((r) => r.id === id)!;
    expect(count, id).toBeGreaterThanOrEqual(20);
    expect(r.classes[cls], tag(r)).toEqual([count, count]);
  }
  for (const r of rows) {
    const still = r.id.endsWith('D=0');
    // Ningún compartimento renal analítico de la otra persona en la GPU s0028, y desacuerdo interior ≤ 0,5 % (P2).
    expect(r.analyticGpu, tag(r)).toBe(0);
    if (r.interior) expect(1 - r.interiorSame / r.interior, tag(r)).toBeLessThanOrEqual(0.005);
    // Sin respiración: cada clase P3 de la CPU con el mismo tejido en la GPU y el contorno con su distancia y su normal.
    // Con D = 10 y 20 mm la inversa respiratoria (la misma bisección en CPU y GPU) mueve fronteras ~1e-2 mm: sólo bordes.
    expect(r.points - r.same - r.ties, tag(r)).toBeLessThanOrEqual(Math.max(3, (still ? 0.005 : 0.01) * r.points));
    if (r.renalCpu >= 20) expect(r.renalBoth / r.renalCpu, tag(r)).toBeGreaterThanOrEqual(still ? 0.99 : 0.98);
    if (!still) continue;
    for (const cls of ['kidneyU', 'cystE', 'fatD', 'conflictU', 'noOwnerU'])
      // 1 % de la clase o dos puntos: en GPU nativa el filtro del hardware (decisión 344) mueve la proyección a la celda vecina
      // de la carta en algún punto suelto, y una clase pequeña no llega al 99 % por dos de ellos. En SwiftShader son cero.
      if (r.classes[cls]?.[0] >= 20)
        expect(r.classes[cls][0] - r.classes[cls][1], `${cls} ${tag(r)}`).toBeLessThanOrEqual(Math.max(2, 0.01 * r.classes[cls][0]));
    expect(r.ifdMax, tag(r)).toBeLessThan(1e-3);
    if (r.id.startsWith('riñón') && r.id.includes('nodos')) expect(r.normalMin, tag(r)).toBeGreaterThan(0.999);
  }
  // Cada clase se comprueba siempre: agrupar las filas de apnea evita que una clase escasa eluda la aserción.
  for (const cls of ['kidneyU', 'cystE', 'fatD', 'conflictU', 'noOwnerU']) {
    const still = rows.filter((r) => r.id.endsWith('D=0'));
    const count = still.reduce((s, r) => s + (r.classes[cls]?.[0] ?? 0), 0);
    const same = still.reduce((s, r) => s + (r.classes[cls]?.[1] ?? 0), 0);
    expect(count, cls).toBeGreaterThan(30);
    expect(same / count, cls).toBeGreaterThanOrEqual(0.99);
  }
  expect(rows.find((r) => r.id === 'conflictos D=0')!.classes.conflictU).toEqual([conflicts.points.length, conflicts.points.length]);
  expect(rows.reduce((s, r) => s + r.renalCpu, 0)).toBeGreaterThan(2000);
  // El diafragma de la persona llega a la GPU: cientos de puntos de la lámina bajo el pulmón, con sus controles.
  expect(rows.find((r) => r.id === 'diafragma D=0')!.points).toBeGreaterThan(400);
  // El corazón llega a la GPU: miles de puntos de su caja (sangre de las cavidades, miocardio, pulmón, cava) con el mismo tejido.
  const heart = rows.find((r) => r.id === 'corazón D=0')!;
  expect(heart.points, tag(heart)).toBeGreaterThan(3000);
  expect(heart.same / heart.points, tag(heart)).toBeGreaterThanOrEqual(0.99);
  // La grasa amplia llega a la GPU: miles de celdas de grasa D fuera de las cajas renales con el mismo tejido que la CPU.
  const wide = rows.find((r) => r.id === 'grasa amplia D=0')!;
  expect(wide.classes.fatD[0], tag(wide)).toBeGreaterThan(2000);
  expect(wide.classes.fatD[1] / wide.classes.fatD[0], tag(wide)).toBeGreaterThanOrEqual(0.99);
  // El rótulo del interior renal llega a la GPU: miles de puntos de corteza, médula y seno, con el mismo tejido que la CPU.
  const labelled = rows.filter((r) => r.id.endsWith('D=0')).reduce((s, r) => [s[0] + r.labelled[0], s[1] + r.labelled[1]], [0, 0]);
  expect(labelled[0]).toBeGreaterThan(3000);
  expect(labelled[1] / labelled[0]).toBeGreaterThanOrEqual(0.99);
  expect(errors).toEqual([]);
});
