import type { Vec3 } from '../core/vec3';
import type { GastricWall } from './organs/abdomen';
import type { HeartShape } from './organs/heart';
import type { createSourceQueries } from './people/s0028/atlas';
import type { createSolidsQueries } from './people/s0028/solids';
import type { createWallQueries } from './people/s0028/wall';
import type { PersonAssets, PersonIdentity } from './personAssets';
import type { createAbdominalQueries, createThoracicQueries } from './personAtlas';
import type { IndexedSourceSurface } from './s0028Surface';
import type { AnatomyScene } from './scene';
import type { VesselDef } from './vesselTree';

export interface AnatomyPerson {
  readonly classifyInside: (
    scene: AnatomyScene,
    ...args: Parameters<AnatomyScene['classifyInside']>
  ) => ReturnType<AnatomyScene['classifyInside']>;
  readonly classifyWall: (
    scene: AnatomyScene,
    ...args: Parameters<AnatomyScene['classifyWall']>
  ) => ReturnType<AnatomyScene['classifyWall']>;
  readonly assets: PersonAssets;
  readonly atlas: ReturnType<typeof createAbdominalQueries> & ReturnType<typeof createThoracicQueries>;
  readonly skinMm: number;
  /** Construction-only refinement of this person’s registered vascular landmarks. */
  readonly curveVessels?: (vessels: VesselDef[]) => void;
  /** Tope de ramas hepáticas procedurales por vaso madre, cuando la persona ya trae ramas propias y los tubos van justos. */
  readonly hepaticBranchesPerParent?: number;
  /** Radio (mm) del cuerpo vertebral lumbar con que su cortical reparte el eco (decisión 368). */
  readonly lumbarBodyRadiusMm?: number;
  /** Tras colocar las ramas procedurales: el eje de los vasos madre como curva (más nodos, mismos extremos). */
  readonly smoothVessels?: (vessels: VesselDef[]) => void;
  readonly regional?: ReturnType<typeof createSourceQueries> &
    ReturnType<typeof createWallQueries> &
    ReturnType<typeof createSolidsQueries>;
  readonly fitBody: (profile: Float32Array, wallMm: number, skinMm: number) => Float32Array;
  readonly digestiveWallMm: (label: number) => number;
  readonly digestiveGas: (point: Vec3, label: number) => number;
  readonly isColon: (label: number) => boolean;
  /** Capas del estómago cuando la persona conserva otras (s0028, decisión 332); sin ellas, `GASTRIC_WALL`. */
  readonly gastricWall?: GastricWall;
  /** Marco nuevo (copia propia) del riñón del atlas (0 derecho, 1 izquierdo) cuando la persona lo mueve (decisiones 329 y 330); sin él, el de la escena. */
  /** Forma del corazón de esta persona (marco ventricular y cavidades); sin ella, la esquemática de `organs/heart.ts`. */
  readonly heart?: HeartShape;
  readonly kidneyFrame?: (side: number) => { center: Vec3; u: Vec3; v: Vec3; w: Vec3; sinusRadii?: Vec3 };
}

export interface AtlasUpload {
  readonly offset: readonly number[];
  readonly size: readonly number[];
  readonly data: Uint16Array;
}

export interface PersonGpuPlan {
  readonly specializeFragment: (source: string) => string;
  readonly uploads: readonly AtlasUpload[];
  /** Tramos por tubo que recorre el shader de esta persona; sin él, `MAX_TUBE_SEGMENTS`. */
  readonly tubeSegments?: number;
  /**
   * Aspecto de los tejidos de esta persona en la imagen, donde difiere de la tabla común (`TISSUES`): retrodispersión, agrupación
   * del moteado y factor sobre la atenuación, por índice de tejido. Solo cambia lo que se sube a la GPU.
   */
  readonly tissueLook?: Readonly<
    Record<number, { readonly backscatter?: number; readonly speckleClump?: number; readonly attenuation?: number }>
  >;
  /** Aspecto por cara de esta persona: pendiente de la rugosidad con que se sube su eco de interfaz (decisión 368). */
  readonly interfaceLook?: Readonly<Record<number, { slopeRms?: number }>>;
}

export interface InstalledCpuPerson {
  readonly identity: PersonIdentity;
  readonly assetKey: string;
  readonly assets: PersonAssets;
  readonly cpu: AnatomyPerson;
}

export interface PersonSurfaces {
  readonly abdominal?: Float32Array;
  readonly thoracic?: Float32Array;
  readonly indexed?: readonly IndexedSourceSurface[];
}

export interface InstalledPerson extends InstalledCpuPerson {
  readonly loadSurfaces: () => Promise<PersonSurfaces>;
  readonly gpu: PersonGpuPlan;
}
