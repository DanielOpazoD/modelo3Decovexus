// @tier slow
import { beforeAll, describe, expect, it } from 'vitest';
import { loadS0028 } from '../../tools/anatomy/s0028Windows';
import { maxPrfForDepth } from '../app/equipment';
import type { StartPoint } from '../app/startPoints';
import { AF_MODERATE_CONGESTION, CASES } from '../cases';
import { prfFromNyquistCms } from '../core/units';
import type { PatientState, RespiratoryPattern } from '../physiology/patientState';
import type { VesselId } from '../physiology/vessels';
import { classifyPortal } from '../vexus/classification';
import { measurePhysiologyTruth } from '../vexus/measurements';
import { acquire, openSession, placeGate, probeAt, TR } from './support/studentChain';

/**
 * Las escalas del equipo (decisión 94) por la cadena del alumno en s0028, desde las ventanas del menú: la porta desde la
 * subcostal, la suprahepática desde la intercostal y la interlobar desde la renal, a ±20–±80 cm/s, los ocho casos, apnea y
 * respiración tranquila. Los criterios de `examChainScale` y `examChainScalePatterns`: ninguna captura aceptada falsa (la PF a
 * ≤ 15 puntos de la verdad, nunca «grave» con una verdad < 30 %, ningún patrón distinto del de la verdad) y, en apnea, la técnica
 * sirve. Una semilla y no tres, para acotar el coste en la CI: la otra persona ya cubre la variación del moteado.
 *
 * La puerta se pone cuando se ve el vaso, como el alumno: al final de la espiración (la porta y la suprahepática) o en la primera
 * fase en que la técnica la encuentra (la interlobar, fina, no en todas). Medido el 15-11-2026: respirando, ninguna captura se
 * acepta (la porta y la interlobar entran y salen del plano: intermitente, filtro de pared o aliasing) y ninguna es falsa.
 */
beforeAll(() => {
  loadS0028();
}, 60_000);

const SCALES = [20, 40, 60, 80] as const;
const RESPIRATIONS: RespiratoryPattern[] = ['apnea-expiratory', 'quiet'];
const RENAL_VEINS: VesselId[] = ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'];

interface Row {
  resp: RespiratoryPattern;
  scale: number;
  value: string;
  truth: string;
  issue: string | null;
  ok: boolean;
}

function rows(base: PatientState, kind: 'portal' | 'hepatic' | 'renal'): Row[] {
  const window: StartPoint['id'] = kind === 'portal' ? 'portalSubcostal' : kind === 'hepatic' ? 'intercostal' : 'renal';
  const vessels: VesselId[] = kind === 'portal' ? ['pvTrunk'] : kind === 'hepatic' ? ['hvRight'] : RENAL_VEINS;
  const out: Row[] = [];
  for (const resp of RESPIRATIONS) {
    const session = openSession(base, resp);
    const { engine } = session;
    for (let n = 0; !(engine.sample.resp.diaphragmCaudalMm < 0.3) && n < 3000; n++) engine.step();
    const contact = probeAt(session, window);
    let best = placeGate(session, contact, vessels);
    for (let k = 0; !best && k < 100; k++) {
      for (let i = 0; i < 12; i++) engine.step();
      best = placeGate(session, contact, vessels);
    }
    expect(best, `${base.id}/${resp}: sin ${kind} en la ventana ${window}`).not.toBeNull();
    for (const scale of SCALES) {
      const prfHz = Math.min(prfFromNyquistCms(scale, TR.f0Doppler), maxPrfForDepth(best!.r + 2, 1_540_000));
      const m = acquire(session, contact, best!, kind, { prfHz, seconds: 8.5 }).captures.at(-1)?.m ?? null;
      const tNow = engine.clock.t;
      const issue = m ? m.quality.issue : 'sin medida';
      if (kind === 'portal') {
        const beats = (m as { measuredBeats?: { tR: number; rr: number }[] } | null)?.measuredBeats ?? [];
        const truth = beats.length
          ? measurePhysiologyTruth(engine, { fromT: beats[0].tR - 1e-6, toT: beats.at(-1)!.tR + beats.at(-1)!.rr + 1e-6 }).portalPF
          : measurePhysiologyTruth(engine, { fromT: tNow - 7, toT: tNow }).portalPF;
        const pf = (m as { pulsatilityFraction?: number } | null)?.pulsatilityFraction ?? Number.NaN;
        const ok = issue !== null || (Math.abs(pf - truth) <= 15 && !(truth < 30 && classifyPortal(pf) === 'severe'));
        out.push({ resp, scale, value: pf.toFixed(0), truth: truth.toFixed(0), issue, ok });
      } else {
        const t = measurePhysiologyTruth(engine, { fromT: tNow - 7, toT: tNow });
        const truth = kind === 'hepatic' ? t.hepaticPattern : t.renalPattern;
        const pattern = (m as { pattern?: string } | null)?.pattern ?? 'sin medida';
        // frontera monofásico/bifásico (S = 30 % de D): como la cadena del alumno, se acepta la clase vecina
        const near = kind === 'renal' && Math.abs(t.rvS / t.rvD - 0.3) < 0.1 && ['monophasic', 'biphasic'].includes(truth);
        const ok = issue !== null || pattern === truth || (near && ['monophasic', 'biphasic'].includes(pattern));
        out.push({ resp, scale, value: pattern, truth, issue, ok });
      }
    }
  }
  return out;
}

const tagOf = (rs: readonly Row[]) =>
  rs.map((r) => `${r.resp === 'quiet' ? 'resp' : 'apnea'} ±${r.scale}: ${r.value}/${r.truth}${r.issue ? ` ${r.issue}` : ''}`).join('; ');

describe('s0028: escalas del equipo desde las ventanas del menú (decisión 94)', () => {
  for (const base of CASES) {
    it(`${base.label}: PF portal, ninguna captura aceptada falsa; en apnea, medible a ±40–±80`, () => {
      const rs = rows(base, 'portal');
      expect(
        rs.filter((r) => !r.ok),
        tagOf(rs),
      ).toEqual([]);
      const apnea = rs.filter((r) => r.resp === 'apnea-expiratory' && r.scale >= 40);
      expect(apnea.filter((r) => r.issue === null).length / apnea.length, tagOf(rs)).toBeGreaterThanOrEqual(0.8);
    });

    it(`${base.label}: suprahepática, ningún patrón aceptado falso; en apnea, medible a ±40–±80`, () => {
      const rs = rows(base, 'hepatic');
      expect(
        rs.filter((r) => !r.ok),
        tagOf(rs),
      ).toEqual([]);
      // la FA se rechaza de más a propósito (decisión 49)
      const apnea = rs.filter((r) => r.resp === 'apnea-expiratory' && r.scale >= 40);
      const min = base === AF_MODERATE_CONGESTION ? 1 / 3 : 2 / 3;
      expect(apnea.filter((r) => r.issue === null).length / apnea.length, tagOf(rs)).toBeGreaterThanOrEqual(min);
    });

    it(`${base.label}: interlobar, ningún patrón aceptado falso; en apnea, medible a ±40–±80`, () => {
      const rs = rows(base, 'renal');
      expect(
        rs.filter((r) => !r.ok),
        tagOf(rs),
      ).toEqual([]);
      const apnea = rs.filter((r) => r.resp === 'apnea-expiratory' && r.scale >= 40);
      expect(apnea.filter((r) => r.issue === null).length / apnea.length, tagOf(rs)).toBeGreaterThanOrEqual(0.75);
    });
  }
});
