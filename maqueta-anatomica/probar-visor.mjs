import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const origin = process.env.MAQUETA_ORIGIN || 'http://127.0.0.1:4175';
const browser = await chromium.launch({
  args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
});
const results = [];
try {
  for (const [version, path] of [['102', 'base-102.html'], ['103', 'index.html']]) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${origin}/maqueta-anatomica/${path}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 180_000 });
    const info = await page.evaluate(() => {
      const gl = window.__renderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'no disponible',
        entities: window.DATA.inventory.entities.length,
        structures: window.DATA.types.length,
        cuts: window.DATA.cuts.length,
        size: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      };
    });
    assert.equal(info.structures, 166);
    assert.equal(info.cuts, 6);
    assert.deepEqual(info.size, [760, 560]);
    await page.locator('#cut').selectOption('4');
    assert.match(await page.locator('#cut-info').innerText(), /maqueta, no TAC/);
    await page.locator('canvas').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => window.__viewState.name), 'anterior');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    results.push({ version, ...info });
    await page.close();
  }
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally {
  await browser.close();
}
