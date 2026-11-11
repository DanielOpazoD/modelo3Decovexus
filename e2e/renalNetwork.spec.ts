import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach } from './support';
checkAfterEach();
for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`renal network and parenchyma share CPU/GPU tissue (${caseId})`, async ({ page }, info) => {
    budget(180000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    await page.locator('[data-window="hepatorenal"]').click();
    await page.locator('#freeze').click();
    const result = await page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      const caliber = s.anatomy.caliberFor(s.sample);
      const selected = [];
      const counts: Record<number, number> = {};
      for (const k of [s.scene.kidneyRight, s.scene.kidneyLeft])
        for (let u = -52; u <= 52; u += 3)
          for (let v = -30; v <= 30; v += 3)
            for (let w = -27; w <= 27; w += 3) {
              const p = k.center.map((x, j) => x + u * k.u[j] + v * k.v[j] + w * k.w[j]) as [number, number, number];
              const c = s.scene.classify(p, caliber);
              // Keep near-boundary exclusions explicit: filtered atlas rounding is a separate known limitation.
              if (c.boundaryDistance <= 0.1) continue;
              selected.push({ p, c });
              counts[c.tissue] = (counts[c.tissue] ?? 0) + 1;
            }
      const world = selected.map(({ p }) => s.anatomy.deformation.toWorld(p, s.sample.resp));
      const gpu = s.gpuQuery(new Float32Array(world.flat()), s.frame, true);
      const differences = [];
      const surroundingInterfaces = [];
      for (let i = 0; i < selected.length; i++) {
        const c = s.anatomy.classifyWorld(world[i], s.sample);
        if (Number(c.tissue) !== gpu.tissue[i] || ([17, 18, 19, 25, 26].includes(c.tissue) && Number(c.interface) !== gpu.iface[i]))
          differences.push({ p: selected[i].p, cpu: [c.tissue, c.interface], gpu: [gpu.tissue[i], gpu.iface[i]] });
        if (![17, 18, 19, 25, 26].includes(c.tissue) && Number(c.interface) !== gpu.iface[i])
          surroundingInterfaces.push({ p: selected[i].p, cpu: c.interface, gpu: gpu.iface[i] });
      }
      const grid = Reflect.get(s.renderer, 'tubeGrid') as { pitch: number; data: Float32Array } | null;
      return {
        grid: grid ? { pitch: grid.pitch, bytes: grid.data.byteLength } : null,
        surroundingInterfaces,
        points: selected.length,
        counts,
        differences,
        errors: window.__vexusTest!.loggedErrors(),
      };
    });
    await info.attach('regional-parity.json', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.grid?.pitch).toBe(8);
    expect(result.grid!.bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(result.points).toBeGreaterThan(10000);
    for (const tissue of [17, 18, 19, 20]) expect(result.counts[tissue]).toBeGreaterThan(50);
    expect(result.differences).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(errors).toEqual([]);
  });
