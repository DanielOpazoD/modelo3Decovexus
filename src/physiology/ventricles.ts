import type { PatientState } from './patientState';

/**
 * Vaciado de los ventrículos a lo largo del latido (decisión 410): fracción del volumen sistólico ya expulsada, 0 en la
 * telediástole y 1 en la telesístole. Se cuenta en segundos desde la R, no en fracción del RR: la sístole dura casi lo
 * mismo a cualquier frecuencia y lo que se acorta es la diástole. Curva [ESTIMADO] de un ciclo de Wiggers: retraso
 * electromecánico de 50 ms, eyección hasta 330 ms (o el 30 % del RR si es más corto), relajación isovolumétrica de 60 ms,
 * llenado rápido (70 % del volumen), diástasis (10 %) y la contracción auricular (20 %), que falta sin onda a organizada.
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

/** Fracción expulsada a `tau` segundos de la R con un RR de `rr` s; `atrial` 0–1 es la contracción auricular. */
export function emptyingAt(tau: number, rr: number, atrial: number): number {
  const ejectStart = 0.05,
    ejectEnd = Math.min(0.33, ejectStart + 0.3 * rr),
    relaxEnd = ejectEnd + 0.06;
  if (tau < ejectStart) return 0;
  if (tau < ejectEnd) return cosineRamp((tau - ejectStart) / (ejectEnd - ejectStart));
  if (tau < relaxEnd) return 1;
  const diastole = Math.max(0.05, rr - relaxEnd),
    rapid = Math.min(0.15, 0.4 * diastole),
    kick = Math.min(0.12, 0.35 * diastole),
    kickStart = diastole - kick,
    // sin contracción auricular, lo que llenaba la aurícula se reparte en la diástasis
    left = 0.3 * (1 - atrial),
    t = tau - relaxEnd;
  if (t < rapid) return 1 - 0.7 * cosineRamp(t / rapid);
  if (t < kickStart) return 0.3 - (0.1 + left * 0.67) * Math.min(1, (t - rapid) / Math.max(1e-3, kickStart - rapid));
  const before = 0.2 - left * 0.67;
  return Math.max(0, before * (1 - cosineRamp((t - kickStart) / kick)));
}

export function ventricularEmptying(
  tau: number,
  rr: number,
  patient: Pick<PatientState, 'rvFunction' | 'atrialFunction'>,
): VentricularEmptying {
  const e = emptyingAt(tau, rr, Math.min(1, Math.max(0, patient.atrialFunction)));
  return { lv: e, rv: e * Math.min(1.2, Math.max(0, patient.rvFunction / RV_FUNCTION_NORMAL)) };
}
