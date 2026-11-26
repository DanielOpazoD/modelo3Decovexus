import type * as Three from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AnatomyScene, VesselCaliber } from '../anatomy/scene';
import { errorLog } from '../app/errorLog';
import { defaultPose, type ProbeFrame } from '../probe/probe';
import { Navigator3D } from '../ui/navigator3d';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';

/**
 * Pérdida y restauración del contexto WebGL del navegador 3D, con el `WebGLRenderer` de three sustituido por uno que
 * registra el color de fondo y el destino de cada dibujo, y la anatomía por grupos vacíos. Como el contexto real, el falso
 * responde `isContextLost()` y, perdido, `getParameter` da null. Al restaurarse, three vuelve a crear su estado
 * (`initGLContext`): el destino de la escena estática queda sin recursos y el fondo, en negro.
 */
const fake = vi.hoisted(() => ({ clearColors: [] as number[], renders: [] as unknown[] }));
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof Three>();
  class WebGLRenderer {
    readonly domElement = Object.assign(new EventTarget(), { style: {}, remove: () => undefined });
    autoClear = true;
    toneMapping = 0;
    toneMappingExposure = 1;
    #size = new three.Vector2();
    #target: unknown = null;
    #lost = false;
    constructor() {
      // como three, antes que los oyentes del navegador
      this.domElement.addEventListener('webglcontextlost', () => (this.#lost = true));
      this.domElement.addEventListener('webglcontextrestored', () => (this.#lost = false));
    }
    setPixelRatio(): void {}
    setClearColor(c: number): void {
      fake.clearColors.push(c);
    }
    getContext() {
      return { isContextLost: () => this.#lost, getParameter: () => (this.#lost ? null : 4) };
    }
    getSize(v: Three.Vector2): Three.Vector2 {
      return v.copy(this.#size);
    }
    getDrawingBufferSize(v: Three.Vector2): Three.Vector2 {
      return v.copy(this.#size);
    }
    setSize(w: number, h: number): void {
      this.#size.set(w, h);
    }
    setRenderTarget(t: unknown): void {
      this.#target = t;
    }
    render(): void {
      fake.renders.push(this.#target);
    }
    clear(): void {}
    dispose(): void {}
  }
  return { ...three, WebGLRenderer };
});
vi.mock('../ui/navigator3d/anatomyGroups', async () => {
  const { Group, Mesh, MeshStandardMaterial } = await import('three');
  return {
    buildAnatomyGroups: () => ({
      skin: new Mesh(undefined, new MeshStandardMaterial()),
      skeleton: new Group(),
      organs: new Group(),
      vessels: new Group(),
      windows: new Group(),
    }),
  };
});

beforeEach(() => {
  vi.stubGlobal('window', Object.assign(new EventTarget(), { devicePixelRatio: 1 }));
  vi.stubGlobal('WebGL2RenderingContext', { SAMPLES: 0x80a9 });
});
afterEach(() => vi.unstubAllGlobals());

it('la pérdida del contexto 3D llega a errorLog y, al restaurarse, la escena estática vuelve con su fondo', () => {
  const tr = CONVEX_C35_PROFILE.geometry;
  const frame: ProbeFrame = {
    face: [0, 100, 0],
    axial: [0, -1, 0],
    lateral: [1, 0, 0],
    elevation: [0, 0, 1],
    curvatureCenter: [0, 100 + tr.curvatureRadius, 0],
    skinNormal: [0, 1, 0],
    skinPoint: [0, 100, 0],
  };
  let canvas: EventTarget | null = null;
  const host = { clientWidth: 200, clientHeight: 150, appendChild: (el: EventTarget) => (canvas = el) };
  const nav = new Navigator3D(host as unknown as HTMLElement, {} as AnatomyScene, tr, {
    getPose: defaultPose,
    setPose: () => undefined,
    getFrame: () => frame,
    getDepthMm: () => 160,
    getRespCaudalMm: () => 0,
    getCaliber: () => ({}) as VesselCaliber,
  });
  const staticDraws = () => fake.renders.filter((t) => t !== null).length;
  const lost = () => errorLog.recent(50).find((e) => e.source === 'navegador3d' && e.message === 'contexto WebGL 3D perdido')?.count ?? 0;
  expect(fake.clearColors).toEqual([0x0f1319]);
  nav.draw();
  nav.draw();
  expect([staticDraws(), nav.renderRevision]).toEqual([1, 1]);
  const before = lost();
  canvas!.dispatchEvent(new Event('webglcontextlost'));
  expect(lost()).toBe(before + 1);
  // sin contexto no se envía nada ni se consume lo pendiente, aunque el lienzo cambie de tamaño (otra GPU u otro monitor)
  const sent = fake.renders.length;
  host.clientWidth = 240;
  nav.draw();
  expect([fake.renders.length, nav.renderRevision]).toEqual([sent, 1]);
  canvas!.dispatchEvent(new Event('webglcontextrestored'));
  expect(fake.clearColors).toEqual([0x0f1319, 0x0f1319]);
  // sin tocar nada, el siguiente dibujo rehace la escena estática en el contexto nuevo, a su tamaño y con su MSAA
  nav.draw();
  expect([staticDraws(), nav.renderRevision]).toEqual([2, 2]);
  const target = fake.renders.filter((t) => t !== null).at(-1) as Three.WebGLRenderTarget;
  expect([target.width, target.samples]).toEqual([240, 4]);
  nav.dispose();
  canvas!.dispatchEvent(new Event('webglcontextlost'));
  expect(lost()).toBe(before + 1);
});
