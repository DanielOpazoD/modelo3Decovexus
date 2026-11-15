// @tier slow
import { beforeAll, expect, it } from 'vitest';
import { loadS0028 } from '../../tools/anatomy/s0028Windows';
import { PORTAL_REVERSAL_CONGESTION } from '../cases';
import { prfFromNyquistCms } from '../core/units';
import type { CaptureResult } from '../doppler/capture';
import type { VesselId } from '../physiology/vessels';
import { CONVEX_C35 } from '../probe/probe';
import { classifyPortal, classifyVexusC } from '../vexus/classification';
import { measurePhysiologyTruth } from '../vexus/measurements';
import { acquire, openSession, placeGate, probeAt } from './support/studentChain';

/**
 * La congestión con flujo portal invertido (decisión 394) por la cadena del alumno en s0028, desde las ventanas del menú y a la
 * escala de partida (±40 cm/s; la renal hasta el límite de profundidad): el grado 3 y la porta invertida se miden, no se
 * asignan. Medido el 15-11-2026: VSH S −17 / D 26 cm/s, porta PF 150 % (verdad 152) con el mínimo en −9,8 cm/s, renal
 * monofásica, grado 3.
 */
beforeAll(() => {
  loadS0028();
}, 60_000);

it('s0028: el alumno mide la porta invertida y el grado 3 desde las ventanas del menú', () => {
  const session = openSession(PORTAL_REVERSAL_CONGESTION, 'apnea-expiratory');
  expect(session.scene.identity.person).toBe('s0028');
  const measure = <K extends 'hepatic' | 'portal' | 'renal'>(kind: K, window: string, vessels: VesselId[]): CaptureResult[K] => {
    const contact = probeAt(session, window as never);
    const best = placeGate(session, contact, vessels, { acoustic: false, maxDepthMm: 170 });
    expect(best, `${kind} sin vaso en ${window}`).not.toBeNull();
    const prfHz = Math.min(
      kind === 'renal' ? 6000 : prfFromNyquistCms(40, CONVEX_C35.f0Doppler),
      Math.floor((0.9 * 1_540_000) / (2 * best!.r)),
    );
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
  const truth = measurePhysiologyTruth(engine, { fromT: engine.clock.t - 10, toT: engine.clock.t });
  expect(hepatic.pattern).toBe('severe');
  // La porta invertida: PF por encima del 100 % y la traza bajo la línea de base en sístole.
  expect(portal.pulsatilityFraction).toBeGreaterThan(110);
  expect(portal.vMin).toBeLessThan(-5);
  expect(classifyPortal(portal.pulsatilityFraction)).toBe(classifyPortal(truth.portalPF));
  expect(renal.pattern).toBe('monophasic');
  const grade = classifyVexusC({
    ivcMaxDiameterMm: truth.ivcMaxMm,
    hepatic: hepatic.pattern,
    portalPulsatilityFraction: portal.pulsatilityFraction,
    renal: renal.pattern,
  });
  expect(grade.status).toBe('complete');
  expect(grade.grade).toBe(3);
});
