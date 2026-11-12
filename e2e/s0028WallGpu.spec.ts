import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';
import fixtures from '../src/validation/fixtures/s0028-wall-chart.json' with { type: 'json' };
import witnesses from '../src/validation/fixtures/s0028-solid-witnesses.json' with { type: 'json' };

test('la GPU s0028 conserva la banda D/E con identidad U y el panículo regional CPU', async ({ page }) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=1&abdomen=s0028');
  const rows = await page.evaluate((fixtures) => {
    const sim = window.__vexusTest!.sim();
    // Banda y panículo, y la regla directa a 20 y 60 mm: con celda D/E la consulta vale a cualquier profundidad.
    const points = fixtures.flatMap((f) => [f.point, ...[10, 20, 60].map((d) => f.skin.map((s, k) => s - d * f.normal[k]))]);
    const gpu = sim.gpuQuery(new Float32Array(points.flat()), sim.frame, false);
    return points.map((p, i) => ({
      p,
      cpu: Number(sim.anatomy.classifyWorld([p[0], p[1], p[2]], sim.sample).tissue),
      gpu: gpu.tissue[i],
    }));
  }, fixtures);
  expect(
    rows.every((row) => row.cpu === row.gpu),
    JSON.stringify(rows),
  ).toBe(true);
  // P3 r3: testigos en los sólidos (riñones U, quiste E, hígado, grasa D, conflictos y contorno renal a ±0,2–0,6 mm de su
  // borde O, sin tubos; scripts/solid-witnesses.mts): mismo tejido y misma cara en la GPU, con todos los tubos.
  const solids = await page.evaluate((w) => {
    const sim = window.__vexusTest!.sim();
    const points = Object.entries(w).flatMap(([kind, list]) => list.map((p) => ({ kind, p })));
    const gpu = sim.gpuQuery(new Float32Array(points.flatMap((x) => x.p)), sim.frame, true);
    return points.map(({ kind, p }, i) => {
      const c = sim.anatomy.classifyWorld([p[0], p[1], p[2]], sim.sample);
      return { kind, p, cpu: [Number(c.tissue), Number(c.interface)], gpu: [gpu.tissue[i], gpu.iface[i]] };
    });
  }, witnesses);
  expect(solids).toHaveLength(18);
  expect(
    solids.filter((r) => r.cpu[0] !== r.gpu[0] || r.cpu[1] !== r.gpu[1]),
    JSON.stringify(solids),
  ).toEqual([]);
  // Normales analíticas de las caras de pared: GPU frente a CPU con el contrato del banco de pared (smoke.spec).
  // La proyección a la piel deriva la EDT de 3 mm con siete lecturas filtradas por el hardware. SwiftShader filtra en
  // coma flotante y da la cara de la CPU (0 puntos distintos, cara a 0,0001 mm, norma 9e-6). Metal filtra con pesos de
  // 8 bits: en un M4 la cara se aparta 0,06 mm (p95) y hasta 0,23 mm a 30 mm de profundidad, y la epigástrica da
  // 1,2 % de puntos distintos y 0,014 de norma. Menos de un píxel de la imagen (decisión 344): cada backend lleva su cota.
  const renderer = await page.evaluate(() => {
    const gl = window.__vexusTest!.sim().renderer.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
  });
  await test.info().attach('renderer', { body: renderer, contentType: 'text/plain' });
  if (process.env.VEXUS_GPU === 'metal') expect(renderer).toContain('Metal');
  const exact = renderer.includes('SwiftShader');
  const normals = [];
  // Dos planos de muestra de la pared, anterior y lateral. La subcostal de s0028 (decisión 349) abanica mucho y cruza la pared
  // tan oblicua que en Metal el mismo ruido de filtro sube la norma p95 a 0,025: no es un plano de muestra estable.
  for (const startPoint of ['epigastric', 'hepatorenal'] as const) {
    const n = await page.evaluate((id) => window.__vexusTest!.wallNormals({ startPoint: id }), startPoint);
    const tag = `${startPoint} normales (${renderer}): ${JSON.stringify(n)}`;
    expect(n.points, tag).toBeGreaterThan(300);
    expect(n.mismatched / (n.points + n.mismatched), tag).toBeLessThan(exact ? 0.01 : 0.02);
    expect(n.p05, tag).toBeGreaterThan(0.98);
    expect(n.normErrP95, tag).toBeLessThan(exact ? 0.01 : 0.02);
    expect(n.ifdErrP95, tag).toBeLessThan(exact ? 0.001 : 0.1);
    normals.push({ startPoint, ...n });
  }
  await test.info().attach('normales-pared-s0028', { body: JSON.stringify(normals, null, 2), contentType: 'application/json' });
  // r2b-U: el peso respiratorio GLSL es el de la CPU en celdas D/E y en la rampa U por fila (una lectura filtrada).
  const resp = await page.evaluate(() => window.__vexusTest!.respirationParity());
  const respTag = `respiración: ${JSON.stringify(resp)}`;
  expect(resp.u, respTag).toBeGreaterThan(1000);
  expect(resp.movingU, respTag).toBeGreaterThan(300);
  if (exact) {
    expect(resp.p99WeightDiffU, respTag).toBeLessThan(0.005);
    expect(resp.maxWeightDiffU, respTag).toBeLessThan(0.05);
    expect(resp.maxWeightDiffKnown, respTag).toBeLessThan(0.05);
    expect(resp.maxGradientDiff, respTag).toBeLessThan(0.01);
  } else {
    // Metal (M4): a 45–60 mm de la piel el mismo filtro lleva la proyección de 9 de 3.264 puntos a otra celda de la carta
    // (peso hasta 0,92 distinto); el resto: p99 del peso 0,006 y del gradiente 0,059/mm. Un máximo no mide eso: se acota
    // la fracción de puntos aislados y los percentiles.
    expect(resp.weightOutliers / resp.points, respTag).toBeLessThan(0.01);
    expect(resp.p99WeightDiffU, respTag).toBeLessThan(0.02);
    expect(resp.p99GradientDiff, respTag).toBeLessThan(0.1);
  }
  await test.info().attach('respiracion-s0028', { body: JSON.stringify(resp, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
