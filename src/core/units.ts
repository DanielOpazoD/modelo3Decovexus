/** Constantes y conversiones. Las unidades del motor: mm, s, mmHg, mL. */
export const MMHG_PER_CMH2O = 0.73556;
export const CMH2O_PER_MMHG = 1 / MMHG_PER_CMH2O;
/** Velocidad del sonido que asume el equipo para reconstruir (hoja consolidada). */
export const C_RECONSTRUCTION_M_S = 1540;
export const C_RECONSTRUCTION_MM_S = C_RECONSTRUCTION_M_S * 1000;

export const cmH2OToMmHg = (p: number): number => p * MMHG_PER_CMH2O;
export const mmHgToCmH2O = (p: number): number => p * CMH2O_PER_MMHG;
export const mmToCm = (x: number): number => x / 10;
export const cmToMm = (x: number): number => x * 10;
/** cm/s → mm/s */
export const cmsToMms = (v: number): number => v * 10;
export const mmsToCms = (v: number): number => v / 10;

/**
 * Desplazamiento Doppler físico (invariante 10.1): fD = 2 f0 (v_rel · b̂) / c,
 * con b̂ unitario dirigido desde el dispersor hacia el transductor. Flujo que se
 * acerca → positivo. `vAlongBeam` es v_rel·b̂ en mm/s; `f0` en Hz; `c` en mm/s.
 */
export function dopplerShiftHz(vAlongBeamMmS: number, f0Hz: number, cMmS = C_RECONSTRUCTION_MM_S): number {
  return (2 * f0Hz * vAlongBeamMmS) / cMmS;
}

/** Velocidad rotulada a partir de una frecuencia Doppler con corrección angular del usuario (la de la escala). */
export function velocityFromShiftMmS(fdHz: number, f0Hz: number, angleCorrectionRad: number, cMmS = C_RECONSTRUCTION_MM_S): number {
  return ((fdHz * cMmS) / (2 * f0Hz)) * angleCorrectionFactor(angleCorrectionRad);
}

/** Frecuencia plegada al intervalo centrado de Nyquist: ((f + PRF/2) mod PRF) − PRF/2. */
export function wrapToNyquist(fHz: number, prfHz: number): number {
  const half = prfHz / 2;
  let x = (fHz + half) % prfHz;
  if (x < 0) x += prfHz;
  return x - half;
}

/** Factor 1/|cos α| con que la corrección angular multiplica la velocidad rotulada (|cos α| acotado a 0,05). */
export function angleCorrectionFactor(angleCorrectionRad: number): number {
  return 1 / Math.max(0.05, Math.abs(Math.cos(angleCorrectionRad)));
}

/**
 * Velocidad de Nyquist rotulada (cm/s) para una PRF: v = (PRF/2)·c / (2·f0·cos α).
 * Con `angleCorrectionRad` 0 es la escala sin corrección que muestra la barra.
 */
export function nyquistVelocityCms(prfHz: number, f0Hz: number, angleCorrectionRad = 0, cMmS = C_RECONSTRUCTION_MM_S): number {
  return mmsToCms(((prfHz / 2) * cMmS * angleCorrectionFactor(angleCorrectionRad)) / (2 * f0Hz));
}

/** PRF (Hz) que da una velocidad de Nyquist rotulada `cms`: inversa exacta de `nyquistVelocityCms`. */
export function prfFromNyquistCms(cms: number, f0Hz: number, angleCorrectionRad = 0, cMmS = C_RECONSTRUCTION_MM_S): number {
  return (cmsToMms(cms) * 2 * 2 * f0Hz) / (cMmS * angleCorrectionFactor(angleCorrectionRad));
}
