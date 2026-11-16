import { beforeAll, expect, it } from 'vitest';
import { loadS0028 } from '../../tools/anatomy/s0028Windows';
import { MAX_NODES } from '../anatomy/gpu/anatomy.glsl';
import { AnatomyQuery } from '../anatomy/query';
import { S0028_RENAL_NETWORK } from '../anatomy/s0028RenalNetworkData';
import { Tissue } from '../anatomy/tissues';
import { buildVesselTree } from '../anatomy/vesselTree';
import { HEPATIC_TUBE_CEILING, SCENE_TUBE_CAPACITY } from '../anatomy/tubeCapacity';
import { VenousSpectralAcquisition } from '../app/venousSpectral';
import { startPointsFor } from '../app/startPoints';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { VESSEL_META } from '../physiology/vessels';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine, type ProbePose } from '../probe/probe';
import { DEFAULT_BMODE } from '../ultrasound/renderer';

/**
 * Red interlobar de s0028 (decisión 402). Valoración del responsable del 15-11-2026: en el riñón la arteria y la vena van una junto a
 * otra (la puerta PW da trazado arterial y venoso) y los vasos no están en un solo plano. Antes: tres pares en la fila de la ventana,
 * ningún vaso a ±4° de abanico, y la puerta del alumno con la arteria al 0,3 %.
 */
let person: ReturnType<typeof loadS0028>;
beforeAll(() => {
  person = loadS0028();
}, 60_000);

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

it('cada arteria va pegada a su vena (una pared en común) y las dos en el sentido de su flujo', () => {
  const k = person.scene.kidneyRight;
  const axis = (p: readonly number[]) => {
    const d = [0, 1, 2].map((j) => p[j] - k.center[j]);
    const u = d[0] * k.u[0] + d[1] * k.u[1] + d[2] * k.u[2];
    return Math.hypot(d[0] - u * k.u[0], d[1] - u * k.u[1], d[2] - u * k.u[2]);
  };
  expect(S0028_RENAL_NETWORK).toHaveLength(16);
  for (const [, , artery, vein] of S0028_RENAL_NETWORK) {
    expect(artery.length).toBe(vein.length);
    for (let i = 0; i < artery.length; i++) {
      const a = artery[i],
        v = vein[vein.length - 1 - i];
      // ejes a la suma de los radios más una pared de 0,4 mm
      expect(dist(a, v)).toBeCloseTo(a[3] + v[3] + 0.4, 1);
    }
    // la arteria sale del seno hacia la corteza; la vena vuelve
    expect(axis(artery[2])).toBeGreaterThan(axis(artery[0]));
    expect(axis(vein.at(-1)!)).toBeLessThan(axis(vein[2]));
  }
});

it('el riñón enseña interlobares arteriales y venosas al abanicar y al deslizar la sonda fuera del plano de la ventana', () => {
  const { scene, anatomy, sample } = person;
  const sp = startPointsFor(scene.torso, scene.identity).find((s) => s.id === 'renal')!;
  const base: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
  const lumen = (pose: ProbePose) => {
    const contact = probeContact(pose, CONVEX_C35, scene.torso);
    anatomy.setProbeCompression(contact);
    const area: Record<string, number> = { interlobarArtery: 0, interlobarVein: 0 };
    const arc = (2 * CONVEX_C35.halfSector * (CONVEX_C35.curvatureRadius + 85)) / 120;
    for (let i = 0; i < 120; i++) {
      const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * (i + 0.5)) / 120;
      for (let r = 30; r < 140; r += 1) {
        const c = anatomy.classifyWorld(pointOnLine(contact.frame, CONVEX_C35, theta, r), sample);
        if (c.tissue === Tissue.Blood && c.vessel && VESSEL_META[c.vessel].system in area) area[VESSEL_META[c.vessel].system] += arc;
      }
    }
    return area;
  };
  const deg = Math.PI / 180;
  // Medido el 15-11-2026: en cada plano, 4–46 mm² de luz arterial y 5–131 de venosa (antes, 0 a ±4° de abanico y a +4°/+6° al deslizar).
  for (const d of [-8, -4, 0, 4, 8]) {
    for (const pose of [
      { ...base, tilt: base.tilt + d * deg },
      { ...base, phi: base.phi + d * deg },
    ]) {
      const a = lumen(pose);
      expect(a.interlobarArtery, `${JSON.stringify(pose)}`).toBeGreaterThan(2);
      expect(a.interlobarVein, `${JSON.stringify(pose)}`).toBeGreaterThan(2);
    }
  }
});

it('la puerta del alumno sobre la interlobar recoge su vena y su arteria: trazado venoso y arterial', () => {
  for (const base of [NORMAL_ADULT, SEVERE_CONGESTION]) {
    const patient = { ...base, respiratoryPattern: 'apnea-expiratory' as const };
    const engine = new PhysiologyEngine(patient, person.scene.vesselAreas());
    for (let i = 0; i < 500; i++) engine.step();
    const acq = new VenousSpectralAcquisition(
      new AnatomyQuery(person.scene),
      engine.sample,
      patient.seed,
      patient,
      DEFAULT_BMODE,
      'venous',
      'standard',
      2,
    );
    acq.push(
      Array.from({ length: 200 }, () => engine.step()),
      engine.clock.dt,
    );
    const by: Record<string, number> = {};
    for (const [id, w] of Object.entries(acq.chains[0].sampleVolume.lastComposition.vessels))
      by[VESSEL_META[id as keyof typeof VESSEL_META].system] = (by[VESSEL_META[id as keyof typeof VESSEL_META].system] ?? 0) + w;
    // Medido el 15-11-2026: vena 0,60–0,62 y arteria 0,07–0,09 (−8,5 dB); antes, arteria 0,003.
    expect(by.interlobarVein, base.id).toBeGreaterThan(0.4);
    expect(by.interlobarArtery, base.id).toBeGreaterThan(0.04);
    expect(by.interlobarArtery / by.interlobarVein, base.id).toBeLessThan(0.5);
  }
});

it('la red cabe con margen y no quita tubos a las ramas hepáticas', () => {
  const { scene } = person;
  const tubes = [...scene.vessels, ...scene.ducts];
  expect(tubes.length).toBeLessThanOrEqual(SCENE_TUBE_CAPACITY - 4);
  expect(tubes.reduce((n, t) => n + t.tube.nodes.length, 0)).toBeLessThanOrEqual(MAX_NODES - 24);
  const network = scene.vessels.filter((v) => v.flowFactor !== undefined && v.id.startsWith('interlobar'));
  expect(network).toHaveLength(2 * 13);
  // lo que reparten madres, vía biliar y ramas hepáticas sigue siendo el techo anterior
  expect(tubes.length - network.length).toBeLessThanOrEqual(HEPATIC_TUBE_CEILING);
  // las madres conservan su `refRadius` (área y velocidad)
  for (const id of ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'] as const)
    expect(scene.vesselById.get(id)!.refRadius).toBe(1.7);
  // el trayecto de cada vena madre (la de la puerta del alumno) es el del árbol: sus tres últimos nodos, sin mover
  const tree = buildVesselTree(scene.kidneyRight, scene.kidneyLeft, true).vessels;
  for (const id of ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'] as const) {
    const before = tree.find((v) => v.id === id)!.tube.nodes.map((n) => n.p);
    expect(
      scene.vesselById
        .get(id)!
        .tube.nodes.slice(-3)
        .map((n) => n.p),
    ).toEqual(before);
  }
});
