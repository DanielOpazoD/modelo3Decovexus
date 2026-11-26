import { RESPIRATORY_DIRECTION } from '../anatomy/respiratoryDirection';
import { dot, sub, type Vec3 } from '../core/vec3';
import type { ProbeFrame } from '../probe/probe';

/** Semiespesor (mm) de la losa del plano de imagen que recorta los tubos del cuadro. */
const TUBE_SLAB_HALF_MM = 12;
/** Paso (mm) de D para el recorte: divide las excursiones de 10 y 30 mm, así que nunca pasa de la del patrón. */
const TUBE_SLAB_D_STEP_MM = 10;

/**
 * D (≥ 0) del recorte, redondeada hacia arriba al paso: la losa crece con D, así que conserva todo tubo de la D exacta, y con la
 * sonda quieta la lista (y con ella la rejilla de tubos y su textura) cambia ≤ 2·⌈Dmax/paso⌉ veces por respiración.
 */
export function tubeSlabDiaphragmMm(diaphragmCaudalMm: number): number {
  return Math.ceil(diaphragmCaudalMm / TUBE_SLAB_D_STEP_MM) * TUBE_SLAB_D_STEP_MM;
}

/**
 * La esfera envolvente del tubo (MATERIAL) corta la losa del plano (MUNDO, elevación ± 12 mm) deshecha la respiración:
 * `toMaterial` resta D·a·dir con a ∈ [0, 1], así que en elevación la losa material se alarga D·(dir·elev) hacia −dir. La
 * compresión desplaza en r̂, perpendicular a la elevación, y no la mueve. Con D = 0 es la losa simétrica de siempre.
 */
export function tubeInSlab(b: { center: Vec3; r: number }, fr: Pick<ProbeFrame, 'face' | 'elevation'>, diaphragmCaudalMm: number): boolean {
  const d = dot(sub(b.center, fr.face), fr.elevation),
    s = diaphragmCaudalMm * dot(RESPIRATORY_DIRECTION, fr.elevation);
  return d + b.r >= -TUBE_SLAB_HALF_MM - Math.max(0, s) && d - b.r <= TUBE_SLAB_HALF_MM - Math.min(0, s);
}
