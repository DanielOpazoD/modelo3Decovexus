import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { installDefaultCpu } from '../anatomy/people/default/cpu';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { kidneyLocal, perirenalOuterSdf } from '../anatomy/organs/kidney';
import { kidneyQuery } from '../anatomy/people/default/kidneyInterior';
import { buildVesselTree } from '../anatomy/vesselTree';
import { tubeQuery } from '../anatomy/primitives';
import { NORMAL_ADULT } from '../cases';
import { Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import { UltrasoundRenderer } from '../ultrasound/renderer';
import { Simulator } from '../app/simulator';
import { clonePatient } from '../physiology/patientState';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import { recordingGl } from './support/recordingGl';
const load = (name: string) => {
  const b = gunzipSync(readFileSync(`src/anatomy/${name}-atlas.gzip.bin`));
  return new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const b = readFileSync('src/anatomy/abdominal-body.bin');
const person = installDefaultCpu({
  abdominal: load('abdominal'),
  thoracic: load('thoracic'),
  body: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
});
const scene = new AnatomyScene(NORMAL_ADULT, undefined, person);
const branches = scene.vessels.filter((v) => v.id.startsWith('interlobar'));
describe('red renal continua dentro del parénquima (339)', () => {
  it('conecta las seis raíces a su padre, mantiene los tramos adquiridos y detecta las raíces antes desconectadas', () => {
    const original = buildVesselTree(scene.kidneyRight, scene.kidneyLeft, true).vessels;
    expect(branches).toHaveLength(6);
    for (const v of branches) {
      const venous = v.id.includes('Vein');
      const parent = scene.vesselById.get(venous ? 'renalVeinRight' : 'renalArteryRight')!;
      const root = parent.tube.nodes[venous ? 0 : parent.tube.nodes.length - 1];
      const nodes = v.tube.nodes;
      const end = nodes[venous ? nodes.length - 1 : 0];
      expect(end.p).toEqual(root.p);
      expect(end.r).toBeLessThanOrEqual(root.r);
      const old = original.find((o) => o.id === v.id)!;
      expect(venous ? nodes.slice(0, 3) : nodes.slice(-3)).toEqual(old.tube.nodes);
      expect(v.refRadius).toBe(old.refRadius);
      expect(v.wallMm).toBe(old.wallMm);
      const oldRoot = old.tube.nodes[venous ? 2 : 0];
      expect(Math.hypot(...oldRoot.p.map((x, i) => x - root.p[i]))).toBeGreaterThan(5);
      expect(tubeQuery(end.p, parent.tube).d).toBeLessThan(0);
      expect(scene.classify(end.p, BASELINE_CALIBER).tissue).toBe(Tissue.Blood);
    }
  });
  it('separa luces y paredes arteriales de las venosas y mantiene la red fuera de la médula y de la cápsula', () => {
    let trials = 0;
    const dirs = Array.from({ length: 32 }, (_, i): Vec3 => {
      const z = 1 - (2 * (i + 0.5)) / 32,
        a = i * 2.399963229728653,
        r = Math.sqrt(1 - z * z);
      return [r * Math.cos(a), r * Math.sin(a), z];
    });
    for (const v of branches) {
      const venous = v.id.includes('Vein');
      const opposite = scene.vessels.filter(
        (o) =>
          (o.id.startsWith('interlobar') || o.id === 'renalArteryRight' || o.id === 'renalVeinRight') &&
          o.id.includes(venous ? 'Artery' : 'Vein'),
      );
      const nodes = v.tube.nodes;
      for (let j = 0; j + 1 < nodes.length; j++)
        for (let i = 0; i <= 40; i++) {
          const t = i / 40,
            a = nodes[j],
            b = nodes[j + 1];
          const p = a.p.map((x, k) => x + t * (b.p[k] - x)) as Vec3,
            r = a.r + t * (b.r - a.r) + v.wallMm;
          for (const o of opposite) expect(tubeQuery(p, o.tube).d - r - o.wallMm, `${v.id}/${o.id}/${j}/${i}`).toBeGreaterThan(0);
          for (const d of dirs) {
            const q = p.map((x, k) => x + r * d[k]) as Vec3,
              h = kidneyQuery(q, scene.kidneyRight);
            if (h.dOuter >= 0) {
              const local = kidneyLocal(q, scene.kidneyRight);
              const parent = scene.vesselById.get(venous ? 'renalVeinRight' : 'renalArteryRight')!;
              expect(local[1], `${v.id}/${j}/${i} salida medial`).toBeGreaterThan(scene.kidneyRight.sinusOffset);
              expect(
                Math.min(perirenalOuterSdf(local, scene.kidneyRight), tubeQuery(q, parent.tube).d - parent.wallMm),
                `${v.id}/${j}/${i} salida hiliar`,
              ).toBeLessThanOrEqual(0);
            }
            expect(h.region, `${v.id}/${j}/${i} médula`).not.toBe('medulla');
            trials++;
          }
        }
    }
    expect(trials).toBeGreaterThan(20000);
  });
});

// Fixtures de identidad para seleccionar programas: no son una instalación anatómica s0028.
const withIdentity = (identity: 'current' | 's0028') => ({
  ...person,
  identity: { ...person.identity, person: identity },
  cpu: { ...person.cpu, kidneyFrame: identity === 'current' ? person.cpu.kidneyFrame : undefined },
});
/** WebGL falso que dice ser `backend` (WEBGL_debug_renderer_info): el renderer elige los programas de ese equipo. */
function backendGl(backend: string) {
  const rec = recordingGl({ width: 320, height: 240 });
  const gl = rec.canvas.getContext('webgl2')!;
  const extension = gl.getExtension.bind(gl),
    parameter = gl.getParameter.bind(gl);
  gl.getExtension = ((name: string) =>
    name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 999999 } : (extension(name) as unknown)) as typeof gl.getExtension;
  gl.getParameter = (key: number) => (key === 999999 ? backend : (parameter(key) as unknown));
  return rec;
}
it('limita A0 nativo con precálculo y el seno nuevo a current; s0028 va por etapas también en la GPU nativa (decisión 406)', () => {
  for (const identity of ['current', 's0028'] as const)
    for (const backend of ['Metal', 'SwiftShader']) {
      const scoped = new AnatomyScene(NORMAL_ADULT, undefined, withIdentity(identity));
      expect(scoped.kidneyRight.sinusRadii).toEqual(identity === 'current' ? [30, 9, 6.5] : [30, 12, 6.5]);
      const rec = backendGl(backend);
      const renderer = new UltrasoundRenderer(rec.canvas, scoped, CONVEX_C35_PROFILE);
      expect(renderer.transmissionHitsPipeline).toBe('staged-atlas');
      expect(!!Reflect.get(renderer, 'rawStages')).toBe(backend === 'SwiftShader' || identity === 's0028');
      renderer.dispose();
      expect(rec.misuse).toEqual([]);
    }
});

// Una repetición de medida (`frameCostMs`) emite solo el último dibujo de la pasada: con B o A0 por etapas mediría una
// fracción de su coste sin decirlo, así que lanza antes de dibujar nada.
it('repetir B o A0 por etapas lanza antes de dibujar; sin etapas, se repite', () => {
  for (const [identity, backend] of [
    ['s0028', 'Metal'],
    ['s0028', 'SwiftShader'],
    ['current', 'Metal'],
  ] as const) {
    const rec = backendGl(backend);
    const installed = {
      ...withIdentity(identity),
      gpu: { specializeFragment: (s: string) => s, uploads: [] },
      loadSurfaces: () => Promise.resolve({}),
    };
    const sim = new Simulator(clonePatient(NORMAL_ADULT), rec.canvas, undefined, undefined, installed);
    const rawStaged = !!Reflect.get(sim.renderer, 'rawStages');
    expect(rawStaged).toBe(identity === 's0028');
    for (const pass of ['transmissionHits', 'rawField'] as const) {
      rec.draws.length = 0;
      const run = () => sim.render({ repeat: { pass, times: 3 } });
      if (pass === 'transmissionHits' || rawStaged) {
        expect(run, `${identity}/${backend} ${pass}`).toThrow(/por etapas/);
        expect(rec.draws).toHaveLength(0);
      } else {
        run();
        expect(rec.draws.length).toBeGreaterThan(3);
      }
    }
    sim.dispose();
    expect(rec.misuse).toEqual([]);
  }
});
