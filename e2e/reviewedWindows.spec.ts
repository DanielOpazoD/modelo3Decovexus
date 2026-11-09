import { expect, test } from '@playwright/test';
import { captureBMode } from '../tools/fidelity/captureBMode';
import { bootWithoutErrors, budget, windowAcquired } from './support';

const groups = [
  ['subxiphoid', 'epigastric', 'intercostal', 'subcostal'],
  ['portal', 'portalSubcostal', 'renal', 'hepatorenal'],
] as const;
for (const caseId of ['normal-adult', 'severe-congestion'])
  for (const [group, windows] of groups.entries())
    test(`saved examination windows ${caseId}/${group}: actual cards, acquired pose and hepatic PW access`, async ({ page }, info) => {
      budget(240_000);
      const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
      await page.selectOption('#case-select', caseId);
      await page.getByRole('button', { name: 'Apnea espiratoria', exact: true }).click();
      for (const id of windows) {
        await page.locator(`[data-window="${id}"]`).click();
        await windowAcquired(page, id);
        if (id === 'intercostal' || id === 'subcostal') {
          expect(await page.evaluate((id) => window.__vexusTest!.placeGate([id === 'intercostal' ? 'hvRight' : 'hvMiddle']), id)).toBe(
            true,
          );
        }
        await page.locator('#freeze').click();
        const state = await page.evaluate(() => {
          const s = window.__vexusTest!.sim();
          return { frozen: s.frozen, requested: s.pose, acquired: s.renderer.displayedAnatomy!.pose, gl: s.renderer.gl.getError() };
        });
        expect(state.frozen).toBe(true);
        expect(state.acquired).toEqual(state.requested);
        expect(state.gl).toBe(0);
        await info.attach(`${id}-pose.json`, { body: JSON.stringify(state), contentType: 'application/json' });
        await captureBMode(page, info.outputPath(`${id}.png`));
        await page.locator('#freeze').click();
      }
      expect(errors).toEqual([]);
    });
