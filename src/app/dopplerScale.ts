import { C_RECONSTRUCTION_MM_S, angleCorrectionFactor, nyquistVelocityCms, prfFromNyquistCms } from '../core/units';
import type { TransducerProfile } from '../ultrasound/transducerProfile';
import { AcquisitionEquipment } from './acquisitionEquipment';
import { reduceEquipment, type EquipmentCommand } from './equipment';
import type { EquipmentSettings } from './simulator';

/** Límites del mando «Escala» en cm/s rotulados: con corrección angular (solo PW) cubren el mismo intervalo de PRF. */
export function dopplerScaleBounds(mode: 'color' | 'pw', angleCorrectionRad = 0): number[] {
  const k = angleCorrectionFactor(angleCorrectionRad);
  return (mode === 'color' ? [4, 60] : [5, 120]).map((v) => Math.round(v * k));
}

/** A scale gesture starts at the displayed value, then snaps across physical plateaus.
 * The value is the labelled scale (PW: angle corrected, like the footer and the ruler).
 * Bounded by the slider range; never changes the other requested mode.
 * Only runs on operator input, not per frame or IQ sample.
 */
export function dopplerScaleCommand(
  e: EquipmentSettings,
  profile: TransducerProfile,
  mode: 'color' | 'pw',
  value: number,
): EquipmentCommand {
  const cache = new AcquisitionEquipment(),
    tr = profile.geometry,
    angle = mode === 'pw' ? e.pw.angleCorrection : 0,
    [lo, hi] = dopplerScaleBounds(mode, angle);
  const read = (settings: EquipmentSettings) => cache.get(settings, tr.lines, profile.colorLineSpacingRad, C_RECONSTRUCTION_MM_S)[mode];
  const scale = (settings: EquipmentSettings) => Math.round(nyquistVelocityCms(read(settings).prfHz, tr.f0Doppler, angle));
  const start = scale(e),
    direction = Math.sign(value - start);
  // Selecting the displayed integer still requests that value, not the hidden
  // fractional scale that happened to round to it.
  const prfHz = direction ? e[mode].prfHz : Math.round(prfFromNyquistCms(value, tr.f0Doppler, angle));
  if (direction)
    for (let next = value; next >= lo && next <= hi; next += direction) {
      const patch = { prfHz: Math.round(prfFromNyquistCms(next, tr.f0Doppler, angle)) };
      const candidate = reduceEquipment(e, { type: mode, patch }, { halfSectorRad: tr.halfSector, cMmS: C_RECONSTRUCTION_MM_S });
      if (Math.sign(scale(candidate) - start) === direction) return { type: mode, patch };
    }
  // Sin valor alcanzable el gesto no cambia la petición: el tope del mando no queda pedido hasta que se relaje el límite.
  return { type: mode, patch: { prfHz } };
}
