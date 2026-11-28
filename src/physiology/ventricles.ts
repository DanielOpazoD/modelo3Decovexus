import type { Beat } from './rhythm';

/**
 * Vaciado de los ventrículos a lo largo del latido (decisión 410): fracción del volumen sistólico ya expulsada, 0 en la
 * telediástole y 1 en la telesístole. Se cuenta en segundos desde la R, no en fracción del RR: la sístole dura casi lo
 * mismo a cualquier frecuencia y lo que se acorta es la diástole. Curva [ESTIMADO] de un ciclo de Wiggers: retraso
 * electromecánico de 50 ms, eyección hasta 330 ms (o el 30 % del RR previo si es más corto), relajación isovolumétrica de
 * 60 ms, llenado rápido (70 % del volumen), diástasis (10 %) y la contracción auricular (20 %), que falta sin onda a
 * organizada. Todo sigue al ciclo que precede a la R, como en `rhythm.ts`: el llenado no conoce la R siguiente y solo la
 * patada auricular, que anuncia la P, termina en ella. Sin patada (FA), un ciclo corto deja el ventrículo a medio llenar y
 * el latido siguiente parte de ahí.
 */
export interface VentricularEmptying {
  /** Ventrículo izquierdo, 0–1. */
  readonly lv: number;
  /** Ventrículo derecho, 0–1, escalado por su función sistólica: con función nula apenas se vacía. */
  readonly rv: number;
}

/** Función sistólica del VD de un adulto sano en los casos (`rvFunction`): la de un vaciado completo. */
export const RV_FUNCTION_NORMAL = 0.85;
const cosineRamp = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));

/**
 * Fracción expulsada a `tau` segundos de la R con `rr` s hasta la R siguiente y `rrPrev` desde la anterior; `atrial` 0–1
 * es la contracción auricular y `residual`, lo que el latido anterior dejó sin llenar en esta R.
 */
export function emptyingAt(tau: number, rr: number, atrial: number, rrPrev = rr, residual = 0): number {
  const ejectStart = 0.05,
    ejectEnd = Math.min(0.33, ejectStart + 0.3 * rrPrev),
    relaxEnd = ejectEnd + 0.06;
  if (tau < ejectStart) return residual;
  if (tau < ejectEnd) return residual + (1 - residual) * cosineRamp((tau - ejectStart) / (ejectEnd - ejectStart));
  if (tau < relaxEnd) return 1;
  const diastole = Math.max(0.05, rrPrev - relaxEnd),
    rapid = Math.min(0.15, 0.4 * diastole),
    diastasisEnd = diastole - Math.min(0.12, 0.35 * diastole),
    // sin contracción auricular, lo que llenaba la aurícula se reparte en la diástasis
    left = 0.3 * (1 - atrial),
    filling = (t: number) =>
      t < rapid
        ? 1 - 0.7 * cosineRamp(t / rapid)
        : Math.max(0, 0.3 - (0.1 + left * 0.67) * Math.min(1, (t - rapid) / Math.max(1e-3, diastasisEnd - rapid))),
    t = tau - relaxEnd;
  if (!(atrial > 0)) return filling(t);
  const kick = Math.min(0.12, 0.35 * Math.max(0.05, rr - relaxEnd)),
    kickStart = rr - relaxEnd - kick;
  return t < kickStart ? filling(t) : filling(kickStart) * (1 - cosineRamp((t - kickStart) / kick));
}

/**
 * Vaciado a `tau` s de la R del latido: su RR, su escala sistólica (RR previo) y su aurícula (0 en FA), la misma de la AD;
 * `previous`, el latido anterior, del que hereda lo que quedó sin llenar.
 */
export function ventricularEmptying(
  tau: number,
  beat: Pick<Beat, 'rr' | 'systoleScale' | 'atrialAmplitude'>,
  rvFunction: number,
  previous?: Pick<Beat, 'rr' | 'systoleScale' | 'atrialAmplitude'>,
): VentricularEmptying {
  const at = (t: number, b: typeof beat, residual = 0) =>
    emptyingAt(t, b.rr, Math.min(1, Math.max(0, b.atrialAmplitude)), 0.8 * b.systoleScale ** 2, residual);
  const e = at(tau, beat, previous ? at(previous.rr, previous) : 0);
  return { lv: e, rv: e * Math.min(1.2, Math.max(0, rvFunction / RV_FUNCTION_NORMAL)) };
}
