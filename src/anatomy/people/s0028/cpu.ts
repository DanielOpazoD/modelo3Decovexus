import type { PersonAssets } from '../../personAssets';
/** @twin trabajador-corte */
import type { Vec3 } from '../../../core/vec3';
import type { AnatomyPerson, InstalledCpuPerson } from '../../person';
import type { PersonBuffers } from '../../personAssets';
import { createAbdominalQueries, createThoracicQueries } from '../../personAtlas';
import { installS0028Assets } from './assets';
import { createSourceQueries } from './atlas';
import { classifyInside, classifyWall } from './classifier';
import { createSolidsQueries } from './solids';
import { placeS0028Vessels, smoothS0028Vessels } from './vessels';
import { createWallQueries } from './wall';
import { GASTRIC_WALL } from '../../organs/abdomen';
import { HEART_ATLAS_SHIFT, HEART_AXES, type HeartShape } from '../../organs/heart';
import { orthonormalBasis } from '../../primitives';

/** Riñones de s0028 (0 derecho, 1 izquierdo), medidos en sus máscaras: centroide, eje principal y dirección de la muesca hiliar. */
/**
 * Corazón de s0028 (decisión 356): las cuatro cavidades del esquema, colocadas y dimensionadas sobre las que se ven en su TAC
 * (cortes axiales z 0, 14, 28 y 42 mm con la máscara `heart`): centros y semiejes leídos en los cortes, no ajustados por un
 * método automático (las válvulas no separan las cámaras en esta fase) [ESTIMADO]. El marco ventricular conserva sus ejes: el
 * eje base → punta de esta persona coincide con el del esquema a menos de 10°. Coordenadas anteriores al registro
 * (`HEART_ATLAS_SHIFT`), que se suma después: en mm LAS son origen (50, 24, 14), AD (−24, 27, 32) y AI (2, −6, 36).
 */
export const S0028_HEART: HeartShape = Object.freeze({
  origin: [50, 24 - HEART_ATLAS_SHIFT[1], 14 - HEART_ATLAS_SHIFT[2]] as Vec3,
  axes: HEART_AXES,
  cavities: {
    lv: { c: [0, 0, 0] as Vec3, r: [36, 20, 20] as Vec3 },
    rv: { c: [-2, 38, 0] as Vec3, r: [40, 20, 30] as Vec3 },
    ra: { c: [-24, 27 - HEART_ATLAS_SHIFT[1], 32 - HEART_ATLAS_SHIFT[2]] as Vec3, r: [21, 24, 28] as Vec3 },
    la: { c: [2, -6 - HEART_ATLAS_SHIFT[1], 36 - HEART_ATLAS_SHIFT[2]] as Vec3, r: [30, 15, 22] as Vec3 },
  },
});
export const S0028_KIDNEY_FRAMES: readonly { center: Vec3; long: Vec3; hilum: Vec3 }[] = [
  { center: [-50.5, -27.7, -128.1], long: [0.2742, -0.4616, 0.8437], hilum: [0.9331, 0.34, -0.1173] },
  { center: [70.7, -27.3, -112.7], long: [-0.2537, -0.2372, 0.9377], hilum: [-0.896, 0.4229, -0.1354] },
];

/** s0028 está en pausa: su estómago conserva las capas de la decisión 312 (la 332 engrosa la muscular solo por defecto). */
export const GASTRIC_312 = { ...GASTRIC_WALL, muscularisMm: 1.2, submucosaMm: 2.8, submucosaFoldMm: 0.4 };

/** Política digestiva de esta persona. @twin s0028-digestivo */
export function digestiveWallMm(label: number): number {
  return label === 1 ? 3 : label === 4 ? 2.5 : 2;
}
/** Gas de la máscara de esta persona. @twin s0028-digestivo */
export function digestiveGasPlane(point: Vec3, sourceGas: (point: Vec3) => boolean): number {
  return sourceGas(point) ? 1 : -1;
}

/** Entrada CPU del Worker: no instala estado de módulo ni importa carga de red, vistas o GLSL. */
/** @twin trabajador-corte */
export function installS0028Cpu(buffers: PersonBuffers): InstalledCpuPerson {
  const assets = installS0028Assets(buffers);
  return createS0028Cpu(assets);
}

export function createS0028Cpu(assets: PersonAssets): InstalledCpuPerson {
  const source = createSourceQueries(assets);
  const regional = Object.freeze({ ...source, ...createWallQueries(assets, source), ...createSolidsQueries(assets) });
  const cpu: AnatomyPerson = {
    classifyInside,
    classifyWall,
    assets,
    atlas: Object.freeze({ ...createAbdominalQueries(assets), ...createThoracicQueries(assets) }),
    skinMm: 1.5,
    curveVessels: placeS0028Vessels,
    smoothVessels: smoothS0028Vessels,
    heart: S0028_HEART,
    // Marco de cada riñón, de su máscara: centro, eje largo (componente principal) y dirección del hilio (su muesca). Sitúa los
    // vasos del hilio y las interlobares en el riñón de esta persona; el parénquima sigue saliendo del rótulo del TAC.
    kidneyFrame: (side) => {
      const f = S0028_KIDNEY_FRAMES[side];
      return { center: [...f.center] as Vec3, ...orthonormalBasis(f.long, f.hilum) };
    },
    regional,
    fitBody: (profile) => profile,
    digestiveWallMm,
    digestiveGas: (point) => digestiveGasPlane(point, source.sourceGas),
    isColon: (label) => label === 4,
    gastricWall: GASTRIC_312,
  };
  return Object.freeze({ identity: assets.identity, assetKey: assets.assetKey, assets, cpu: Object.freeze(cpu) });
}
