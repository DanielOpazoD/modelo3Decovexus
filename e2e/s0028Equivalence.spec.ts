import { expect, test } from '@playwright/test';
import { BOOT_MS, budget } from './support';

/**
 * Gate de equivalencia TS ↔ GLSL de s0028, el de `equivalence.spec.ts` sobre la persona que va a quedar sola (decisión 340):
 * antes de retirar `legacy`, que hoy es la que vigila el invariante 1 en su conjunto, s0028 necesita el suyo. Las diez poses de
 * cada caso (tejido lejos de bordes, vaso y velocidad), el volumen del tronco (exacto lejos de las caras, ≥ 1 mm) y la cáscara
 * de las caras. La proyección de pared parte de los mismos nodos de profundidad en ambos backends. Aquí se exige
 * lo mismo en Metal y en SwiftShader, y la misma cota que a `legacy`.
 */
const CASES = ['normal-adult', 'severe-congestion', 'af-moderate-congestion'] as const;

// Un caso por prueba, cada uno con su plazo: en SwiftShader local tardan 8–10 min por caso, casi todo en compilar los programas
// en su primer uso; en la CI, 46–59 s por caso (15-11-2026).
for (const id of CASES)
  test(`s0028 (${id}): la anatomía GLSL coincide con la TypeScript en tejido, vaso, velocidad y caras`, async ({ page }) => {
    budget(420_000);
    await page.goto('/?e2e=1&abdomen=s0028');
    await expect(page.locator('#status')).toContainText(/\d+ fps/, { timeout: BOOT_MS });
    await page.selectOption('#case-select', id);
    await expect.poll(() => page.evaluate(() => typeof window.__vexusTest?.equivalenceSweep), { timeout: 30_000 }).toBe('function');
    // El caso pedido es el vivo: si no carga, bootstrap conserva el anterior y el gate mediría otro paciente.
    await expect.poll(() => page.evaluate(() => window.__vexusTest!.sim().patient.id), { message: 'caso cargado' }).toBe(id);
    const report = await page.evaluate(() => window.__vexusTest!.equivalenceSweep());
    expect(report.map((r) => r.id)).toEqual([
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
      'splenorenal',
      'aortaSagittal',
    ]);
    for (const r of report) {
      const tag = `${id}/${r.id}: ${JSON.stringify(r)}`;
      expect(r.interiorAgreement, tag).toBeGreaterThanOrEqual(0.99);
      expect(r.vesselAgreement, tag).toBeGreaterThanOrEqual(0.98);
      expect(r.velocityP95RelErr, tag).toBeLessThanOrEqual(0.02);
    }
    // el gate tiene dientes: las ventanas vasculares contienen sangre que comparar (medido en el sano: 57–875 celdas)
    for (const w of ['subxiphoid', 'epigastric', 'intercostal', 'subcostal', 'portal', 'portalSubcostal', 'renal'])
      expect(report.find((r) => r.id === w)!.bloodCells, `${id}/${w}`).toBeGreaterThan(40);
    // Volumen: s0028 tiene más aire y pulmón que la otra persona; con 80 000 puntos pasan de 40 000 los interiores.
    const vol = await page.evaluate(() => window.__vexusTest!.volumeEquivalence(80_000));
    const vtag = `${id}/volumen: ${JSON.stringify(vol)}`;
    expect(vol.interiorPoints, vtag).toBeGreaterThan(40_000);
    expect(vol.tissueAgreement, vtag).toBe(1);
    for (const [tissue, min] of [
      ['Liver', 3000],
      ['Muscle', 2000],
      ['Fat', 2000],
      ['Myocardium', 300],
      ['Vertebra', 500],
      ['RenalCortex', 300],
      ['Spleen', 100],
      ['Pancreas', 50],
      ['Cartilage', 100],
      ['Psoas', 50],
    ] as const)
      expect(vol.byTissue[tissue] ?? 0, `${vtag} ${tissue}`).toBeGreaterThan(min);
    expect(vol.bloodPoints, vtag).toBeGreaterThan(300);
    expect(vol.vesselAgreement, vtag).toBe(1);
    expect(vol.velocityP95RelErr, vtag).toBeLessThan(1e-3);
    expect(vol.interfacePoints, vtag).toBeGreaterThan(300);
    expect(vol.interfaceAgreement, vtag).toBe(1);
    expect(vol.interfaceDistanceMaxErr, vtag).toBeLessThan(0.02);
    const shell = await page.evaluate(() => window.__vexusTest!.interfaceShell());
    const stag = `${id}/cáscara: ${JSON.stringify(shell)}`;
    expect(shell.points, stag).toBeGreaterThan(5000);
    // las caras de s0028: su pared (piel, Scarpa, fascia profunda, peritoneo), sus vísceras y vasos, costillas y cartílago
    for (const face of [
      'SkinFat',
      'Scarpa',
      'DeepFascia',
      'Peritoneum',
      'IvcLumen',
      'VeinLumen',
      'PortalLumen',
      'ArteryLumen',
      'LiverCapsule',
      'DiaphragmLiver',
      'RenalCapsule',
      'PancreasCapsule',
      'BowelLumen',
      'RibCortex',
      'Perichondrium',
    ])
      expect(shell.byInterface[face] ?? 0, stag).toBeGreaterThan(50);
    expect(shell.agreement, stag).toBeGreaterThanOrEqual(0.999);
    expect(shell.distanceMaxErr, stag).toBeLessThan(0.02);
    // Ningún catch ha informado a errorLog (invariante 6): un caso que falla en silencio no es un acuerdo.
    expect(await page.evaluate(() => window.__vexusTest!.loggedErrors()), id).toEqual([]);
  });
