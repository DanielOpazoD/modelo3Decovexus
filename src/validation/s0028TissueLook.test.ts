import { expect, it } from 'vitest';
import { S0028_TISSUE_LOOK } from '../anatomy/people/s0028/gpu';
import { Tissue, TISSUES } from '../anatomy/tissues';

const db = (power: number) => 10 * Math.log10(power);
const back = (t: Tissue) => (S0028_TISSUE_LOOK as Record<number, { backscatter?: number }>)[t]?.backscatter ?? TISSUES[t].backscatter;

it('s0028: la grasa visceral se distingue del hígado y del riñón, y el contenido digestivo no parece líquido ni hígado (decisión 355)', () => {
  // Lo que separa los órganos en la imagen es el contraste con la grasa que los rodea: al menos 4 dB sobre el hígado y 5 sobre la
  // corteza renal; el seno sigue siendo lo más brillante del riñón.
  for (const fat of [Tissue.PerirenalFat, Tissue.MesentericFat]) {
    expect(db(back(fat) / back(Tissue.Liver))).toBeGreaterThan(4);
    expect(db(back(fat) / back(Tissue.RenalCortex))).toBeGreaterThan(5);
    expect(back(fat)).toBeLessThan(back(Tissue.RenalSinus));
  }
  expect(back(Tissue.PerirenalFat)).toBeGreaterThan(back(Tissue.MesentericFat));
  // El panículo y la grasa preperitoneal conservan el material hipoecoico de la pared.
  expect(back(Tissue.Fat)).toBe(TISSUES[Tissue.Fat].backscatter);
  // Estómago y colon llenos: ecos propios (no anecoico como el líquido) y más atenuación que el hígado, que deja sombra detrás.
  const look = S0028_TISSUE_LOOK as Record<number, { backscatter?: number; attenuation?: number; speckleClump?: number }>;
  for (const content of [Tissue.GastricContents, Tissue.ColonicContents]) {
    expect(back(content)).toBeGreaterThan(20 * TISSUES[Tissue.Fluid].backscatter);
    expect(TISSUES[content].alpha1 * (look[content].attenuation ?? 1)).toBeGreaterThan(TISSUES[Tissue.Liver].alpha1);
  }
  expect(look[Tissue.GastricContents].speckleClump).toBeGreaterThan(TISSUES[Tissue.Liver].speckleClump ?? 0);
  // Solo aspecto: ningún tejido cambia de velocidad, densidad ni clase (gas, hueso).
  for (const row of Object.values(look))
    expect(Object.keys(row).every((k) => ['backscatter', 'speckleClump', 'attenuation'].includes(k))).toBe(true);
});
