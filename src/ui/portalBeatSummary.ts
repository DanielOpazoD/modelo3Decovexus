import type { ObservedPortal } from '../doppler/spectralMeasure';
import { PF_THRESHOLDS, portalPulsatilityText, pulsatilityValueText } from './panel/vexusText';

/** Sample variability only: no population interval or guarantee about unrecorded beats. */
export function portalBeatSummary(
  m: Pick<ObservedPortal, 'pulsatilityFraction' | 'beats'> & Partial<Pick<ObservedPortal, 'pulsatilityByBeat' | 'pulsatilityLowerBound'>>,
): string {
  const values = m.pulsatilityByBeat;
  if (!values || values.length !== m.beats || m.beats < 2 || !values.every(Number.isFinite) || !Number.isFinite(m.pulsatilityFraction))
    return '';
  const lo = Math.min(...values),
    hi = Math.max(...values);
  const crossing = PF_THRESHOLDS.filter((t) => lo < t && hi >= t);
  return `PF ${portalPulsatilityText(m.pulsatilityFraction, m.pulsatilityLowerBound)} · rango entre ${m.beats} latidos ${pulsatilityValueText(lo)}–${pulsatilityValueText(hi)} %${crossing.length ? ` · cruza ${crossing.join('/')} %: ampliar registro` : ''}`;
}
