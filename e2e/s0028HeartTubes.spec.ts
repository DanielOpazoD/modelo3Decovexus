import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

/**
 * Los tubos que entran en el corazón de s0028 (decisión 398). Dentro de su máscara solo la cava se vuelve sangre de la aurícula,
 * sin pared (decisión 356); la aorta y las suprahepáticas conservan su pared y su luz, en la CPU y en la GPU. La regla de la cava
 * se añadía al GLSL tras un `if` de la cava sin llaves y valía para todo tubo: en la raíz aórtica la GPU daba sangre donde la
 * CPU daba pared. El gate de equivalencia no lo veía porque solo exige acuerdo a más de 1 mm de un borde; aquí, como en
 * `aortaPulse.spec.ts`, se exige junto a la pared: anillos al 50, 98, 102 y 116 % del radio en cada tramo de cada tubo.
 */
test('s0028: dentro del corazón solo la cava pierde la pared; aorta y suprahepáticas iguales en CPU y GPU', async ({ page }) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=1&abdomen=s0028');
  const result = await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    s.physiology.clock.pause();
    s.patient.respiratoryPattern = 'apnea-expiratory';
    while (s.sample.t < 12) s.physiology.step();
    const target = s.sample;
    const points: number[] = [];
    const where: string[] = [];
    for (const id of ['aorta', 'ivcSupra', 'hvRight', 'hvMiddle', 'hvLeft'] as const) {
      const vessel = s.scene.vesselById.get(id);
      if (!vessel) continue;
      const nodes = vessel.tube.nodes;
      for (let j = 0; j + 1 < nodes.length; j++)
        for (let k = 0; k < 24; k++)
          for (const relative of [0.5, 0.98, 1.02, 1.16]) {
            const p = nodes[j].p.map((v, i) => (v + nodes[j + 1].p[i]) / 2);
            const r = ((nodes[j].r + nodes[j + 1].r) / 2) * relative * (id === 'aorta' ? target.aortaRadiusScale : 1);
            const angle = (2 * Math.PI * k) / 24;
            const m: [number, number, number] = [p[0] + Math.cos(angle) * r, p[1] + Math.sin(angle) * r, p[2]];
            points.push(...s.anatomy.deformation.toWorld(m, target.resp));
            where.push(`${id}/${j}/${k}/${relative}`);
          }
    }
    const packed = new Float32Array(points);
    const gpu = s.gpuQuery(packed, s.frame, true);
    const mismatches: string[] = [];
    let heart = 0;
    for (let i = 0; i < where.length; i++) {
      const q = s.anatomy.classifyWorld([packed[3 * i], packed[3 * i + 1], packed[3 * i + 2]], target);
      const id = gpu.vessel[i] >= 0 ? s.scene.vessels[gpu.vessel[i]].id : null;
      if (q.solids?.owners[0]?.id === 'heart') heart++;
      if (Number(q.tissue) !== gpu.tissue[i] || q.vessel !== id)
        mismatches.push(`${where[i]}: CPU ${q.tissue}/${q.vessel} GPU ${gpu.tissue[i]}/${id}`);
    }
    return { points: where.length, heart, mismatches: mismatches.slice(0, 12), count: mismatches.length };
  });
  const tag = JSON.stringify(result);
  // el gate tiene dientes: hay puntos de tubo dentro de la máscara del corazón
  expect(result.heart, tag).toBeGreaterThan(20);
  expect(result.count, tag).toBe(0);
  expect(errors).toEqual([]);
});
