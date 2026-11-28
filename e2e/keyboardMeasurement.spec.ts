import { expect, test, type Page } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach } from './support';

checkAfterEach();

const live = (page: Page) =>
  page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    return { pose: s.pose, pw: { enabled: s.pw.enabled, theta: s.pw.theta, depthMm: s.pw.depthMm } };
  });

/**
 * El protocolo con el teclado (objetivo 6), sin ratón ni ganchos de posición: en vivo, las flechas sobre la imagen enfocada
 * llevan la puerta PW; en Medir, «VCI diámetro» pasa el foco a la imagen, flechas e Intro miden y el foco vuelve a la fila.
 */
test('la puerta PW y el calibrador de la VCI se colocan con el teclado sobre la imagen enfocada', async ({ page }) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=s0028');
  const image = page.locator('#overlay');

  // ↓ baja la puerta 1 mm; la imagen se queda la flecha y la sonda no se inclina
  await page.keyboard.press('p');
  await expect.poll(async () => (await live(page)).pw.enabled).toBe(true);
  await image.focus();
  const before = await live(page);
  await page.keyboard.press('ArrowDown');
  const after = await live(page);
  expect(after.pw.depthMm).toBeCloseTo(before.pw.depthMm + 1, 6);
  expect(after.pw.theta).toBe(before.pw.theta);
  expect(after.pose).toEqual(before.pose);
  await page.keyboard.press('2');

  const medir = page.getByRole('tab', { name: 'Medir', exact: true });
  await medir.focus();
  await page.keyboard.press('Enter');
  await expect(medir).toHaveAttribute('aria-selected', 'true');
  const row = page.getByRole('button', { name: 'VCI diámetro', exact: true });
  // Armada la herramienta, la tarjeta del calibrador sustituye al protocolo (la fila queda oculta y fuera del árbol
  // accesible): la salida se localiza por su fila en el DOM, no por el rol, para leerla también mientras se mide.
  const output = page
    .locator('.control.proto')
    .filter({ has: page.locator('button', { hasText: /^VCI diámetro$/ }) })
    .locator('output');
  const freeze = page.locator('#freeze');
  // Intro mantenida: la primera pulsación arma y pasa el foco a la imagen; su repetición no fija puntos. El primer punto
  // congela (decisión 429) y solo el segundo llega a Medir (435): sin punto fijado, la imagen sigue en vivo y sin medida.
  await row.focus();
  await page.keyboard.down('Enter');
  await expect(image).toBeFocused();
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(page.getByRole('heading', { name: 'Calibrador', exact: true })).toBeVisible();
  await expect(freeze).toHaveAttribute('aria-pressed', 'false');
  await expect(output).toHaveText('—');
  // A en el centro de la imagen (congela, 429), diez pasos de 1 mm y B en el mismo cuadro: mide y devuelve el foco a la fila
  await page.keyboard.press('Enter');
  await expect(freeze).toHaveAttribute('aria-pressed', 'true');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(output).toHaveText('10.0 mm');
  await expect(row).toBeFocused();
  // Esc tras el primer punto cancela sin medir, conserva la medida anterior (decisión 435) y también devuelve el foco
  await page.keyboard.press('Enter');
  await expect(image).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Calibrador', exact: true })).toBeHidden();
  await expect(output).toHaveText('10.0 mm');
  expect(errors).toEqual([]);
});
