import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { MAX_NODES, MAX_TUBE_SEGMENTS } from '../anatomy/gpu/anatomy.glsl';
import { S0028_TRUNKS } from '../anatomy/s0028TrunksData';
import { SCENE_TUBE_CAPACITY } from '../anatomy/tubeCapacity';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import witnesses from './fixtures/s0028-trunk-witnesses.json';
import { setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { S0028_BUNDLE as B, installAnatomyBundle } from './support/legacyPerson/anatomyBundle';
import { setAbdominalBody } from './support/legacyPerson/referenceBody';
import { setS0028Solids } from './support/legacyPerson/s0028Solids';
import { setS0028Wall } from './support/legacyPerson/s0028Wall';
import { AnatomyScene, BASELINE_CALIBER } from './support/legacyPerson/scene';
import { fixturePerson } from './support/legacyPerson/state';
import { setThoracicAtlas } from './support/legacyPerson/thoracicAtlas';

const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
let scene: AnatomyScene, foreign: AnatomyScene;
beforeAll(() => {
  installAnatomyBundle(B);
  setAbdominalAtlas(new Uint16Array(raw('abdominal-direct')));
  setThoracicAtlas(new Uint16Array(raw('thoracic-direct')));
  const capacity = raw('annotation-capacity');
  setS0028Wall(capacity, raw('skin-polar'));
  setS0028Solids(capacity);
  setAbdominalBody(new Float32Array(new Uint8Array(readFileSync('src/anatomy/abdominal-body.bin')).buffer));
  scene = new AnatomyScene(NORMAL_ADULT);
  // Control: la misma persona con los troncos de la otra (sin el gancho de la decisión 345).
  const person = fixturePerson();
  foreign = new AnatomyScene(NORMAL_ADULT, undefined, { ...person, cpu: { ...person.cpu, curveVessels: undefined } });
});
const mothers = (s: AnatomyScene) => s.vessels.filter((v) => v.flowFactor === undefined);
const axis = (s: AnatomyScene, id: string) => s.vesselById.get(id as never)!.tube.nodes;
const PORTAL = ['pvTrunk', 'pvRight', 'pvLeft', 'portalSplenic', 'portalSmv'];
const HEPATIC = [
  'hvRight',
  'hvRightAnterior',
  'hvRightPosterior',
  'hvMiddle',
  'hvMiddleTributary',
  'hvLeft',
  'hvLeftTributary',
  'hvCommonTrunk',
];
const inside = (s: AnatomyScene, points: number[][], ids: readonly string[]) =>
  points.filter((p) => ids.includes(s.classify(p as Vec3, BASELINE_CALIBER).vessel ?? '')).length / points.length;
/** Distancia de un punto a una poligonal, sin usar el lector de la aplicación. */
function toAxis(nodes: readonly { p: Vec3 }[], q: Vec3): number {
  let best = Infinity;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i].p,
      ab = nodes[i + 1].p.map((x, k) => x - a[k]),
      t = Math.min(1, Math.max(0, ab.reduce((sum, x, k) => sum + x * (q[k] - a[k]), 0) / ab.reduce((sum, x) => sum + x * x, 0)));
    best = Math.min(best, Math.hypot(...ab.map((x, k) => a[k] + t * x - q[k])));
  }
  return best;
}

it('los troncos de s0028 son los de sus máscaras, en el sentido del flujo y dentro de los techos del tubo', () => {
  for (const [id, [refRadius, nodes]] of Object.entries(S0028_TRUNKS)) {
    const v = scene.vesselById.get(id as never)!;
    expect(
      v.tube.nodes.map((n) => n.p),
      id,
    ).toEqual(nodes.map((n) => n.slice(0, 3)));
    // El radio es el medido, salvo en las madres hepáticas y portales que la escena afila en su punta (decisión 87).
    v.tube.nodes.forEach((n, i) => expect(n.r, id).toBeLessThanOrEqual(nodes[i][3]));
    if (!HEPATIC.includes(id) && !id.startsWith('pv'))
      expect(
        v.tube.nodes.map((n) => n.r),
        id,
      ).toEqual(nodes.map((n) => n[3]));
    expect(v.refRadius, id).toBe(refRadius);
  }
  // Una sola máscara portal: la esplénica muere donde nace el tronco, y de su final nacen las dos ramas.
  expect(axis(scene, 'portalSplenic').at(-1)!.p).toEqual(axis(scene, 'pvTrunk')[0].p);
  expect(axis(scene, 'pvRight')[0].p).toEqual(axis(scene, 'pvTrunk').at(-1)!.p);
  expect(axis(scene, 'pvLeft')[0].p).toEqual(axis(scene, 'pvTrunk').at(-1)!.p);
  // Las suprahepáticas drenan hacia la cava: la media y la izquierda mueren donde nace el tronco común, y este y la derecha, en la
  // luz de la cava; las ramas de la derecha y la tributaria de la media, sobre el eje de su tronco.
  expect(axis(scene, 'hvMiddle').at(-1)!.p).toEqual(axis(scene, 'hvCommonTrunk')[0].p);
  expect(axis(scene, 'hvLeft').at(-1)!.p).toEqual(axis(scene, 'hvCommonTrunk')[0].p);
  for (const id of ['hvRight', 'hvCommonTrunk']) expect(toAxis(axis(scene, 'ivcInfra'), axis(scene, id).at(-1)!.p), id).toBeLessThan(3);
  for (const [child, parent] of [
    ['hvRightAnterior', 'hvRight'],
    ['hvRightPosterior', 'hvRight'],
    ['hvMiddleTributary', 'hvMiddle'],
  ])
    expect(toAxis(axis(scene, parent), axis(scene, child).at(-1)!.p), child).toBeLessThan(1);
  // La aorta baja; la porta entra en el hígado hacia la derecha del paciente (x menor).
  expect(axis(scene, 'aorta')[0].p[2]).toBeGreaterThan(axis(scene, 'aorta').at(-1)!.p[2]);
  expect(axis(scene, 'pvTrunk')[0].p[0]).toBeGreaterThan(axis(scene, 'pvTrunk').at(-1)!.p[0]);
  expect(Math.max(...scene.vessels.map((v) => v.tube.nodes.length))).toBeLessThanOrEqual(MAX_TUBE_SEGMENTS + 1);
  expect(scene.vessels.length + scene.ducts.length).toBeLessThanOrEqual(SCENE_TUBE_CAPACITY);
  expect([...scene.vessels, ...scene.ducts].reduce((n, v) => n + v.tube.nodes.length, 0)).toBeLessThanOrEqual(MAX_NODES);
});

it('los testigos del TAC caen en la luz del vaso; con los troncos de la otra persona, no', () => {
  // Testigos: vóxeles de la máscara a más de 2,2 mm (porta) o 3 mm (aorta) de su borde. El tubo es circular, con el radio inscrito:
  // el 9 % portal que queda fuera está a 4–7 mm del eje, donde la máscara es más ancha (confluencia y porción umbilical).
  expect(inside(scene, witnesses.portal, PORTAL)).toBeGreaterThan(0.85);
  expect(inside(scene, witnesses.aorta, ['aorta'])).toBeGreaterThan(0.95);
  expect(inside(foreign, witnesses.portal, PORTAL)).toBeLessThan(0.25);
  expect(inside(foreign, witnesses.aorta, ['aorta'])).toBeLessThan(0.6);
  // Suprahepáticas (decisión 349): vóxeles realzados del hígado, fuera de la porta, junto al esqueleto que el candidato P5 conecta
  // a la cava. El 16 % que queda fuera está a 2,5–5 mm del eje: borde de la luz y ramas que el tubo no modela. Las venas de la
  // otra persona no pasaban por casi ninguno.
  expect(inside(scene, witnesses.hepatic, HEPATIC)).toBeGreaterThan(0.75);
  expect(inside(foreign, witnesses.hepatic, HEPATIC)).toBeLessThan(0.1);
});

it('solo se mueven los troncos y los vasos que nacían de ellos; cada uno sigue tocando a su tronco', () => {
  const moved = mothers(scene)
    .filter((v) => JSON.stringify(v.tube.nodes) !== JSON.stringify(foreign.vesselById.get(v.id)!.tube.nodes))
    .map((v) => v.id);
  const followers = {
    ivcSupra: 'ivcInfra',
    renalVeinRight: 'ivcInfra',
    renalVeinLeft: 'ivcInfra',
    iliacVeinRight: 'ivcInfra',
    iliacVeinLeft: 'ivcInfra',
    hvLeftTributary: 'hvLeft',
    pvRightAnterior: 'pvRight',
    pvRightPosterior: 'pvRight',
    pvLeftLateral: 'pvLeft',
    pvLeftMedial: 'pvLeft',
    portalSmv: 'pvTrunk',
    celiacTrunk: 'aorta',
    sma: 'aorta',
    ima: 'aorta',
    renalArteryRight: 'aorta',
    renalArteryLeft: 'aorta',
    iliacArteryRight: 'aorta',
    iliacArteryLeft: 'aorta',
  };
  expect([...moved].sort()).toEqual([...Object.keys(S0028_TRUNKS), ...Object.keys(followers)].sort());
  for (const [id, parent] of Object.entries(followers)) {
    const nodes = axis(scene, id),
      old = axis(foreign, id),
      // Las venas mueren en su tronco y las arterias y ramas portales nacen de él: el extremo unido es el más cercano.
      end = toAxis(axis(scene, parent), nodes[0].p) < toAxis(axis(scene, parent), nodes.at(-1)!.p) ? 0 : nodes.length - 1,
      far = nodes.length - 1 - end;
    // El extremo que tocaba al tronco lo sigue tocando; el otro no se ha movido.
    expect(toAxis(axis(scene, parent), nodes[end].p), id).toBeLessThan(3);
    expect(nodes[far].p, id).toEqual(old[far].p);
    expect(
      nodes.map((n) => n.r),
      id,
    ).toEqual(old.map((n) => n.r));
  }
  // Lo demás no se mueve: la lista exacta de arriba ya lo exige; aquí, los testigos más visibles.
  for (const id of ['interlobarVein1', 'hepaticArtery', 'splenicArtery']) expect(axis(scene, id), id).toEqual(axis(foreign, id));
});
