import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, windowAcquired } from './support';
import { Tissue } from '../src/anatomy/tissues';

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`hepatorenal colon acquires echoes without vascular flow, including probe movement (${caseId})`, async ({ page }, info) => {
    budget(120000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    await page.selectOption('#case-select', caseId);
    await page.getByRole('button', { name: 'Apnea espiratoria', exact: true }).click();
    await page.locator('[data-window="hepatorenal"]').click();
    await windowAcquired(page, 'hepatorenal');
    // Preserve the fixed colonic-content witness plane independently of the renal card's framing.
    await page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      s.setPose({ phi: 2.9, z: -123.9, yaw: 0.08, rock: 0.037, tilt: -0.431, lift: 0 });
      s.advance(s.physiology.clock.dt);
      s.advance(s.physiology.clock.dt);
      s.render();
    });
    const inspect = () =>
      page.evaluate(() => {
        const s = window.__vexusTest!.sim();
        s.advance(0);
        s.advance(0);
        s.render();
        const a = s.renderer.displayedAnatomy!,
          r = s.renderer,
          img = r.readDisplay();
        const points: number[] = [],
          levels: number[] = [],
          tissues: number[] = [];
        let flow = 0;
        for (let y = 0; y < img.height; y += 6)
          for (let x = 0; x < img.width; x += 6) {
            const b = r.pixelToBeam(x, y, s.transducer, s.bmode.depthMm);
            if (!b) continue;
            const p = a.frame.curvatureCenter.map(
              (v, i) =>
                v + (s.transducer.curvatureRadius + b.r) * (a.frame.axial[i] * Math.cos(b.theta) + a.frame.lateral[i] * Math.sin(b.theta)),
            ) as [number, number, number];
            const q = s.anatomy.classifyWorld(p, a.sample);
            // Interior witnesses exclude source-grid boundary rounding. No screenshot coordinate mask.
            if (q.tissue !== (40 as Tissue) || q.interfaceDistance < 2) continue;
            points.push(...p);
            tissues.push(q.tissue);
            levels.push(img.gray[y * img.width + x]);
            if (q.vessel || q.bloodVelocity || q.flowBasis) flow++;
          }
        const gpu = s.gpuQuery(new Float32Array(points), a.frame, true);
        levels.sort((a, b) => a - b);
        return {
          pose: { ...s.pose },
          samples: levels.length,
          median: levels[Math.floor(levels.length / 2)],
          flow,
          gpuTissues: [...new Set(gpu.tissue)],
          glError: r.gl.getError(),
        };
      });
    const reports = [await inspect()];
    for (const [name, field] of [
      ['Rotación', 'yaw'],
      ['Basculación', 'rock'],
      ['Inclinación', 'tilt'],
    ] as const) {
      const slider = page.getByRole('slider', { name, exact: true });
      // El panel refleja la pose con los cuadros de la aplicación, no al instante: con un runner lento el deslizador aún
      // mostraba un valor de la animación de la ventana (−7°) y la pose fijada arriba era otra (5°). Leer el «original» antes de
      // que el panel se ponga al día hacía fallar el regreso, que sí era correcto.
      await page.waitForFunction(
        ({ name, field }) => {
          const el = [...document.querySelectorAll<HTMLInputElement>('input[type=range]')].find((e) =>
            e.labels?.[0]?.textContent?.includes(name),
          );
          const degrees = (window.__vexusTest!.sim().pose[field] * 180) / Math.PI;
          return !!el && Math.abs(Number(el.value) - degrees) <= 0.5;
        },
        { name, field },
      );
      const original = Number(await slider.inputValue());
      await slider.focus();
      for (let i = 0; i < 3; i++) await slider.press('ArrowRight');
      await page.waitForFunction(
        ({ name, value }) => {
          const el = [...document.querySelectorAll<HTMLInputElement>('input[type=range]')].find((e) =>
            e.labels?.[0]?.textContent?.includes(name),
          );
          return !!el && Number(el.value) !== value;
        },
        { name, value: original },
      );
      reports.push(await inspect());
      for (let i = 0; i < 3; i++) await slider.press('ArrowLeft');
      expect(Number(await slider.inputValue())).toBeCloseTo(original, 8);
    }
    reports.push(await inspect());
    await info.attach('colonic-contents-movement.json', { body: JSON.stringify(reports, null, 2), contentType: 'application/json' });
    for (const r of reports) {
      expect(r.samples).toBeGreaterThan(30);
      expect(r.median).toBeGreaterThan(30); // Reject the previous clear-fluid cavity, not a clinical grey-level target.
      expect(r.flow).toBe(0);
      expect(r.gpuTissues).toEqual([Tissue.ColonicContents]);
      expect(r.glError).toBe(0);
    }
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('hepatorenal-colonic-contents.png') });
  });
