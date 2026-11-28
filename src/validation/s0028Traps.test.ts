// @tier slow
import { beforeAll, describe, expect, it } from 'vitest';
import { loadS0028 } from '../../tools/anatomy/s0028Windows';
import {
  ABDOMINAL_HYPERTENSION,
  CIRRHOSIS_PULMONARY_HYPERTENSION,
  MECHANICAL_VENTILATION,
  SEVERE_CONGESTION,
  TRICUSPID_REGURGITATION,
} from '../cases';
import { prfFromNyquistCms } from '../core/units';
import type { CaptureResult } from '../doppler/capture';
import type { PatientState } from '../physiology/patientState';
import type { VesselId } from '../physiology/vessels';
import { CONVEX_C35 } from '../probe/probe';
import { classifyPortal, classifyVexusC } from '../vexus/classification';
import { measurePhysiologyTruth } from '../vexus/measurements';
import { acquire, openSession, placeGate, probeAt } from './support/studentChain';

/**
 * Los casos trampa (decisión 82) por la cadena del alumno en s0028, desde las ventanas del menú y en apnea. VSH y porta
 * a ±40 cm/s, con ±80 en la VSH de la PIA alta por aliasing. La renal se toma hasta el límite de profundidad, con ±40
 * en cirrosis para resolver la S pequeña. Hasta la decisión 395 la cirrosis daba 2: la renal, tomada a 57° del vaso,
 * salía bifásica con la verdad monofásica (S/D 0,23). Aquí la
 * renal debe dar la clase exacta de la verdad, sin la tolerancia de clase vecina junto al umbral.
 */
beforeAll(() => {
  loadS0028();
}, 60_000);

function examine(base: PatientState) {
  const session = openSession(base, 'apnea-expiratory');
  expect(session.scene.identity.person).toBe('s0028');
  const measure = <K extends 'hepatic' | 'portal' | 'renal'>(kind: K, window: string, vessels: VesselId[]): CaptureResult[K] => {
    const contact = probeAt(session, window as never);
    const best = placeGate(session, contact, vessels, { acoustic: false, maxDepthMm: 170 });
    expect(best, `${kind} sin vaso en ${window}`).not.toBeNull();
    const nyquistCms = kind === 'hepatic' && base === ABDOMINAL_HYPERTENSION ? 80 : 40;
    const requestedPrfHz =
      kind === 'renal' && base !== CIRRHOSIS_PULMONARY_HYPERTENSION ? 6000 : prfFromNyquistCms(nyquistCms, CONVEX_C35.f0Doppler);
    const prfHz = Math.min(requestedPrfHz, Math.floor((0.9 * 1_540_000) / (2 * best!.r)));
    const { captures } = acquire(session, contact, best!, kind, { prfHz, seconds: 8.5, gateMm: Math.min(4, 2 * best!.bd) });
    const m = captures.at(-1)?.m ?? null;
    expect(m, `${kind}: sin medida`).not.toBeNull();
    expect(m!.quality.issue, `${kind}: calidad`).toBeNull();
    return m!;
  };
  const hepatic = measure('hepatic', 'intercostal', ['hvRight']);
  const portal = measure('portal', 'portalSubcostal', ['pvTrunk']);
  const renal = measure('renal', 'renal', ['interlobarVein1', 'interlobarVein2', 'interlobarVein3']);
  const { engine } = session;
  return { truth: measurePhysiologyTruth(engine, { fromT: engine.clock.t - 10, toT: engine.clock.t }), hepatic, portal, renal };
}

describe('s0028: casos trampa y congestión grave por la cadena del alumno (decisiones 82 y 395)', () => {
  // Medido el 15-11-2026: PIA 0, IT 2, VM 1, cirrosis 3 (antes de la 395, 2) y grave 3, con la renal de la verdad en los cinco.
  for (const [base, expectedGrade] of [
    [ABDOMINAL_HYPERTENSION, 0],
    [TRICUSPID_REGURGITATION, 2],
    [MECHANICAL_VENTILATION, 1],
    [CIRRHOSIS_PULMONARY_HYPERTENSION, 3],
    [SEVERE_CONGESTION, 3],
  ] as const)
    it(`${base.label}: en apnea lo medido coincide con la verdad y da grado ${expectedGrade}`, () => {
      const { truth, hepatic, portal, renal } = examine(base);
      expect(hepatic.pattern).toBe(truth.hepaticPattern);
      expect(classifyPortal(portal.pulsatilityFraction) === 'severe').toBe(classifyPortal(truth.portalPF) === 'severe');
      expect(Math.abs(portal.pulsatilityFraction - truth.portalPF)).toBeLessThan(10);
      expect(renal.pattern).toBe(truth.renalPattern);
      const grade = classifyVexusC({
        ivcMaxDiameterMm: truth.ivcMaxMm,
        hepatic: hepatic.pattern,
        portalPulsatilityFraction: portal.pulsatilityFraction,
        renal: renal.pattern,
      });
      expect(grade.grade).toBe(expectedGrade);
    });
});
