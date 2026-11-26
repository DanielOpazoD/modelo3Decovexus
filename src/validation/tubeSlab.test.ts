import { beforeAll, expect, it } from 'vitest';
import { RespiratoryDeformation } from '../anatomy/deformation';
import { NODE_BASE, SCENE_TEX_W, TUBE_HEADER_TEXELS } from '../anatomy/gpu/anatomy.glsl';
import { TUBE_GRID_WIDTH } from '../anatomy/gpu/tubeGrid';
import { S0028_TUBE_SEGMENTS } from '../anatomy/people/s0028/vessels';
import { Simulator } from '../app/simulator';
import { startPointsFor } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import { clonePatient } from '../physiology/patientState';
import { RespiratoryModel } from '../physiology/respiratory';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine } from '../probe/probe';
import type { FrameInputs } from '../ultrasound/renderer';
import { tubeInSlab } from '../ultrasound/tubeSlab';
import { loadS0028Fixture } from './support/legacyPerson/loadS0028Fixture';
import { fixtureInstalled } from './support/legacyPerson/state';
import { BASELINE_CALIBER, type AnatomyScene } from './support/legacyPerson/scene';
import { recordingGl } from './support/recordingGl';

/**
 * Losa de tubos del cuadro (renderer `updateSceneDynamic`): la GPU solo ve los tubos que la CPU sube, así que todo píxel del
 * sector que la CPU clasifica como vaso debe tener su tubo en la lista. Las esferas son MATERIALES y el plano es del MUNDO: en
 * apnea inspiratoria (D = 30 mm) la losa fija de ± 12 mm perdía tramos de pvRightAnterior y pvLeftMedial en la porta subcostal
 * y la subcostal (42 y 9 píxeles de 128 × 160). Rejilla del sector con el contacto real (marco hundido y compresión).
 */
let scene: AnatomyScene;
beforeAll(() => {
  ({ scene } = loadS0028Fixture());
}, 60_000);

it('losa de tubos: todo vaso que la CPU ve en el sector tiene su tubo en la lista del cuadro, en reposo y en apnea inspiratoria', () => {
  const tr = CONVEX_C35,
    def = new RespiratoryDeformation(scene),
    deep = new RespiratoryModel({ ...NORMAL_ADULT, respiratoryPattern: 'apnea-inspiratory' }).sample(0);
  expect(deep.diaphragmCaudalMm).toBe(30);
  const missing: string[] = [];
  for (const pose of startPointsFor(scene.torso, scene.identity)) {
    const k = probeContact({ ...pose, rock: pose.rock ?? 0, tilt: pose.tilt ?? 0, lift: 0 }, tr, scene.torso),
      fr = k.frame;
    def.compression = k;
    for (const D of [0, 10, deep.diaphragmCaudalMm]) {
      const resp = { ...deep, diaphragmCaudalMm: D },
        caliber = { ...BASELINE_CALIBER, diaphragmCaudalMm: D };
      const kept = scene.tubeBounds.map((b) => tubeInSlab(b, fr, D));
      // el recorte sigue recortando: la lista no se llena con todos los tubos
      expect(kept.filter(Boolean).length, `${pose.id} D${D}`).toBeLessThan(scene.tubeBounds.length);
      const lost = new Map<string, number>();
      // 128 líneas × 160 muestras de 1 mm (16 cm)
      for (let line = 0; line < 128; line++)
        for (let j = 0; j < 160; j++) {
          const theta = tr.halfSector * ((2 * line + 1) / 128 - 1);
          const hit = scene.vesselTubeAt(def.toMaterial(pointOnLine(fr, tr, theta, j + 0.5), resp), caliber);
          if (!hit) continue;
          const i = scene.vessels.indexOf(hit.def);
          if (!kept[i]) lost.set(`${hit.def.id}#${i}`, (lost.get(`${hit.def.id}#${i}`) ?? 0) + 1);
        }
      for (const [tube, n] of lost) missing.push(`${pose.id} D${D} ${tube}: ${n} px`);
    }
  }
  expect(missing).toEqual([]);
});

/**
 * Con la sonda quieta, la lista del cuadro seguía a la D de cada instante y cada cambio rehacía la rejilla de tubos y resubía su
 * textura entera (RG32F, ~1 MB): 8 y 12 veces por respiración tranquila y 28 en la profunda en la hepatorrenal y la porta subcostal.
 * Renderer real sobre recordingGl, una respiración a 60 fps con el calibre fijo (sin él cambian además los alcances); la lista que
 * sube (índice original en H2.w de las cabeceras) contiene en cada cuadro la de la D exacta, la que cubre la prueba anterior.
 */
it('losa de tubos: con la sonda quieta la rejilla se resube ≤ 2 veces por respiración tranquila y ≤ 6 en la profunda, sin perder tubos', () => {
  const rec = recordingGl({ width: 320, height: 240 });
  const person = fixtureInstalled(),
    sim = new Simulator(clonePatient(NORMAL_ADULT), rec.canvas, undefined, undefined, {
      ...person,
      gpu: { ...person.gpu, tubeSegments: S0028_TUBE_SEGMENTS },
    });
  const gl = sim.renderer.gl,
    texImage2D = Reflect.get(gl, 'texImage2D'),
    texSubImage2D = Reflect.get(gl, 'texSubImage2D'),
    headerFloats = Math.ceil(NODE_BASE / SCENE_TEX_W) * SCENE_TEX_W * 4;
  let uploads = 0,
    headers = new Float32Array(0);
  gl.texImage2D = (...args: unknown[]) => {
    if (args[2] === gl.RG32F && args[3] === TUBE_GRID_WIDTH) uploads++;
    Reflect.apply(texImage2D, gl, args);
  };
  gl.texSubImage2D = (...args: unknown[]) => {
    const values = args.at(-1);
    if (args[3] === 0 && values instanceof Float32Array && values.length === headerFloats) headers = values.slice();
    Reflect.apply(texSubImage2D, gl, args);
  };
  const frames = Math.round((60 * 60) / NORMAL_ADULT.respiratoryRateMin),
    counts: Record<string, number> = {},
    lost: string[] = [];
  for (const pose of startPointsFor(sim.scene.torso, sim.scene.identity).filter((p) => ['hepatorenal', 'portalSubcostal'].includes(p.id)))
    for (const pattern of ['quiet', 'deep'] as const) {
      sim.setPose({ ...pose, rock: pose.rock ?? 0, tilt: pose.tilt ?? 0, lift: 0 });
      const model = new RespiratoryModel({ ...NORMAL_ADULT, respiratoryPattern: pattern }),
        fr = sim.frame;
      const inputs: FrameInputs = {
        sample: sim.sample,
        frame: fr,
        pose: sim.pose,
        compression: sim.contact,
        transducer: sim.transducer,
        caliber: sim.anatomy.caliberFor(sim.sample),
        probeVelocity: [0, 0, 0],
        bmode: sim.bmode,
        color: sim.color,
        updateColor: false,
        seed: sim.patient.seed,
      };
      for (let n = 0; n <= frames; n++) {
        if (n === 1) uploads = 0;
        const resp = model.sample(n / 60);
        sim.renderer.render({ ...inputs, sample: { ...inputs.sample, resp } });
        const kept = new Set<number>(),
          count = Number(Reflect.get(sim.renderer, 'tubeCount'));
        for (let k = 0; k < count; k++) kept.add(headers[(k * TUBE_HEADER_TEXELS + 2) * 4 + 3]);
        sim.scene.tubeBounds.forEach((b, i) => {
          if (tubeInSlab(b, fr, resp.diaphragmCaudalMm) && !kept.has(i)) lost.push(`${pose.id} ${pattern} cuadro ${n} #${i}`);
        });
      }
      counts[`${pose.id} ${pattern}`] = uploads;
    }
  expect(lost).toEqual([]);
  expect(Object.keys(counts)).toHaveLength(4);
  for (const [run, n] of Object.entries(counts)) expect(n, JSON.stringify(counts)).toBeLessThanOrEqual(run.endsWith('quiet') ? 2 : 6);
});
