export const WALL_FILTER_MAX_PRF_FRACTION = 0.45;

/** Corte mínimo del filtro de pared PW en el mando (Hz). */
export const PW_WALL_FILTER_MIN_HZ = 10;

/** Corte efectivo del receptor, estrictamente por debajo de Nyquist. */
export function effectiveWallFilterCutoff(cutoffHz: number, sampleRateHz: number): number {
  if (!Number.isFinite(cutoffHz) || !Number.isFinite(sampleRateHz) || sampleRateHz <= 0)
    throw new RangeError('Invalid wall-filter frequency');
  return Math.min(Math.max(0, cutoffHz), sampleRateHz * WALL_FILTER_MAX_PRF_FRACTION);
}
