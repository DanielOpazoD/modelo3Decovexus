import { describe, expect, it } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { SampleVolumeIQ, particleAmplitudeScale, type GateGeometry } from '../doppler/sampleVolume';
import { PhysiologyEngine } from '../physiology/engine';
import { AnatomyScene } from './support/legacyPerson/scene';

function phantom(radius: number, sigma = 1) {
  const scene = new AnatomyScene(NORMAL_ADULT),
    anatomy = new AnatomyQuery(scene);
  const base = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas()).sample;
  // Same vessel identity and patient in every test; only numerical geometry changes.
  for (const n of scene.vesselById.get('hvRight')!.tube.nodes) n.r = radius;
  const template = anatomy.classifyWorld([0, 0, 0], base);
  // El volumen de muestra clasifica puntos materiales (decisión 294); `classifyWorld` también pasa por aquí.
  anatomy.classifyMaterial = (p) => ({
    ...template,
    tissue: Tissue.Blood,
    vessel: 'hvRight',
    material: p,
    bloodVelocity: [0, 0, 10],
    flowBasis: [0, 0, 1],
    tissueVelocity: [0, 0, 0],
  });
  const iq = new SampleVolumeIQ(anatomy, 19);
  const gate: GateGeometry = {
    center: [0, 0, 0],
    beamDir: [0, 0, -1],
    lateral: [1, 0, 0],
    elevation: [0, 1, 0],
    lengthMm: 4,
    lateralSigmaMm: sigma,
    elevationSigmaMm: 1,
    pulseSigmaMm: 0.3,
    transmission: 1,
  };
  iq.setGate(gate, base);
  return { iq, scene, gate, base };
}

describe('refinamiento numérico PW por geometría, no por diagnóstico', () => {
  it('conserva 320 partículas en un lumen grande respecto al haz', () => {
    expect(phantom(5).iq.particleCount).toBe(320);
  });
  it('refina a 1280 un lumen pequeño con la misma identidad suprahepática', () => {
    expect(phantom(0.7).iq.particleCount).toBe(1280);
  });
  it('compara el calibre con el haz: una puerta más estrecha puede necesitar menos refinamiento', () => {
    expect(phantom(0.7, 0.2).iq.particleCount).toBe(320);
  });
  it('mantiene la población entre pulsos y la reevalúa al recolocar la puerta', () => {
    const { iq, scene, gate, base } = phantom(0.7);
    for (const n of scene.vesselById.get('hvRight')!.tube.nodes) n.r = 5;
    iq.setGate(gate, base);
    expect(iq.particleCount).toBe(1280);
    iq.setGate({ ...gate, center: [10, 0, 0] }, base);
    expect(iq.particleCount).toBe(320);
  });
});

it('dirige el refinamiento a la sangre del vaso pequeño: sus extras van en ella y su peso en la puerta no cambia (decisión 403)', () => {
  // Media caja lateral con una suprahepática y la otra media con el tronco portal (5 mm); la suprahepática, fina (0,7 mm) o no.
  const twoVessels = (hvRadius: number) => {
    const scene = new AnatomyScene(NORMAL_ADULT),
      anatomy = new AnatomyQuery(scene);
    const base = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas()).sample;
    for (const n of scene.vesselById.get('hvRight')!.tube.nodes) n.r = hvRadius;
    const template = anatomy.classifyWorld([0, 0, 0], base);
    anatomy.classifyMaterial = (p) => ({
      ...template,
      tissue: Tissue.Blood,
      vessel: p[0] > 0 ? 'hvRight' : 'pvTrunk',
      material: p,
      bloodVelocity: [0, 0, 10],
      flowBasis: [0, 0, 1],
      tissueVelocity: [0, 0, 0],
    });
    const iq = new SampleVolumeIQ(anatomy, 19);
    iq.setGate(
      {
        center: [0, 0, 0],
        beamDir: [0, 0, -1],
        lateral: [1, 0, 0],
        elevation: [0, 1, 0],
        lengthMm: 4,
        lateralSigmaMm: 1,
        elevationSigmaMm: 1,
        pulseSigmaMm: 0.3,
        transmission: 1,
      },
      base,
    );
    return iq;
  };
  const fine = twoVessels(0.7),
    wide = twoVessels(5);
  expect([...fine.refinedVessels]).toEqual(['hvRight']);
  expect(wide.refinedVessels.size).toBe(0);
  // los extras, solo en la sangre de la fina (≈ la mitad de las 960 siembras), no en la caja entera
  expect(fine.particleCount).toBeGreaterThan(320 + 300);
  expect(fine.particleCount).toBeLessThan(320 + 700);
  expect(fine.extrasInRefinedBlood).toBe(true);
  // misma población inicial: el peso de cada vaso en la puerta, en esperanza, el de sin refinar
  for (const id of ['hvRight', 'pvTrunk'] as const) {
    const a = fine.lastComposition.vessels[id]!,
      b = wide.lastComposition.vessels[id]!;
    expect(Math.abs(a - b) / b, id).toBeLessThan(0.15);
  }
});

it('conserva la potencia incoherente esperada al refinar, sin multiplicar el ruido del receptor', () => {
  for (const n of [320, 640, 960, 1280, 2560]) expect(n * particleAmplitudeScale(n) ** 2).toBeCloseTo(320, 10);
  expect(particleAmplitudeScale(320)).toBe(1);
  expect(particleAmplitudeScale(1280)).toBe(0.5);
  expect(() => particleAmplitudeScale(0)).toThrow(RangeError);
});
