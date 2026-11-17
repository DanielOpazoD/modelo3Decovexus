import type { Vec3 } from '../core/vec3';
import type { GastricWall } from './organs/abdomen';
import type { GallbladderShape } from './organs/gallbladder';
import type { HeartShape } from './organs/heart';
import type { createSourceQueries } from './people/s0028/atlas';
import type { createSolidsQueries } from './people/s0028/solids';
import type { createWallQueries } from './people/s0028/wall';
import type { PersonAssets, PersonIdentity } from './personAssets';
import type { createAbdominalQueries, createThoracicQueries } from './personAtlas';
import type { IndexedSourceSurface } from './s0028Surface';
import type { AnatomyScene } from './scene';
import type { DuctDef, VesselDef } from './vesselTree';
import type { Tissue } from './tissues';

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
  /** Vía biliar de esta persona a partir de la de referencia (s0028, decisión 384); solo construcción. */
  readonly placeDucts?: (ducts: DuctDef[]) => DuctDef[];
  /** Vesícula propia como pera de nodos (s0028, decisión 413): sustituye a la del atlas, contraída en su TAC. */
  readonly gallbladder?: Pick<GallbladderShape, 'nodes' | 'blendMm'>;
  /** Tope de ramas hepáticas procedurales por vaso madre, cuando la persona ya trae ramas propias y los tubos van justos. */
  readonly hepaticBranchesPerParent?: number;
  /**
   * Giro (rad) alrededor del eje largo del riñón de la fila de interlobares que mira a la ventana renal (decisiones 309 y 395); sin
   * él, `ATLAS_INTERIOR_TURN`, el de la otra persona.
   */
  readonly interlobarTurn?: number;
  /** Radio (mm) del cuerpo vertebral lumbar con que su cortical reparte el eco (decisión 368). */
  readonly lumbarBodyRadiusMm?: number;
  /**
   * Tejidos de esta persona que, además de la grasa mesentérica y la retroperitoneal, cuentan como grasa al otro lado de la
   * cápsula hepática y suben su eco (decisión 378). Par de la condición que la GLSL de la persona añade a `interfaceEcho`.
   */
  readonly capsuleFatTissues?: readonly number[];
  /** Tras colocar las ramas procedurales: el eje de los vasos madre como curva (más nodos, mismos extremos). */
  readonly smoothVessels?: (vessels: VesselDef[]) => void;
  /**
   * Red interlobar de la persona (s0028, decisión 402): cambia las interlobares madre y devuelve sus ramas, que van al final de la
   * lista, tras las hepáticas (no mueven el índice, la semilla de su forma, de ningún otro tubo).
   */
  readonly renalNetwork?: (vessels: VesselDef[]) => VesselDef[];
  readonly regional?: ReturnType<typeof createSourceQueries> &
    ReturnType<typeof createWallQueries> &
    ReturnType<typeof createSolidsQueries>;
  readonly fitBody: (profile: Float32Array, wallMm: number, skinMm: number) => Float32Array;
  readonly digestiveWallMm: (label: number) => number;
  readonly digestiveGas: (point: Vec3, label: number) => number;
  readonly isColon: (label: number) => boolean;
  /** Tejido de la luz del duodeno y el intestino delgado cuando no es líquido anecoico (s0028, decisión 384); sin él, `Tissue.Fluid`. */
  readonly smallBowelContents?: Tissue;
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
  /**
   * Aspecto por cara de esta persona: pendiente de la rugosidad (decisión 368) y ganancia de amplitud (decisión 390) con que se
   * sube su eco de interfaz.
   */
  readonly interfaceLook?: Readonly<Record<number, { slopeRms?: number; gain?: number }>>;
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
