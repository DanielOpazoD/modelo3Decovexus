import { expect, test } from '@playwright/test';
import { tubeQuery } from '../src/anatomy/primitives';
import { bootWithoutErrors, budget, windowAcquired } from './support';

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`curved vascular walls retain CPU/GPU geometry (${caseId})`, async ({ page }, info) => {
    budget(120_000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    await page.selectOption('#case-select', caseId);
    await page.getByRole('button', { name: 'Apnea espiratoria', exact: true }).click();
    await page.locator('[data-window="subcostal"]').click();
    await windowAcquired(page, 'subcostal');
    await page.locator('#freeze').click();
    const result = await page.evaluate(() => {
      const sim = window.__vexusTest!.sim(),
        sample = sim.sample,
        cal = sim.anatomy.caliberFor(sample);
      const ids = [
        'hvCommonTrunk',
        'hvRight',
        'hvMiddle',
        'hvLeft',
        'hvRightAnterior',
        'hvRightPosterior',
        'hvMiddleTributary',
        'hvLeftTributary',
        'pvRightAnterior',
        'pvRightPosterior',
        'pvLeftLateral',
        'pvLeftMedial',
      ];
      const points: [number, number, number][] = [],
        counts: Record<string, number> = {};
      const outsideLiver: { id: string; center: [number, number, number]; hepatic: number }[] = [];
      for (const def of sim.scene.vessels.filter((v) => v.flowFactor === undefined && ids.includes(v.id))) {
        counts[def.id] = def.tube.nodes.length;
        for (let j = 1; j < def.tube.nodes.length; j++) {
          const a = def.tube.nodes[j - 1],
            b = def.tube.nodes[j];
          for (const t of [0.13, 0.47, 0.83]) {
            const center = a.p.map((x, k) => x + t * (b.p[k] - x)) as [number, number, number];
            const hepatic = sim.scene.liverBaseSdf(center);
            if (hepatic > 0) outsideLiver.push({ id: def.id, center, hepatic });
            const r = (a.r + t * (b.r - a.r)) * cal.radiusScale(def.id);
            for (const factor of [0.7, 0.93, 1.07, 1.3])
              for (let axis = 0; axis < 3; axis++)
                for (const sign of [-1, 1]) {
                  const m = [...center] as [number, number, number];
                  m[axis] += sign * r * factor;
                  // Preselect away from classification discontinuities BEFORE querying GPU.
                  const w = Float32Array.from(sim.anatomy.deformation.toWorld(m, sample.resp));
                  const c = sim.anatomy.classifyWorld([w[0], w[1], w[2]], sample);
                  if (Number(c.interface) >= 1 && Number(c.interface) <= 5 && c.interfaceDistance > 0.08 && c.boundaryDistance > 0.08)
                    points.push(m);
                }
          }
        }
      }
      const cava = (['ivcInfra', 'ivcSupra'] as const).map((id) => {
        const t = sim.scene.vesselById.get(id)!.tube;
        return {
          ...t,
          apScale: id === 'ivcSupra' ? (cal.ivcSupraApScale ?? cal.ivcApScale) : cal.ivcApScale,
          nodes: t.nodes.map((n) => ({ p: n.p, r: n.r * cal.radiusScale(id) })),
        };
      });
      const grid = (sim.renderer as unknown as { tubeGrid: { pitch: number; data: Float32Array } | null }).tubeGrid;
      return {
        grid: grid ? { pitch: grid.pitch, bytes: grid.data.byteLength } : null,
        counts,
        outsideLiver,
        cava,
        points,
        rows: window.__vexusTest!.corticalSamples(points).rows,
        gl: sim.renderer.gl.getError(),
      };
    });
    await info.attach('curved-walls.json', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.grid).not.toBeNull();
    expect(result.grid!.pitch).toBeLessThanOrEqual(32);
    expect(result.grid!.bytes).toBeLessThanOrEqual(256 * 2048 * 8);
    expect(Object.keys(result.counts)).toHaveLength(12);
    expect(Object.values(result.counts).every((n) => n === 9)).toBe(true);
    // In a junction the deepest winning tube may be hepatic even when it overlaps the cava.
    // Test actual containment, as hepaticContact does, rather than the winning identity.
    for (const p of result.outsideLiver)
      expect(Math.min(...result.cava.map((t) => tubeQuery(p.center, t).d)), `${p.id} fuera del hígado y cava`).toBeLessThan(0);
    expect(result.rows.length).toBeGreaterThan(500);
    let minDot = 1,
      maxDistance = 0,
      maxNormError = 0;
    for (const r of result.rows) {
      expect(r[7]).toBe(r[0]);
      expect(r[8]).toBe(r[1]);
      minDot = Math.min(minDot, r[3] * r[10] + r[4] * r[11] + r[5] * r[12]);
      maxDistance = Math.max(maxDistance, Math.abs(r[2] - r[9]));
      maxNormError = Math.max(maxNormError, Math.abs(r[6] - r[13]) / r[6]);
    }
    expect(minDot).toBeGreaterThan(0.99);
    expect(maxDistance).toBeLessThan(0.02);
    expect(maxNormError).toBeLessThan(0.01);
    expect(result.gl).toBe(0);
    expect(errors).toEqual([]);
    info.annotations.push({
      type: 'vascular-geometry',
      description: JSON.stringify({ samples: result.rows.length, minDot, maxDistance, maxNormError }),
    });
  });
