import { test, expect } from '@playwright/test';
import { bootWithoutErrors } from './support';
test('GPU failure aborts boot and preserves evidence', async ({ page }, info) => {
  test.setTimeout(30_000);
  await page.route('**/*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<script>console.debug('[vexus:startup] {"stage":"ultrasound:gpu-failed","timeMs":1}')</script>`,
    }),
  );
  await expect(bootWithoutErrors(page, '?e2e=1&abdomen=s0028')).rejects.toThrow('ultrasound:gpu-failed');
  const attachment = info.attachments.find((a) => a.name === 'startup-stages');
  expect(attachment).toBeTruthy();
  expect(JSON.parse(attachment!.body!.toString())).toMatchObject({
    bootCompleted: false,
    lastObserved: { stage: 'ultrasound:gpu-failed' },
  });
});
