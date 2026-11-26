// @tier slow
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AF_MODERATE_CONGESTION, CASES, CIRRHOSIS_PULMONARY_HYPERTENSION, SEVERE_CONGESTION } from '../cases';
import { prfFromNyquistCms } from '../core/units';
import { maxPrfForDepth } from '../app/equipment';
import type { ObservedPortal } from '../doppler/spectralMeasure';
import type { RespiratoryPattern } from '../physiology/patientState';
import type { Beat } from '../physiology/rhythm';
import { classifyPortal } from '../vexus/classification';
import { measurePhysiologyTruth } from '../vexus/measurements';
import { acquire, lowerBoundHolds, openSession, placeGate, probeAt, TR } from './support/studentChain';

/**
 * PF portal del alumno frente a la escala (decisión 94). Un clínico del panel de evaluación midió en la app, con el visto
 * bueno de la calidad, una PF del sano (verdad 13–20 %) de 100 % a ±20 cm/s, 111–114 % a ±40 (la escala por defecto),
 * 79–95 % a ±60 y 18–24 % a ±80; el grave, 133 % (verdad 75 %). Causa: la traza tomaba el semiplano dominante columna a
 * columna y, con la banda débil de un vaso profundo (−30 dB), el clutter junto a la línea de base o su imagen hundían
 * Vmín a 0 o por debajo. La cadena del alumno no lo veía: medía a la PRF máxima con una copia de la puerta de
 * transmisión fija 0,3 (−10 dB).
 *
 * Aquí, por la ruta de la aplicación (`support/studentChain.ts`): las 4 escalas que usa el alumno (±20, ±40, ±60 y
 * ±80 cm/s, limitadas por la profundidad como el deslizador), los 7 casos, apnea y respiración tranquila, 3 semillas;
 * la puerta en el tronco portal desde la ventana «Porta» con la técnica del operador y la longitud por defecto (4 mm).
 * En cada sesión el alumno cambia la escala y espera 8,5 s antes de capturar. Criterios de aceptación de la decisión:
 * |PF − verdad| ≤ 10 puntos en ≥ 95 % de las capturas aceptadas, nunca «grave» con una verdad < 30 % y, en apnea a
 * ±40–±80, la técnica sirve (≥ 80 % medibles). En main a386e5e esta prueba falla en los 7 casos: de 168 capturas, 109
 * aceptadas, solo 31 (28 %) a ≤ 10 puntos y 26 «graves» con la verdad normal. Una PF aceptada como cota inferior (el valle en
 * el filtro de pared con todos los latidos ya ≥ 60 %) es otra categoría, con su propia aserción: verdad grave y PF ≤ verdad + 3.
 */
const SCALES = [20, 40, 60, 80] as const;
const SEEDS = [0, 1, 2] as const;
const RESPIRATIONS: RespiratoryPattern[] = ['apnea-expiratory', 'quiet'];

interface Row {
  caseId: string;
  resp: RespiratoryPattern;
  seed: number;
  scale: number;
  pf: number;
  /** Verdad en los latidos medidos (los de la captura); `truth7`, en los 7 s de espectro. */
  truth: number;
  truth7: number;
  issue: string | null;
  /** Aceptada como cota inferior de la PF: no entra en la tolerancia de ±10 puntos, sino en `lowerBoundHolds`. */
  lowerBound: boolean;
}

/**
 * PF de la verdad en los mismos latidos que midió la captura (en los 7 s si no midió ninguno). En la FA la PF cambia de un
 * latido a otro (12–47 % en una misma captura) y la mediana de los 4 latidos de la captura puede quedar a > 10 puntos de la
 * de los ~11 latidos de 7 s: eso es el muestreo del ritmo, no la medición (limitación `af-capture-beat-sampling`).
 */
function truthOf(session: ReturnType<typeof openSession>, m: { measuredBeats: readonly Beat[] } | null): { truth: number; truth7: number } {
  const tNow = session.engine.clock.t;
  const truth7 = measurePhysiologyTruth(session.engine, { fromT: tNow - 7, toT: tNow }).portalPF;
  const b = m?.measuredBeats ?? [];
  if (!b.length) return { truth: truth7, truth7 };
  const last = b[b.length - 1];
  return { truth: measurePhysiologyTruth(session.engine, { fromT: b[0].tR - 1e-6, toT: last.tR + last.rr + 1e-6 }).portalPF, truth7 };
}

/** Fila de una captura portal, con la verdad en sus latidos. */
function rowOf(
  session: ReturnType<typeof openSession>,
  resp: RespiratoryPattern,
  seed: number,
  scale: number,
  m: ObservedPortal | null,
): Row {
  return {
    caseId: session.patient.id,
    resp,
    seed,
    scale,
    pf: m ? m.pulsatilityFraction : Number.NaN,
    ...truthOf(session, m),
    issue: m ? m.quality.issue : 'sin medida',
    lowerBound: m?.pulsatilityLowerBound === true,
  };
}

function portalRows(caseIndex: number, resp: RespiratoryPattern): Row[] {
  const base = CASES[caseIndex];
  const rows: Row[] = [];
  for (const seed of SEEDS) {
    const session = openSession(base, resp, seed);
    const contact = probeAt(session, 'portalTrunk');
    const best = placeGate(session, contact, ['pvTrunk']);
    expect(best, `${base.id}: sin tronco portal en la ventana «Porta»`).not.toBeNull();
    for (const scale of SCALES) {
      const prfHz = Math.min(prfFromNyquistCms(scale, TR.f0Doppler), maxPrfForDepth(best!.r + 2, 1_540_000));
      const { captures } = acquire(session, contact, best!, 'portal', { prfHz, seconds: 8.5 });
      rows.push(rowOf(session, resp, seed, scale, captures.at(-1)?.m ?? null));
    }
  }
  return rows;
}

const table = (rows: readonly Row[]) =>
  rows
    .map(
      (r) =>
        `${r.resp === 'quiet' ? 'resp' : 'apnea'} s${r.seed} ±${r.scale}: ${r.lowerBound ? '≥' : ''}${r.pf.toFixed(0)}/${r.truth.toFixed(0)}${r.issue ? ` ${r.issue}` : ''}`,
    )
    .join('; ');

describe('PF portal del alumno a las escalas del equipo (decisión 94)', () => {
  const all: Row[] = [];
  // Apnea y respiración en pruebas aparte: con la población de la decisión 294 la cadena cuesta más y juntas se acercan al límite de
  // 180 s por prueba en la CI (36–42 s por caso antes, ~4 veces más ahora).
  for (const [i, base] of CASES.entries())
    for (const resp of RESPIRATIONS) {
      it(`${base.label}, ${resp === 'quiet' ? 'respirando' : 'en apnea'}: la PF aceptada sigue a la verdad a ±20–±80 cm/s`, () => {
        const rows = portalRows(i, resp);
        all.push(...rows);
        const tag = table(rows);
        const accepted = rows.filter((r) => r.issue === null);
        // nunca «grave» con una verdad normal (criterio 2 de la misión: el mensaje clínico)
        expect(
          accepted.filter((r) => r.truth < 30 && classifyPortal(r.pf) === 'severe'),
          tag,
        ).toEqual([]);
        // cada captura aceptada cerca de la verdad (el 95 % a ≤ 10 puntos lo exige el agregado)
        expect(
          accepted.filter((r) => !r.lowerBound && Math.abs(r.pf - r.truth) > 15),
          tag,
        ).toEqual([]);
        // la cota inferior: verdad grave y PF ≤ verdad + 3
        expect(
          accepted.filter((r) => r.lowerBound && !lowerBoundHolds(r.pf, r.truth)),
          tag,
        ).toEqual([]);
        // la técnica sirve: en apnea, a ±40–±80, casi todas medibles
        if (resp === 'apnea-expiratory') {
          const apnea = rows.filter((r) => r.scale >= 40);
          expect(apnea.filter((r) => r.issue === null).length / apnea.length, tag).toBeGreaterThanOrEqual(0.8);
        }
      });
    }

  // Revisión adversarial de la decisión 94: justo por debajo del pico (±10–16 cm/s) el pico se recortaba (PF menor) o se
  // plegaba al otro lado y se leía como inversión (cirrosis, verdad 35 %: PF 171–202 % aceptadas), y con el filtro de pared
  // a 300 Hz el valle del grave caía en su banda (PF 30–46 % aceptadas, verdad 76 %). Ahora son aliasing o «filtro de
  // pared»: ninguna captura aceptada se aparta más de 10 puntos.
  for (const base of [CIRRHOSIS_PULMONARY_HYPERTENSION, SEVERE_CONGESTION, AF_MODERATE_CONGESTION]) {
    it(`${base.label}: cerca del Nyquist y con el filtro de pared alto, ninguna PF aceptada falsa`, () => {
      const rows: Row[] = [];
      for (const seed of [1, 4, 8]) {
        const session = openSession(base, 'apnea-expiratory', seed);
        const contact = probeAt(session, 'portalTrunk');
        const best = placeGate(session, contact, ['pvTrunk'])!;
        for (const [scale, wallFilterHz] of [
          [10, 25],
          [14, 25],
          [16, 25],
          [40, 300],
        ] as const) {
          const prfHz = Math.min(prfFromNyquistCms(scale, TR.f0Doppler), maxPrfForDepth(best.r + 2, 1_540_000));
          const m = acquire(session, contact, best, 'portal', { prfHz, seconds: 8.5, wallFilterHz }).captures.at(-1)?.m ?? null;
          rows.push(rowOf(session, 'apnea-expiratory', seed, wallFilterHz === 25 ? scale : -scale, m));
        }
      }
      expect(
        rows.filter((r) => r.issue === null && (r.lowerBound ? !lowerBoundHolds(r.pf, r.truth) : Math.abs(r.pf - r.truth) > 10)),
        table(rows),
      ).toEqual([]);
    });
  }

  // Un valle en la línea de base (PF ≈ 100 %: el grave tras un bolo de 150 mL) cae en la banda del filtro de pared aunque el
  // filtro esté bajo (el del preajuste, 20 Hz, o el mínimo del mando, 10 Hz): la traza no baja del primer bin de la
  // envolvente. En main 70e3691 las 6 capturas a 20 Hz eran «no medible: baje el filtro de pared» y a 10 Hz la misma
  // fisiología salía «exacta» a 82–86 % con la verdad en 100–103 %. Ahora todas se aceptan como cota inferior grave.
  it.each([10, 20])(
    `${SEVERE_CONGESTION.label} tras un bolo de 150 mL, en apnea, con el filtro a %i Hz: el valle en la línea de base es una cota inferior grave`,
    (wallFilterHz) => {
      const session = openSession(SEVERE_CONGESTION, 'apnea-expiratory', 0);
      session.engine.intervene({ kind: 'bolus', volumeMl: 150 });
      const t0 = session.engine.clock.t;
      while (session.engine.clock.t < t0 + 15) session.engine.step();
      const contact = probeAt(session, 'portalTrunk');
      const best = placeGate(session, contact, ['pvTrunk'])!;
      const prfHz = Math.min(prfFromNyquistCms(40, TR.f0Doppler), maxPrfForDepth(best.r + 2, 1_540_000));
      const rows: Row[] = [];
      for (let k = 0; k < 6; k++) {
        const m = acquire(session, contact, best, 'portal', { prfHz, seconds: 8.5, wallFilterHz }).captures.at(-1)?.m ?? null;
        rows.push(rowOf(session, 'apnea-expiratory', 0, 40, m));
      }
      const tag = table(rows);
      // todas aceptadas: una marca de cota en una captura rechazada no cuenta
      expect(
        rows.filter((r) => r.issue !== null),
        tag,
      ).toEqual([]);
      expect(rows.some((r) => r.lowerBound)).toBe(true);
      expect(
        rows.filter((r) => (r.lowerBound ? !lowerBoundHolds(r.pf, r.truth) : Math.abs(r.pf - r.truth) > 15)),
        tag,
      ).toEqual([]);
    },
  );

  it('agregado: |PF − verdad| ≤ 10 puntos en ≥ 95 % de las capturas aceptadas', () => {
    // tabla para el informe de la decisión (PF_TABLE=ruta): una fila por captura
    if (process.env.PF_TABLE) writeFileSync(process.env.PF_TABLE, JSON.stringify(all));
    expect(all.length, 'las pruebas por caso deben correr antes').toBe(CASES.length * RESPIRATIONS.length * SEEDS.length * SCALES.length);
    const accepted = all.filter((r) => r.issue === null);
    // la cota inferior tiene su propia aserción en cada caso
    const exact = accepted.filter((r) => !r.lowerBound);
    const within = exact.filter((r) => Math.abs(r.pf - r.truth) <= 10);
    expect(accepted.length).toBeGreaterThan(all.length / 2);
    expect(within.length / exact.length, table(exact.filter((r) => Math.abs(r.pf - r.truth) > 10))).toBeGreaterThanOrEqual(0.95);
  });
});
