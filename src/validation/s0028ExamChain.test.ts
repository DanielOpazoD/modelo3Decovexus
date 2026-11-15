// @tier slow
import { beforeAll, describe, expect, it } from 'vitest';
import { loadS0028 } from '../../tools/anatomy/s0028Windows';
import { buildVesselTree } from '../anatomy/vesselTree';
import { AF_MODERATE_CONGESTION, NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { prfFromNyquistCms } from '../core/units';
import type { CaptureResult } from '../doppler/capture';
import type { PatientState } from '../physiology/patientState';
import { CONVEX_C35 } from '../probe/probe';
import { classifyPortal, classifyVexusC } from '../vexus/classification';
import { measurePhysiologyTruth } from '../vexus/measurements';
import { AnatomyScene } from './support/legacyPerson/scene';
import { acquire, openSession, placeGate, probeAt } from './support/studentChain';

/**
 * La cadena del alumno de `examChain.test.ts` sobre s0028 (decisión 392): puerta PW desde sus propias ventanas → espectro →
 * medida → grado VExUS, con la misma técnica (suprahepática y porta a ±40 cm/s, renal hasta el límite de la profundidad).
 * Hasta la decisión 392 nadie la había pasado por esta persona: el área de flujo de sus suprahepáticas, la de su TAC (3,4 mm de
 * radio la derecha), hacía la VSH 2,7 veces más rápida que la del adulto de referencia; se plegaba a la escala de partida y la
 * congestión grave daba grado 2.
 */
beforeAll(() => {
  loadS0028();
}, 60_000);

const TERRITORIES = [
  { kind: 'hepatic', window: 'intercostal', vessels: ['hvRight'] },
  { kind: 'portal', window: 'portalTrunk', vessels: ['pvTrunk'] },
  { kind: 'renal', window: 'renal', vessels: ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'] },
] as const;

function examine(base: PatientState) {
  const session = openSession(base, 'apnea-expiratory');
  expect(session.scene.identity.person).toBe('s0028');
  const observed: Record<string, unknown> = {};
  for (const ter of TERRITORIES) {
    const contact = probeAt(session, ter.window);
    const best = placeGate(session, contact, [...ter.vessels], { acoustic: false, maxDepthMm: 170 });
    expect(best, `${base.id}: ${ter.kind} sin vaso en la ventana ${ter.window}`).not.toBeNull();
    const prfHz = Math.min(
      ter.kind === 'renal' ? 6000 : prfFromNyquistCms(40, CONVEX_C35.f0Doppler),
      Math.floor((0.9 * 1_540_000) / (2 * best!.r)),
    );
    const { captures } = acquire(session, contact, best!, ter.kind, { prfHz, seconds: 8.5, gateMm: Math.min(4, 2 * best!.bd) });
    observed[ter.kind] = captures.at(-1)?.m ?? null;
  }
  const { engine } = session;
  return {
    truth: measurePhysiologyTruth(engine, { fromT: engine.clock.t - 10, toT: engine.clock.t }),
    hepatic: observed.hepatic as CaptureResult['hepatic'] | null,
    portal: observed.portal as CaptureResult['portal'] | null,
    renal: observed.renal as CaptureResult['renal'] | null,
  };
}

describe('s0028: cadena completa del alumno desde sus ventanas (decisión 392)', () => {
  it('las suprahepáticas de s0028 fluyen con el área de referencia, no con la de su TAC', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const areas = scene.vesselAreas();
    // La referencia: el calibre basal de `vesselTree.ts` (desembocadura 8–10 mm, B.2) con que se calibró la fisiología.
    const reference = buildVesselTree(scene.kidneyRight, scene.kidneyLeft, true).vessels;
    for (const id of ['hvRight', 'hvMiddle', 'hvLeft', 'hvCommonTrunk'] as const) {
      const r = reference.find((v) => v.id === id && v.flowFactor === undefined)!.refRadius;
      expect(areas[id], id).toBeCloseTo(Math.PI * r * r, 6);
    }
    // Su TAC daba 3,4 mm de radio a la derecha (36 mm²); la referencia, 5,6 (99 mm²).
    expect(areas.hvRight).toBeGreaterThan(90);
  });

  for (const [base, expectedGrade] of [
    [NORMAL_ADULT, 0],
    [SEVERE_CONGESTION, 3],
    [AF_MODERATE_CONGESTION, 1],
  ] as const)
    it(`${base.label}: lo medido coincide con la verdad, sin plegado a la escala de partida, y da grado ${expectedGrade}`, () => {
      const { truth, hepatic, portal, renal } = examine(base);
      expect(hepatic, 'medición hepática').not.toBeNull();
      expect(portal, 'medición portal').not.toBeNull();
      expect(renal, 'medición renal').not.toBeNull();
      // Con el área del TAC la VSH del sano daba S 59 cm/s y «aliasing» a ±40 cm/s.
      expect(hepatic!.quality.issue, 'calidad hepática').toBeNull();
      expect(portal!.quality.issue, 'calidad portal').toBeNull();
      expect(renal!.quality.issue, 'calidad renal').toBeNull();
      expect(hepatic!.pattern).toBe(truth.hepaticPattern);
      expect(classifyPortal(portal!.pulsatilityFraction)).toBe(classifyPortal(truth.portalPF));
      expect(Math.abs(portal!.pulsatilityFraction - truth.portalPF)).toBeLessThan(8);
      // Misma tolerancia que `examChain`: a menos de 0,1 del umbral S = 30 % de D se acepta la clase vecina.
      const ratio = truth.rvS / truth.rvD;
      if (Math.abs(ratio - 0.3) < 0.1 && ['monophasic', 'biphasic'].includes(truth.renalPattern))
        expect(['monophasic', 'biphasic']).toContain(renal!.pattern);
      else expect(renal!.pattern).toBe(truth.renalPattern);
      const grade = classifyVexusC({
        ivcMaxDiameterMm: truth.ivcMaxMm,
        hepatic: hepatic!.pattern,
        portalPulsatilityFraction: portal!.pulsatilityFraction,
        renal: renal!.pattern,
      });
      expect(grade.status).toBe('complete');
      expect(grade.grade).toBe(expectedGrade);
      // VSH del sano en el rango publicado de la onda S (22–43 cm/s); medido el 15-11-2026: 22,2 (con el área del TAC, 58,6).
      if (base === NORMAL_ADULT) expect(hepatic!.sPeak).toBeLessThan(43);
    });

  // La otra ventana hepática del protocolo: la VSH media desde la subcostal. Con el área del TAC el sano se leía «grave» y la
  // congestión grave «leve», ambos con aliasing; con la de referencia, el patrón de la verdad en los tres casos.
  for (const base of [NORMAL_ADULT, SEVERE_CONGESTION, AF_MODERATE_CONGESTION])
    it(`${base.label}: la VSH media desde la subcostal, en apnea, da el patrón de la verdad sin plegado`, () => {
      const session = openSession(base, 'apnea-expiratory');
      const contact = probeAt(session, 'subcostal');
      const best = placeGate(session, contact, ['hvMiddle'], { acoustic: false, maxDepthMm: 170 })!;
      expect(best).not.toBeNull();
      const prfHz = Math.min(prfFromNyquistCms(40, CONVEX_C35.f0Doppler), Math.floor((0.9 * 1_540_000) / (2 * best.r)));
      const { captures } = acquire(session, contact, best, 'hepatic', { prfHz, seconds: 8.5, gateMm: Math.min(4, 2 * best.bd) });
      const m = captures.at(-1)?.m;
      const { engine } = session;
      const truth = measurePhysiologyTruth(engine, { fromT: engine.clock.t - 10, toT: engine.clock.t });
      expect(m?.quality.issue).toBeNull();
      expect(m?.pattern).toBe(truth.hepaticPattern);
    });

  // La porta desde la ventana del menú que la enseña en eje largo (la subcostal, decisión 386): `portalTrunk` es un preset de
  // calibración fuera del menú. En apnea, la PF de la verdad en los tres casos (medido el 15-11-2026: 18/13, 70/76, 36/36).
  for (const base of [NORMAL_ADULT, SEVERE_CONGESTION, AF_MODERATE_CONGESTION])
    it(`${base.label}: la PF portal desde la subcostal del menú, en apnea, coincide con la verdad`, () => {
      const session = openSession(base, 'apnea-expiratory');
      const contact = probeAt(session, 'portalSubcostal');
      const best = placeGate(session, contact, ['pvTrunk'], { acoustic: false, maxDepthMm: 170 })!;
      expect(best).not.toBeNull();
      const prfHz = Math.min(prfFromNyquistCms(40, CONVEX_C35.f0Doppler), Math.floor((0.9 * 1_540_000) / (2 * best.r)));
      const { captures } = acquire(session, contact, best, 'portal', { prfHz, seconds: 8.5, gateMm: Math.min(4, 2 * best.bd) });
      const m = captures.at(-1)?.m;
      const beats = m?.measuredBeats ?? [];
      expect(beats.length).toBeGreaterThan(0);
      const last = beats.at(-1)!;
      const truthPF = measurePhysiologyTruth(session.engine, { fromT: beats[0].tR - 1e-6, toT: last.tR + last.rr + 1e-6 }).portalPF;
      expect(m?.quality.issue).toBeNull();
      expect(classifyPortal(m!.pulsatilityFraction)).toBe(classifyPortal(truthPF));
      expect(Math.abs(m!.pulsatilityFraction - truthPF)).toBeLessThan(8);
    });
});
