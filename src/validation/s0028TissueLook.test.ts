import { expect, it } from 'vitest';
import { S0028_MUSCLE_BACKSCATTER, S0028_STRIATION_GLSL, S0028_STRIATION_KEPT_BACKSCATTER } from '../anatomy/gpu/s0028Wall.glsl';
import { INTERFACE_COUNT, Interface } from '../anatomy/interfaces';
import { S0028_INTERFACE_LOOK, S0028_TISSUE_LOOK } from '../anatomy/people/s0028/gpu';
import { Tissue, TISSUES } from '../anatomy/tissues';
import { interfaceUniforms } from '../ultrasound/interfaceEcho';
import { WALL_TEXTURE } from '../ultrasound/wallTexture';

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
  // El páncreas queda entre el hígado y la grasa que lo rodea: al menos 2 dB sobre el uno y 1 bajo la otra (decisión 367).
  expect(db(back(Tissue.Pancreas) / back(Tissue.Liver))).toBeGreaterThan(2);
  expect(db(back(Tissue.MesentericFat) / back(Tissue.Pancreas))).toBeGreaterThan(1);
  // El manguito periportal se ve a cualquier ángulo (decisión 357): al menos 6 dB sobre el hígado; la tabla común no cambia.
  expect(db(back(Tissue.VesselWallPortal) / back(Tissue.Liver))).toBeGreaterThan(6);
  expect(TISSUES[Tissue.VesselWallPortal].backscatter).toBe(2.6);
  expect(back(Tissue.VesselWallThin)).toBe(TISSUES[Tissue.VesselWallThin].backscatter);
  // La pared arterial es lo que distingue la aorta de la cava en eje corto: al menos 6 dB sobre el hígado y sobre la pared venosa
  // fina, que conserva su valor (decisión 370).
  expect(db(back(Tissue.ArteryWall) / back(Tissue.Liver))).toBeGreaterThan(6);
  expect(db(back(Tissue.ArteryWall) / back(Tissue.VesselWallThin))).toBeGreaterThan(6);
  // Solo aspecto: ningún tejido cambia de velocidad, densidad ni clase (gas, hueso).
  for (const row of Object.values(look))
    expect(Object.keys(row).every((k) => ['backscatter', 'speckleClump', 'attenuation'].includes(k))).toBe(true);
});

it('s0028: el músculo de la pared, más oscuro que su grasa y estriado; Scarpa, más tenue que las otras caras (decisión 390)', () => {
  // Criterio del responsable (14-11-2026): grasa y músculo tenían el mismo gris rayado y las caras de la pared brillaban igual.
  // La retrodispersión y la reflectividad son amplitudes: 20·log10.
  const ampDb = (ratio: number) => 20 * Math.log10(ratio);
  expect(ampDb(back(Tissue.Fat) / back(Tissue.Muscle))).toBeGreaterThan(8);
  // Las estrías conservan el brillo absoluto de la decisión 366 (fondo 0,24): solo baja el fondo entre ellas. El GLSL de s0028 sube
  // su peso con la ganancia común G: 1 + (G − 1)·k = 0,24·G / fondo.
  expect(back(Tissue.Muscle)).toBe(S0028_MUSCLE_BACKSCATTER);
  const ratio = (S0028_STRIATION_KEPT_BACKSCATTER / S0028_MUSCLE_BACKSCATTER).toFixed(4);
  expect(S0028_STRIATION_GLSL).toContain(`((${ratio}*WT_STRIA_GAIN-1.0)/(WT_STRIA_GAIN-1.0))*mask`);
  const gain = WALL_TEXTURE.striationBack / TISSUES[Tissue.Muscle].backscatter,
    boost = (Number(ratio) * gain - 1) / (gain - 1);
  expect(back(Tissue.Muscle) * (1 + (gain - 1) * boost)).toBeCloseTo(S0028_STRIATION_KEPT_BACKSCATTER * gain, 6);
  const own = interfaceUniforms(1, undefined, S0028_INTERFACE_LOOK),
    shared = interfaceUniforms(1),
    amplitude = (u: Float32Array, face: Interface) => u[4 * face];
  for (const face of [Interface.DeepFascia, Interface.Peritoneum])
    expect(ampDb(amplitude(own, face) / amplitude(own, Interface.Scarpa)), Interface[face]).toBeGreaterThan(12);
  // Control: con la tabla común Scarpa queda a menos de 7 dB de la fascia profunda.
  expect(ampDb(amplitude(shared, Interface.DeepFascia) / amplitude(shared, Interface.Scarpa))).toBeLessThan(7);
  // Solo cambian las caras con aspecto propio; el resto sube igual que en la otra persona.
  for (let face = 1; face < INTERFACE_COUNT; face++)
    if (!(face in S0028_INTERFACE_LOOK)) expect(own.subarray(4 * face, 4 * face + 4)).toEqual(shared.subarray(4 * face, 4 * face + 4));
});
