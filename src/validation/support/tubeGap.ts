import { TUBE_GAP_REACH_MM } from '../../anatomy/gpu/tubeGrid';
import { TUBE_NOISE_MAX, tubeQuery } from '../../anatomy/primitives';
import { outsideTubeSphere, vesselApScale, wallThicknessMm, type AnatomyScene, type VesselCaliber } from '../../anatomy/scene';
import type { Vec3 } from '../../core/vec3';

/**
 * Hueco (mm) entre un punto MATERIAL y la pared exterior del tubo (vaso o conducto) más cercano de la escena: negativo si alguno
 * lo contiene en su luz o en su pared, 1e3 si ninguno tiene su esfera a menos de `TUBE_GAP_REACH_MM`. Va por lo bajo: resta el
 * mayor ruido del radio (`TUBE_NOISE_MAX`), porque la GLSL mide sin él lejos de la luz.
 *
 * `classify` no cuenta los tubos en la distancia al borde de un órgano; la pasada B los añade con este hueco para no saltarse un
 * vaso que pasa junto al plano (`boundaryWithTubes`, decisión 418). En la GLSL sale en dos partes, `Cls.tgap` (del bucle de tubos
 * del clasificador) y `tubeNearbyGap` (los tubos que ese bucle no evalúa); aquí, de todos los tubos, sin rejilla: solo lo usan
 * el gemelo de la pasada B y las pruebas.
 * @twin pleura
 */
export function tubeGap(scene: AnatomyScene, m: Vec3, caliber: VesselCaliber): number {
  let gap = 1e3;
  for (let i = 0; i < scene.tubeBounds.length; i++) {
    const b = scene.tubeBounds[i];
    if (outsideTubeSphere(m, b.center, b.r + TUBE_GAP_REACH_MM)) continue;
    if (i < scene.vessels.length) {
      const def = scene.vessels[i];
      const apScale = vesselApScale(def.id, def.tube.apScale, caliber);
      const hit = tubeQuery(m, apScale === def.tube.apScale ? def.tube : { ...def.tube, apScale }, caliber.radiusScale(def.id));
      gap = Math.min(gap, hit.d - wallThicknessMm(def, hit.r) - TUBE_NOISE_MAX * hit.r);
    } else {
      const def = scene.ducts[i - scene.vessels.length];
      const hit = tubeQuery(m, def.tube, 1);
      gap = Math.min(gap, hit.d - def.wallMm - TUBE_NOISE_MAX * hit.r);
    }
  }
  return gap;
}
