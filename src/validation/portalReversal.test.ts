import { describe, expect, it } from 'vitest';
import { PORTAL_REVERSAL_CONGESTION, SEVERE_CONGESTION } from '../cases';
import { mmsToCms } from '../core/units';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient, type PatientState, type RespiratoryPattern } from '../physiology/patientState';
import { classifyPortal, classifyVexusC } from '../vexus/classification';
import { measurePhysiologyTruth } from '../vexus/measurements';
import { AnatomyScene } from './support/legacyPerson/scene';

/**
 * Congestión venosa grave con flujo portal invertido (decisión 394): la verdad del motor, en respiración tranquila y en apnea
 * espiratoria, como `traps.test.ts`. El control es el caso grave del que parte: la misma insuficiencia del VD sin la
 * insuficiencia tricuspídea libre ni la PAD de 22 mmHg deja la porta pulsátil pero sin invertirse.
 */
function observe(patient: PatientState, pattern: RespiratoryPattern) {
  const p = { ...clonePatient(patient), respiratoryPattern: pattern };
  const e = new PhysiologyEngine(p, new AnatomyScene(p).vesselAreas(), { historySeconds: 20 });
  let pvMin = Infinity,
    pvMax = -Infinity;
  while (e.clock.t < 18) {
    const s = e.step();
    if (s.t >= 6) [pvMin, pvMax] = [Math.min(pvMin, mmsToCms(s.velocities.pvTrunk)), Math.max(pvMax, mmsToCms(s.velocities.pvTrunk))];
  }
  const m = measurePhysiologyTruth(e, { fromT: 6, toT: 18 });
  const grade = classifyVexusC({
    ivcMaxDiameterMm: m.ivcMaxMm,
    hepatic: m.hepaticPattern,
    portalPulsatilityFraction: m.portalPF,
    renal: m.renalPattern,
  });
  return { m, pvMin, pvMax, grade, tag: `${patient.id}/${pattern}: ${JSON.stringify({ PF: m.portalPF, pvMin, pvMax, ivc: m.ivcMaxMm })}` };
}

describe('Congestión venosa grave con flujo portal invertido (decisión 394)', () => {
  for (const pattern of ['quiet', 'apnea-expiratory'] as const) {
    it(`${pattern}: la porta se invierte en sístole y el grado es 3 con los tres territorios graves`, () => {
      // Medido el 15-11-2026 (tranquila/apnea): PF 132/153 %, porta −15,6…29,6 / −14,8…27,1 cm/s, VCI 31,9/32,0 mm.
      const r = observe(PORTAL_REVERSAL_CONGESTION, pattern);
      expect(r.m.portalPF, r.tag).toBeGreaterThan(110);
      expect(r.pvMin, r.tag).toBeLessThan(-8);
      // Una inversión creíble: más IT o menos distensibilidad auricular la llevaban a −70 cm/s.
      expect(r.pvMin, r.tag).toBeGreaterThan(-30);
      expect(r.pvMax, r.tag).toBeGreaterThan(15);
      expect(classifyPortal(r.m.portalPF)).toBe('severe');
      expect(r.m.hepaticPattern, r.tag).toBe('severe');
      expect(r.m.renalPattern, r.tag).toBe('monophasic');
      expect(r.m.ivcMaxMm, r.tag).toBeGreaterThan(25);
      expect(r.grade.grade, r.tag).toBe(3);
      // Control: el caso grave del que parte no invierte la porta (PF 62/76 %, mínimo +3/+4 cm/s).
      const control = observe(SEVERE_CONGESTION, pattern);
      expect(control.m.portalPF, control.tag).toBeLessThan(100);
      expect(control.pvMin, control.tag).toBeGreaterThan(0);
    });
  }
});
