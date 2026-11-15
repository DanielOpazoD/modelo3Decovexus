import { expect } from 'vitest';
import { maxPrfForDepth } from '../../app/equipment';
import type { StartPoint } from '../../app/startPoints';
import { AF_MODERATE_CONGESTION } from '../../cases';
import { prfFromNyquistCms } from '../../core/units';
import type { PatientState, RespiratoryPattern } from '../../physiology/patientState';
import type { VesselId } from '../../physiology/vessels';
import { classifyPortal } from '../../vexus/classification';
import { measurePhysiologyTruth } from '../../vexus/measurements';
import { acquire, openSession, placeGate, probeAt, TR } from './studentChain';

/**
 * Escalas del equipo en s0028 (`s0028Scales*.test.ts`). Las escalas del equipo (decisión 94) por la cadena del alumno en s0028, desde las ventanas del menú: la porta desde la
 * subcostal, la suprahepática desde la intercostal y la interlobar desde la renal, en los ocho casos. Los criterios de
 * `examChainScale` y `examChainScalePatterns`: ninguna captura aceptada falsa (la PF a ≤ 15 puntos de la verdad, nunca «grave»
 * con una verdad < 30 %, ningún patrón distinto del de la verdad) y, en apnea, la técnica sirve.
 *
 * La lógica de la escala (el plegado a ±20, el recorte junto al Nyquist) la vigilan aquellas en la otra persona, a ±20–±80 con
 * tres semillas, y la escala de partida en apnea (±40) la cubren `s0028ExamChain` y `s0028Traps`. Aquí, lo propio de s0028 al
 * menor coste: en apnea ±80 (la escala alta, donde el clutter del riñón se leía como flujo) y respirando ±40 (ninguna captura
 * aceptada falsa), con una sesión por caso y respiración. Con las cuatro escalas en las dos respiraciones (192 capturas, 13,4 min
 * de CPU) el paso de cobertura de la CI pasaba de su plazo de 40 min.
 *
 * La puerta se pone cuando se ve el vaso, como el alumno: al final de la espiración, o en la primera fase en que la técnica la
 * encuentra (la interlobar, fina, no en todas). Medido el 15-11-2026: respirando, ninguna captura se acepta (la porta y la
 * interlobar entran y salen del plano: intermitente, filtro de pared o aliasing) y ninguna es falsa.
 */
const SCALE: Partial<Record<RespiratoryPattern, number>> = { 'apnea-expiratory': 80, quiet: 40 };
const KINDS = [
  { kind: 'portal', window: 'portalSubcostal', vessels: ['pvTrunk'] },
  { kind: 'hepatic', window: 'intercostal', vessels: ['hvRight'] },
  { kind: 'renal', window: 'renal', vessels: ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'] },
] as const satisfies readonly { kind: string; window: StartPoint['id']; vessels: readonly VesselId[] }[];

interface Row {
  kind: (typeof KINDS)[number]['kind'];
  resp: RespiratoryPattern;
  value: string;
  truth: string;
  issue: string | null;
  ok: boolean;
}

function rows(base: PatientState): Row[] {
  const out: Row[] = [];
  for (const resp of ['apnea-expiratory', 'quiet'] as const) {
    const session = openSession(base, resp);
    const { engine } = session;
    for (let n = 0; !(engine.sample.resp.diaphragmCaudalMm < 0.3) && n < 3000; n++) engine.step();
    for (const { kind, window, vessels } of KINDS) {
      const contact = probeAt(session, window);
      let best = placeGate(session, contact, [...vessels]);
      for (let k = 0; !best && k < 100; k++) {
        for (let i = 0; i < 12; i++) engine.step();
        best = placeGate(session, contact, [...vessels]);
      }
      expect(best, `${base.id}/${resp}: sin ${kind} en la ventana ${window}`).not.toBeNull();
      const prfHz = Math.min(prfFromNyquistCms(SCALE[resp]!, TR.f0Doppler), maxPrfForDepth(best!.r + 2, 1_540_000));
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
        out.push({ kind, resp, value: pf.toFixed(0), truth: truth.toFixed(0), issue, ok });
      } else {
        const t = measurePhysiologyTruth(engine, { fromT: tNow - 7, toT: tNow });
        const truth = kind === 'hepatic' ? t.hepaticPattern : t.renalPattern;
        const pattern = (m as { pattern?: string } | null)?.pattern ?? 'sin medida';
        // frontera monofásico/bifásico (S = 30 % de D): como la cadena del alumno, se acepta la clase vecina
        const near = kind === 'renal' && Math.abs(t.rvS / t.rvD - 0.3) < 0.1 && ['monophasic', 'biphasic'].includes(truth);
        const ok = issue !== null || pattern === truth || (near && ['monophasic', 'biphasic'].includes(pattern));
        out.push({ kind, resp, value: pattern, truth, issue, ok });
      }
    }
  }
  return out;
}

const tagOf = (rs: readonly Row[]) =>
  rs
    .map((r) => `${r.kind} ${r.resp === 'quiet' ? 'resp ±40' : 'apnea ±80'}: ${r.value}/${r.truth}${r.issue ? ` ${r.issue}` : ''}`)
    .join('; ');

/** Una prueba por caso: ninguna captura aceptada falsa y, en apnea a ±80, medibles. */
export function checkScales(base: PatientState): void {
  const rs = rows(base);
  const tag = tagOf(rs);
  expect(
    rs.filter((r) => !r.ok),
    tag,
  ).toEqual([]);
  const apnea = rs.filter((r) => r.resp === 'apnea-expiratory');
  // la FA se rechaza de más a propósito en la suprahepática (decisión 49): basta con dos de los tres territorios
  const min = base === AF_MODERATE_CONGESTION ? 2 / 3 : 1;
  expect(apnea.filter((r) => r.issue === null).length / apnea.length, tag).toBeGreaterThanOrEqual(min);
}
