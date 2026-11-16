import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { MAX_NODES, MAX_TUBE_SEGMENTS } from '../anatomy/gpu/anatomy.glsl';
import { S0028_KIDNEY_FRAMES } from '../anatomy/people/s0028/cpu';
import { S0028_TUBE_SEGMENTS } from '../anatomy/people/s0028/vessels';
import { S0028_HEPATIC_BRANCHES, S0028_PORTAL_BRANCHES, S0028_TRUNKS } from '../anatomy/s0028TrunksData';
import { SCENE_TUBE_CAPACITY } from '../anatomy/tubeCapacity';
import { tubeQuery } from '../anatomy/primitives';
import { buildVesselTree, wallThicknessMm } from '../anatomy/vesselTree';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import witnesses from './fixtures/s0028-trunk-witnesses.json';
import { setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { S0028_BUNDLE as B, installAnatomyBundle } from './support/legacyPerson/anatomyBundle';
import { setAbdominalBody } from './support/legacyPerson/referenceBody';
import { setS0028Solids } from './support/legacyPerson/s0028Solids';
import { s0028SourceValue } from './support/legacyPerson/s0028Source';
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
  // Control: la misma persona con los troncos de la otra (sin los ganchos de las decisiones 345 y 354).
  const person = fixturePerson();
  foreign = new AnatomyScene(NORMAL_ADULT, undefined, {
    ...person,
    cpu: { ...person.cpu, curveVessels: undefined, smoothVessels: undefined },
  });
  // Cargar la persona tarda 2 s y unos 7 s bajo cobertura (pared, sólidos y escena, 2,3 s cada uno): el tope de 10 s por defecto
  // se agota con un runner lento. Mismo plazo que s0028Heart y s0028Capsule.
}, 60_000);
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
function maxTurnDeg(nodes: readonly { p: Vec3 }[]): number {
  let max = 0;
  for (let i = 1; i + 1 < nodes.length; i++) {
    const a = nodes[i].p.map((x, k) => x - nodes[i - 1].p[k]),
      b = nodes[i + 1].p.map((x, k) => x - nodes[i].p[k]);
    const cosine = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
    max = Math.max(max, (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI);
  }
  return max;
}
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

/** Madres portales que su rama continúa (decisión 385): terminan donde esta nace. */
const CONTINUED: Partial<Record<string, keyof typeof S0028_TRUNKS>> = { pvRight: 'pvRightAnterior' };

it('los troncos de s0028 son los de sus máscaras, en el sentido del flujo y dentro de los techos del tubo', () => {
  const reference = buildVesselTree(scene.kidneyRight, scene.kidneyLeft, true).vessels;
  for (const [id, [refRadius, nodes]] of Object.entries(S0028_TRUNKS)) {
    const v = scene.vesselById.get(id as never)!,
      drawn = v.tube.nodes,
      radii = nodes.map((n) => n[3]);
    // El eje dibujado es la curva que pasa por los nodos medidos (decisión 354): mismos extremos, cada nodo medido sobre él, sin
    // esquinas a la vista y dentro del techo de tramos de esta persona.
    // Una madre que su rama continúa termina donde esta nace (decisión 385): la porta derecha pierde los 2,5 mm que sobrepasaban
    // el origen de su rama anterior.
    const continued = CONTINUED[id],
      end = continued ? S0028_TRUNKS[continued][1][0] : nodes.at(-1)!,
      // …y su rama sale en su dirección: el segundo nodo medido de la rama, el de la esquina, cede a una curva.
      measured = continued ? nodes.slice(0, -1) : Object.values(CONTINUED).includes(id as never) ? [nodes[0], ...nodes.slice(2)] : nodes;
    expect(drawn[0].p, id).toEqual(nodes[0].slice(0, 3));
    expect(drawn.at(-1)!.p, id).toEqual(end.slice(0, 3));
    for (const n of measured) expect(toAxis(drawn, n.slice(0, 3) as Vec3), id).toBeLessThan(0.5);
    expect(drawn.length - 1, id).toBeLessThanOrEqual(S0028_TUBE_SEGMENTS);
    expect(maxTurnDeg(drawn), id).toBeLessThan(12);
    // Nunca más quebrado que los nodos medidos, salvo donde ya eran casi rectos (el reparto deja uniones de hasta 8°–9°).
    expect(maxTurnDeg(drawn), id).toBeLessThanOrEqual(Math.max(9, maxTurnDeg(nodes.map((n) => ({ p: n.slice(0, 3) as Vec3 })))) + 1e-9);
    // El radio es el medido (lineal entre sus nodos), salvo en las madres hepáticas y portales que la escena afila en su punta
    // (decisión 87).
    // Las suprahepáticas, además, se abren hacia su desembocadura (decisión 365): hasta 4 mm de radio las tres principales y el
    // tronco común, y ninguna se estrecha en el sentido del flujo.
    for (const n of drawn) expect(n.r, id).toBeLessThanOrEqual(Math.max(...radii, id.startsWith('hv') ? 4 : 0) + 1e-9);
    if (id.startsWith('hv')) {
      // Con 0,2 mm de holgura sobre el máximo anterior: el final de una tributaria no pasa del calibre de la vena que la recibe
      // (uniones sin nudo, decisión 358). Antes de la 365 la derecha perdía 0,8 mm de radio antes de la cava.
      for (let k = 1, widest = drawn[0].r; k < drawn.length; widest = Math.max(widest, drawn[k++].r))
        expect(drawn[k].r, `${id} ${k}`).toBeGreaterThanOrEqual(widest - 0.2);
      if (['hvRight', 'hvMiddle', 'hvLeft', 'hvCommonTrunk'].includes(id)) expect(drawn.at(-1)!.r, id).toBeGreaterThanOrEqual(4 - 1e-9);
    }
    if (!HEPATIC.includes(id) && !id.startsWith('pv')) {
      for (const n of drawn) expect(n.r, id).toBeGreaterThanOrEqual(Math.min(...radii) - 1e-9);
      expect([drawn[0].r, drawn.at(-1)!.r], id).toEqual([radii[0], radii.at(-1)]);
    }
    // El área de flujo es la medida, salvo en las suprahepáticas: la de referencia del adulto (decisión 392).
    expect(v.refRadius, id).toBe(
      id.startsWith('hv') ? reference.find((r) => r.id === id && r.flowFactor === undefined)!.refRadius : refRadius,
    );
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
  expect(Math.max(...scene.vessels.map((v) => v.tube.nodes.length))).toBeLessThanOrEqual(S0028_TUBE_SEGMENTS + 1);
  // La otra persona conserva sus tramos rectos y su techo.
  expect(Math.max(...foreign.vessels.map((v) => v.tube.nodes.length))).toBeLessThanOrEqual(MAX_TUBE_SEGMENTS + 1);
  expect(scene.vessels.length + scene.ducts.length).toBeLessThanOrEqual(SCENE_TUBE_CAPACITY);
  expect([...scene.vessels, ...scene.ducts].reduce((n, v) => n + v.tube.nodes.length, 0)).toBeLessThanOrEqual(MAX_NODES);
});

it('las ramas portales son las de su TAC: cuatro de segundo orden que nacen de su tronco y catorce más que cuelgan de ellas', () => {
  // Decisión 357: antes eran las de la otra persona, arrastradas a los troncos de s0028.
  for (const [child, parent] of [
    ['pvRightAnterior', 'pvRight'],
    ['pvRightPosterior', 'pvRight'],
    ['pvLeftLateral', 'pvLeft'],
    ['pvLeftMedial', 'pvLeft'],
  ]) {
    const nodes = axis(scene, child);
    expect(toAxis(axis(scene, parent), nodes[0].p), child).toBeLessThan(1);
    // Largas, y cada vez más finas hacia la periferia.
    expect(nodes.at(-1)!.r, child).toBeLessThan(nodes[0].r);
    // (el ajuste de radios por mínimos cuadrados deja como mucho una décima de subida entre nodos; el primero es la unión, que
    // no pasa del radio de su tronco allí: decisión 358)
    for (let i = 2; i < nodes.length; i++) expect(nodes[i].r, child).toBeLessThanOrEqual(nodes[i - 1].r + 0.15);
    expect(Math.hypot(...nodes[0].p.map((v, k) => v - nodes.at(-1)!.p[k])), child).toBeGreaterThan(45);
  }
  const own = scene.vessels.filter((v) => v.flowFactor !== undefined && v.tube.nodes.length > 2 && v.id.startsWith('pv'));
  expect(own).toHaveLength(S0028_PORTAL_BRANCHES.length);
  expect(S0028_PORTAL_BRANCHES.length).toBeGreaterThanOrEqual(12);
  own.forEach((v, i) => {
    const [mother, nodes] = S0028_PORTAL_BRANCHES[i];
    expect(v.id).toBe(mother);
    expect(v.tube.nodes[0].p).toEqual(nodes[0].slice(0, 3));
    // Comparten la pared periportal de su madre, más fina, y su punta se apaga sin bola.
    expect(v.wallTissue).toBe(scene.vesselById.get(mother)!.wallTissue);
    expect(v.tube.nodes.at(-1)!.r).toBeLessThan(1);
    // Su punta está dentro del hígado de esta persona (el origen puede estar en el hilio, fuera del parénquima).
    expect(scene.person.cpu.regional!.s0028SourceValue(nodes.at(-1)!.slice(0, 3) as unknown as Vec3, 'liver').d).toBeLessThan(2);
  });
  // Y siguen cabiendo ramas procedurales de tercer orden en los tubos que quedan.
  expect(
    scene.vessels.filter((v) => v.flowFactor !== undefined && v.tube.nodes.length === 2 && v.id.startsWith('pv')).length,
  ).toBeGreaterThan(10);
});

it('las tributarias suprahepáticas de su TAC drenan en su vena, sin nudo en la unión, y todas las madres conservan ramas', () => {
  // Decisión 358: cinco tributarias medidas, de la punta a la unión.
  const own = scene.vessels.filter((v) => v.flowFactor !== undefined && v.tube.nodes.length > 2 && v.id.startsWith('hv'));
  expect(own).toHaveLength(S0028_HEPATIC_BRANCHES.length);
  expect(S0028_HEPATIC_BRANCHES.length).toBeGreaterThanOrEqual(5);
  own.forEach((v, i) => {
    const [mother, nodes] = S0028_HEPATIC_BRANCHES[i],
      drawn = v.tube.nodes;
    expect(v.id).toBe(mother);
    // La punta se apaga y la unión cae sobre el eje de su vena, con un radio que no pasa del de esa vena allí.
    expect(drawn[0].r).toBeLessThan(1);
    expect(toAxis(axis(scene, mother), drawn.at(-1)!.p), mother).toBeLessThan(2.5);
    expect(drawn.at(-1)!.r, mother).toBeLessThanOrEqual(Math.max(...axis(scene, mother).map((n) => n.r)) + 1e-9);
    expect(drawn.at(-1)!.p).toEqual(nodes.at(-1)!.slice(0, 3));
  });
  // Ninguna vena con nombre desemboca más gruesa que la luz que la recibe (antes: 3,9 mm sobre un tramo de 2,8).
  for (const [child, parent] of [
    ['hvRightAnterior', 'hvRight'],
    ['hvRightPosterior', 'hvRight'],
    ['hvMiddleTributary', 'hvMiddle'],
  ]) {
    const end = axis(scene, child).at(-1)!,
      near = axis(scene, parent).reduce((a, b) =>
        Math.hypot(...b.p.map((x, k) => x - end.p[k])) < Math.hypot(...a.p.map((x, k) => x - end.p[k])) ? b : a,
      );
    expect(end.r, child).toBeLessThanOrEqual(near.r + 0.5);
  }
  // Con las ramas propias ocupando tubos, el tope por madre deja ramas procedurales a las once, también a la izquierda.
  for (const id of [
    'pvRightAnterior',
    'pvRightPosterior',
    'pvLeftLateral',
    'pvLeftMedial',
    'hvRightAnterior',
    'hvRightPosterior',
    'hvMiddleTributary',
    'hvLeftTributary',
    'hvRight',
    'hvMiddle',
    'hvLeft',
  ])
    expect(scene.vessels.filter((v) => v.id === id && v.flowFactor !== undefined).length, id).toBeGreaterThanOrEqual(2);
  expect(
    scene.vessels.filter((v) => v.id === 'hvLeft' && v.flowFactor !== undefined && v.tube.nodes.length === 2).length,
  ).toBeGreaterThanOrEqual(3);
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
    portalSmv: 'pvTrunk',
    celiacTrunk: 'aorta',
    sma: 'aorta',
    ima: 'aorta',
    renalArteryRight: 'aorta',
    renalArteryLeft: 'aorta',
    iliacArteryRight: 'aorta',
    iliacArteryLeft: 'aorta',
  };
  // Además de los troncos y sus seguidores: la esplénica (acompaña a su vena) y las dos hepáticas, retrazadas (decisión 354).
  const rerouted = ['splenicArtery', 'commonHepaticArtery', 'hepaticArtery'];
  expect([...moved].sort()).toEqual([...Object.keys(S0028_TRUNKS), ...Object.keys(followers), ...rerouted].sort());
  // La arteria esplénica, sin máscara, acompaña a la vena esplénica de la persona desde su origen celíaco (decisión 350).
  const artery = axis(scene, 'splenicArtery');
  expect(artery[0].p).toEqual(axis(foreign, 'splenicArtery')[0].p);
  // Su eje es una curva (decisión 354): sale del tronco celíaco, alcanza la vena y desde ahí no se separa de ella.
  const reach = artery.findIndex((n) => toAxis(axis(scene, 'portalSplenic'), n.p) < 6);
  expect(reach).toBeGreaterThan(0);
  expect(reach).toBeLessThan(artery.length / 2);
  for (const n of artery.slice(reach)) expect(toAxis(axis(scene, 'portalSplenic'), n.p)).toBeLessThan(6);
  const foreignRadii = axis(foreign, 'splenicArtery').map((n) => n.r);
  for (const n of artery) expect(n.r).toBeLessThanOrEqual(Math.max(...foreignRadii));
  for (const n of artery) expect(n.r).toBeGreaterThanOrEqual(Math.min(...foreignRadii));
  for (const [id, parent] of Object.entries(followers)) {
    const nodes = axis(scene, id),
      // La vena renal nace en el nodo del hilio, sin el del seno (decisión 389).
      old = id.startsWith('renalVein') ? axis(foreign, id).slice(1) : axis(foreign, id),
      // Las venas mueren en su tronco y las arterias y ramas portales nacen de él: el extremo unido es el más cercano.
      end = toAxis(axis(scene, parent), nodes[0].p) < toAxis(axis(scene, parent), nodes.at(-1)!.p) ? 0 : nodes.length - 1,
      far = nodes.length - 1 - end;
    // El extremo que tocaba al tronco lo sigue tocando; el otro no se ha movido
    expect(toAxis(axis(scene, parent), nodes[end].p), id).toBeLessThan(3);
    // (la mesentérica superior es la del propio TAC, entera: decisión 354).
    // La vena renal empieza en su nodo del hilio, que el desplazamiento de su cava ya movía un poco (0,7 mm la derecha).
    if (id.startsWith('renalVein'))
      expect(Math.hypot(...nodes[far].p.map((x, k) => x - old[far ? old.length - 1 : 0].p[k])), id).toBeLessThan(1.5);
    else if (id !== 'portalSmv') expect(nodes[far].p, id).toEqual(old[far ? old.length - 1 : 0].p);
    // Los radios son los suyos: iguales nodo a nodo, o lineales entre ellos si su eje se dibuja como curva. Los tres vasos
    // retrazados (decisión 354) llevan los de su tabla, dentro del calibre de su clase.
    if (['portalSmv', 'sma', 'renalArteryRight'].includes(id)) for (const n of nodes) expect(n.r > 1.9 && n.r <= 5, id).toBe(true);
    else if (nodes.length === old.length)
      expect(
        nodes.map((n) => n.r),
        id,
      ).toEqual(old.map((n) => n.r));
    else {
      expect([nodes[0].r, nodes.at(-1)!.r], id).toEqual([old[0].r, old.at(-1)!.r]);
      for (const n of nodes)
        expect(Math.min(...old.map((o) => o.r)) <= n.r + 1e-9 && n.r <= Math.max(...old.map((o) => o.r)) + 1e-9, id).toBe(true);
    }
  }
  // Lo demás no se mueve: la lista exacta de arriba ya lo exige; aquí, los testigos más visibles.
  expect(axis(scene, 'leftGastricArtery')).toEqual(axis(foreign, 'leftGastricArtery'));
  // La hepática común sigue naciendo del tronco celíaco y la propia continúa donde aquella acaba; termina junto a la rama
  // anterior de la porta derecha, con la que entra en el hígado (decisión 409), no en el destino de la otra persona.
  expect(axis(scene, 'commonHepaticArtery')[0].p).toEqual(axis(scene, 'celiacTrunk').at(-1)!.p);
  expect(axis(scene, 'hepaticArtery')[0].p).toEqual(axis(scene, 'commonHepaticArtery').at(-1)!.p);
  expect(toAxis(axis(scene, 'pvRightAnterior'), axis(scene, 'hepaticArtery').at(-1)!.p)).toBeLessThan(8);
});

it('la vía biliar de s0028 no atraviesa la luz del duodeno y su cístico nace en su vesícula (decisión 384)', () => {
  // Oráculo propio: las máscaras del tubo digestivo y de la vesícula de la fuente, leídas aquí sobre el eje de cada conducto.
  const duct = (s: AnatomyScene, id: string) => s.ducts.find((d) => d.id === id)!.tube.nodes;
  const insideGutMm = (nodes: readonly { p: Vec3 }[]) => {
    let mm = 0;
    for (let i = 0; i + 1 < nodes.length; i++) {
      const length = Math.hypot(...nodes[i + 1].p.map((v, a) => v - nodes[i].p[a]));
      for (let s = 0; s < length; s += 0.5) {
        const p = nodes[i].p.map((v, a) => v + ((nodes[i + 1].p[a] - v) * s) / length) as Vec3;
        if (s0028SourceValue(p, 'digestiveTract').d < -1) mm += 0.5;
      }
    }
    return mm;
  };
  // Control: la misma persona con la vía biliar de referencia, sin el gancho de la decisión.
  const person = fixturePerson();
  const before = new AnatomyScene(NORMAL_ADULT, undefined, { ...person, cpu: { ...person.cpu, placeDucts: undefined } });
  // Medido el 14-11-2026: el colédoco recorría 26,5 mm por dentro del duodeno y ahora 2,5 (roza el bulbo); el cístico, 0.
  expect(insideGutMm(duct(before, 'cbd'))).toBeGreaterThan(20);
  expect(insideGutMm(duct(scene, 'cbd'))).toBeLessThan(4);
  expect(insideGutMm(duct(scene, 'cysticDuct'))).toBe(0);
  // El cístico nace dentro de la vesícula de esta persona (antes, a más de 10 mm) y termina sobre el eje del colédoco.
  expect(s0028SourceValue(duct(scene, 'cysticDuct')[0].p, 'gallbladder').d).toBeLessThanOrEqual(0);
  expect(s0028SourceValue(duct(before, 'cysticDuct')[0].p, 'gallbladder').d).toBeGreaterThan(10);
  const end = duct(scene, 'cysticDuct').at(-1)!.p,
    cbd = duct(scene, 'cbd');
  let gap = Infinity;
  for (let i = 0; i + 1 < cbd.length; i++)
    for (let t = 0; t <= 1; t += 0.01)
      gap = Math.min(gap, Math.hypot(...end.map((v, a) => v - (cbd[i].p[a] + (cbd[i + 1].p[a] - cbd[i].p[a]) * t))));
  expect(gap).toBeLessThan(0.5);
  // Los hepáticos derecho e izquierdo nacen donde acaba el colédoco: la confluencia biliar (decisión 409).
  for (const id of ['rightHepaticDuct', 'leftHepaticDuct']) expect(duct(scene, id)[0].p).toEqual(cbd.at(-1)!.p);
});

it('tríada portal de s0028: colédoco anterolateral, arteria anteromedial y la arteria entre conducto y porta (decisión 409)', () => {
  // Oráculo propio: distancias de pared calculadas aquí sobre los ejes (muestras cada 0,5 mm), sin el lector de la aplicación.
  const tubes = [...mothers(scene), ...scene.ducts];
  const tube = (id: string) => tubes.find((t) => t.id === id)!;
  const wall = (t: (typeof tubes)[number], r: number) => ('wallTissue' in t ? wallThicknessMm(t, r) : t.wallMm);
  const samples = (id: string) =>
    tube(id).tube.nodes.flatMap((a, i, ns) => {
      if (!i) return [];
      const b = ns[i - 1],
        n = Math.max(1, Math.ceil(Math.hypot(...a.p.map((v, k) => v - b.p[k])) / 0.5));
      return Array.from({ length: n }, (_, s) => ({
        p: b.p.map((v, k) => v + ((a.p[k] - v) * s) / n) as Vec3,
        r: b.r + ((a.r - b.r) * s) / n,
      }));
    });
  /** Hueco entre paredes del tubo `id` y el `other` en cada muestra de `id` (mm). */
  const gaps = (id: string, other: string) =>
    samples(id).map((q) => {
      const hit = tubeQuery(q.p, tube(other).tube);
      return { p: q.p, gap: hit.d - q.r - wall(tube(id), q.r) - wall(tube(other), hit.r) };
    });
  // Ni el colédoco ni la hepática propia tocan la porta ni entre sí; antes el colédoco quedaba a 3,5–11 mm y la arteria a 7–22.
  for (const [a, b] of [
    ['cbd', 'pvTrunk'],
    ['cbd', 'pvLeft'],
    ['cbd', 'hepaticArtery'],
    ['hepaticArtery', 'pvTrunk'],
    ['hepaticArtery', 'pvRight'],
    ['hepaticArtery', 'pvLeft'],
    ['rightHepaticDuct', 'pvLeft'],
    ['rightHepaticDuct', 'hvMiddle'],
    ['leftHepaticDuct', 'pvLeft'],
    ['leftHepaticDuct', 'hvLeft'],
  ])
    expect(Math.min(...gaps(a, b).map((g) => g.gap)), `${a}/${b}`).toBeGreaterThan(0.3);
  // Pegados a la porta: ≥ 8 mm de colédoco y ≥ 25 mm de arteria a 2,5 mm o menos de su pared.
  expect(gaps('cbd', 'pvTrunk').filter((g) => g.gap <= 2.5).length * 0.5).toBeGreaterThanOrEqual(8);
  expect(gaps('hepaticArtery', 'pvTrunk').filter((g) => g.gap <= 2.5).length * 0.5).toBeGreaterThanOrEqual(25);
  // Lados en el ligamento: en el corte de la porta, el colédoco a la derecha del paciente y la arteria a la izquierda, ambos delante.
  const pv = axis(scene, 'pvTrunk');
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const nearest = (id: string, q: Vec3) => samples(id).reduce((b, s) => (dist(s.p, q) < dist(b.p, q) ? s : b)).p;
  for (const [i, n] of pv.entries()) {
    if (n.p[2] < -79 || n.p[2] > -74) continue;
    const t = pv[i + 1].p.map((v, k) => v - pv[i - 1].p[k]),
      ant = [0, 1, 0].map((v, k) => v - (t[k] * t[1]) / (t[0] ** 2 + t[1] ** 2 + t[2] ** 2)),
      right = [t[1] * ant[2] - t[2] * ant[1], t[2] * ant[0] - t[0] * ant[2], t[0] * ant[1] - t[1] * ant[0]].map((v, _, r) =>
        r[0] > 0 ? -v : v,
      );
    const along = (id: string, d: number[]) => nearest(id, n.p).reduce((s, v, k) => s + (v - n.p[k]) * d[k], 0);
    expect(along('cbd', ant), `colédoco anterior, z${n.p[2]}`).toBeGreaterThan(0);
    expect(along('cbd', right), `colédoco a la derecha, z${n.p[2]}`).toBeGreaterThan(0);
    expect(along('hepaticArtery', ant), `arteria anterior, z${n.p[2]}`).toBeGreaterThan(0);
    expect(along('hepaticArtery', right), `arteria a la izquierda, z${n.p[2]}`).toBeLessThan(0);
  }
  // El corte del colédoco: en ≥ 3 mm de su eje, la recta hasta el eje portal más cercano atraviesa la luz de la arteria.
  const crossing = samples('cbd').filter(({ p }) => {
    const q = nearest('pvTrunk', p);
    return Array.from({ length: 21 }, (_, k) => p.map((v, a) => v + ((q[a] - v) * k) / 20) as Vec3).some(
      (m) => tubeQuery(m, tube('hepaticArtery').tube).d < 0,
    );
  });
  expect(crossing.length * 0.5).toBeGreaterThanOrEqual(3);
  // Un solo corte los contiene: el plano por el tronco portal del ligamento y el colédoco deja a ≤ 3 mm el eje de los dos desde
  // la cabeza del páncreas hasta pasada la arteria (por encima, el hepático común sube a su confluencia), y la arteria lo
  // atraviesa entre los dos. Antes el colédoco cruzaba ese plano en oblicuo.
  const ligament = pv.filter((n) => n.p[2] >= -84).map((n) => n.p),
    duct = samples('cbd')
      .filter((q) => q.p[2] >= -84 && q.p[2] <= -68)
      .map((q) => q.p),
    points = [...ligament, ...duct],
    centre = points.reduce<number[]>((s, p) => s.map((v, k) => v + p[k] / points.length), [0, 0, 0]),
    along = ligament.at(-1)!.map((v, k) => v - ligament[0][k]);
  // El plano contiene la dirección del tronco: se busca su giro alrededor de ella que deja más cerca el punto más lejano.
  const across = [along[1], -along[0], 0],
    third = [
      along[1] * across[2] - along[2] * across[1],
      along[2] * across[0] - along[0] * across[2],
      along[0] * across[1] - along[1] * across[0],
    ];
  const unit = (v: number[]) => v.map((x) => x / Math.hypot(...v));
  let worst = Infinity;
  for (let deg = 0; deg < 180; deg++) {
    const n = unit(across).map((v, k) => v * Math.cos((deg * Math.PI) / 180) + unit(third)[k] * Math.sin((deg * Math.PI) / 180));
    worst = Math.min(worst, Math.max(...points.map((p) => Math.abs(p.reduce((s, v, k) => s + (v - centre[k]) * n[k], 0)))));
  }
  expect(worst).toBeLessThan(3);
});

it('la rama anterior de la porta derecha continúa a su madre sin gancho (decisión 385)', () => {
  // En el TAC la porta derecha sobrepasaba 2,5 mm el origen de su rama anterior y giraba 33° hacia ella. Oráculo: los nodos de
  // la tabla del TAC frente a los de la escena.
  const nodes = (id: string) => mothers(scene).find((v) => v.id === id)!.tube.nodes;
  const [right, anterior] = [nodes('pvRight'), nodes('pvRightAnterior')];
  const unit = (a: Vec3, b: Vec3) => {
    const d = b.map((x, k) => x - a[k]),
      n = Math.hypot(...d);
    return d.map((x) => x / n);
  };
  const angle = (u: number[], w: number[]) => (Math.acos(Math.min(1, u[0] * w[0] + u[1] * w[1] + u[2] * w[2])) * 180) / Math.PI;
  // La madre termina exactamente donde nace la rama, y la rama sale en su dirección.
  expect(Math.hypot(...right.at(-1)!.p.map((x, k) => x - anterior[0].p[k]))).toBeLessThan(1e-9);
  // Medido el 14-11-2026: 12° en la unión y 9,4° como mucho entre tramos de la rama; la tabla daba 32° en la unión.
  expect(angle(unit(right.at(-2)!.p, right.at(-1)!.p), unit(anterior[0].p, anterior[1].p))).toBeLessThan(15);
  expect(maxTurnDeg(anterior)).toBeLessThan(12);
  // Control: la tabla del TAC.
  const table = (id: keyof typeof S0028_TRUNKS) => S0028_TRUNKS[id][1].map(([x, y, z]) => [x, y, z] as Vec3);
  const [tr, ta] = [table('pvRight'), table('pvRightAnterior')];
  const u = unit(tr.at(-2)!, tr.at(-1)!),
    beyond = tr.at(-1)!.map((x, k) => x - ta[0][k]);
  expect(beyond[0] * u[0] + beyond[1] * u[1] + beyond[2] * u[2]).toBeGreaterThan(2);
  expect(angle(u, unit(ta[0], ta[1]))).toBeGreaterThan(25);
});

it('la vena renal de s0028 nace en el hilio, sin una cuña en mitad del seno (decisión 389)', () => {
  // Revisión del 14-11-2026: la vena renal derecha entraba 10 mm afilada en el seno y la ventana renal mostraba una cuña negra de
  // 10 × 16 mm que se lee como una pelvis dilatada. Medida: lo más hondo que llega su luz a lo largo del eje del hilio, desde el
  // centro del riñón (el seno de su TAC llega a 26–28 mm).
  const deepest = (s: AnatomyScene, id: 'renalVeinRight' | 'renalVeinLeft', k: number) => {
    const f = S0028_KIDNEY_FRAMES[k];
    return Math.min(...s.vesselById.get(id)!.tube.nodes.map((n) => n.p.reduce((a, x, i) => a + (x - f.center[i]) * f.hilum[i], 0) - n.r));
  };
  // Medido el 14-11-2026: 21,1 mm la derecha y 20,0 la izquierda; con el nodo del árbol común, 13 las dos.
  for (const [id, k] of [
    ['renalVeinRight', 0],
    ['renalVeinLeft', 1],
  ] as const) {
    expect(deepest(scene, id, k), id).toBeGreaterThan(19);
    // Control: sin la colocación de s0028 la vena nace 15 mm dentro del seno con 2 mm de radio.
    expect(deepest(foreign, id, k), id).toBeLessThan(15);
  }
});
