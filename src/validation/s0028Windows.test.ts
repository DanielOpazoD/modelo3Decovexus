import { beforeAll, expect, it } from 'vitest';
import {
  loadS0028,
  portalDarkLumen,
  renalSection,
  s0028AtriumWindow,
  sectorFraction,
  shadowedLumen,
  s0028WindowTargets,
  scoreWindow,
  type WindowScore,
} from '../../tools/anatomy/s0028Windows';
import { S0028_KIDNEY_FRAMES } from '../anatomy/people/s0028/cpu';
import { S0028_BUNDLE } from '../anatomy/people/s0028/descriptor';
import { Tissue } from '../anatomy/tissues';
import { bestGateOnVessel } from '../app/gatePlacement';
import { startPointsFor } from '../app/startPoints';
import { windowPreset } from '../app/windowPreset';
import type { Vec3 } from '../core/vec3';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, type ProbePose } from '../probe/probe';
import { BASELINE_CALIBER } from './support/legacyPerson/scene';

let person: ReturnType<typeof loadS0028>;
beforeAll(() => {
  person = loadS0028();
  // Cargar la persona tarda 2 s y unos 7 s bajo cobertura (pared, sólidos y escena, 2,3 s cada uno): el tope de 10 s por defecto
  // se agota con un runner lento. Mismo plazo que s0028Heart y s0028Capsule.
}, 60_000);
const poseOf = (id: string, identity: 's0028' | 'current'): ProbePose => {
  const sp = startPointsFor(person.scene.torso, { person: identity }).find((p) => p.id === id)!;
  return { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
};
const scores = (identity: 's0028' | 'current'): Record<string, WindowScore> =>
  Object.fromEntries(
    s0028WindowTargets(person.scene).map((t) => [t.id, scoreWindow(person.anatomy, person.sample, poseOf(t.id, identity), t)]),
  );

it('cada ventana de s0028 muestra su hito: dentro del sector, sin hueso ni pulmón delante y con la sonda apoyada', () => {
  for (const [id, q] of Object.entries(scores('s0028'))) {
    const tag = `${id}: ${JSON.stringify(q)}`;
    expect(q.seen, tag).toBeGreaterThanOrEqual(0.8);
    // Las ventanas de suprahepáticas apoyan junto al reborde costal: una quinta parte de sus líneas queda sin acoplar.
    expect(q.coupled, tag).toBeGreaterThanOrEqual(['intercostal', 'subcostal'].includes(id) ? 0.75 : 0.9);
    // Fracción de la profundidad libre de barreras: las que miran hacia la cava ven el pulmón al fondo.
    expect(q.clear, tag).toBeGreaterThanOrEqual(['intercostal', 'subcostal', 'subxiphoid'].includes(id) ? 0.6 : 0.75);
  }
});

it('las poses de la otra persona no sirven en s0028: la porta intrahepática y la suprahepática quedaban tapadas', () => {
  // Control: la misma medida sobre las poses que s0028 heredaba. Si pasaran, las poses propias sobrarían.
  const foreign = scores('current');
  expect(foreign.portal.seen).toBeLessThan(0.5);
  expect(foreign.intercostal.seen).toBeLessThan(0.5);
  // Hasta la decisión 374 el control era su acoplamiento (< 0,9): contaba como desacopladas las líneas que ven la pared de canto.
  // Desde la decisión 387 el riñón derecho mide 110 mm y la pose ajena lo alcanza a través del hígado en 5 de sus 25 líneas
  // (0,5, la mitad de lo que pide una ventana; antes, 4). El control pasa a comparar las dos poses: la propia gana por 2 puntos.
  expect(foreign.hepatorenal.seen).toBeLessThanOrEqual(0.5);
  expect(foreign.hepatorenal.score).toBeLessThan(scores('s0028').hepatorenal.score - 2);
});

it('la subcostal portal enseña la porta principal en eje largo sobre la cava (decisiones 381 y 386)', () => {
  // Valoración del responsable del 14-11-2026: la reconocía «con dudas» (3 de 5). La pose de la decisión 381 solo enseñaba el
  // codo de la bifurcación (32 mm de luz continua); la oblicua subcostal clásica pone la porta principal y su rama derecha en
  // eje largo. Misma medida de luz negra de la decisión 381, sobre todo el sector.
  const roi = { theta: [-0.5, 0.5] as [number, number], r: [40, 140] as [number, number] };
  const now = portalDarkLumen(person.anatomy, person.sample, poseOf('portalSubcostal', 's0028'), roi, 2);
  // Medido el 14-11-2026: 79,2 mm.
  expect(now.lengthMm).toBeGreaterThan(70);
  // Control: la pose de la decisión 381 (32,3 mm) y la anterior a ella (19 mm).
  for (const before of [
    { phi: 1.6, z: -49.4, lift: 0, yaw: -1.627, rock: 0.295, tilt: 0.255 },
    { phi: 1.6, z: -50, lift: 0, yaw: -1.602, rock: 0.295, tilt: 0.255 },
  ])
    expect(portalDarkLumen(person.anatomy, person.sample, before, roi, 2).lengthMm).toBeLessThan(40);
});

it('la hepatorrenal muestra el riñón a lo largo, sin costillas cruzando el campo ni el duodeno al lado (decisión 383)', () => {
  // Valoración del responsable del 14-11-2026: «puntos hiperecogénicos con sombra» y «una estructura tubular al lado del riñón».
  // El riñón derecho de este TAC mide 91 mm; la medida lee la clasificación de la CPU, no el render.
  const now = renalSection(person.anatomy, person.sample, poseOf('hepatorenal', 's0028'), 140);
  // Medido el 14-11-2026: 82,5 mm, una línea de 41 con hueso y 0,8 % del sector con luz de duodeno o vía biliar.
  expect(now.lengthMm).toBeGreaterThan(78);
  expect(now.boneNear).toBeLessThanOrEqual(0.05);
  expect(now.bowelLumen).toBeLessThan(0.012);
  // Control: la pose anterior cortaba 65,9 mm de riñón, con tres líneas de hueso y 2 % de luz de duodeno.
  const before = renalSection(person.anatomy, person.sample, { phi: 3.2, z: -90, lift: 0, yaw: -1.05, rock: 0.076, tilt: -0.236 }, 140);
  expect(before.lengthMm).toBeLessThan(70);
  expect(before.boneNear).toBeGreaterThan(0.05);
  expect(before.bowelLumen).toBeGreaterThan(0.015);
});

it('la intercostal muestra la suprahepática derecha entrando en la cava: una sola luz negra (decisión 383)', () => {
  // Valoración del responsable del 14-11-2026: «que quede más claro la unión de las venas hepáticas con la vena cava inferior».
  // La misma medida de luz negra de la decisión 381, sobre la vena, sobre la cava y sobre las dos juntas.
  const roi = { theta: [-0.5, 0.5] as [number, number], r: [40, 176] as [number, number] };
  const lumen = (pose: ProbePose, vessels: RegExp) => portalDarkLumen(person.anatomy, person.sample, pose, roi, 2, vessels);
  const pose = poseOf('intercostal', 's0028');
  const vein = lumen(pose, /^hvRight/),
    cava = lumen(pose, /^ivc/),
    both = lumen(pose, /^(hvRight|ivc)/);
  // Medido el 14-11-2026: vena 51,6 mm y 288 mm², cava 139 mm y 2.440 mm², y las dos unidas en una sola pieza de 2.728 mm².
  expect(vein.lengthMm).toBeGreaterThan(45);
  expect(both.areaMm2).toBeGreaterThan(cava.areaMm2 + 0.8 * vein.areaMm2);
  // Control: en la pose anterior la vena (32,9 mm) y la cava no llegaban a unirse en el plano.
  const old: ProbePose = { phi: 3.55, z: -100, lift: 0, yaw: -0.838, rock: 0.488, tilt: 0.456 };
  expect(lumen(old, /^(hvRight|ivc)/).areaMm2).toBeLessThan(lumen(old, /^ivc/).areaMm2 + 0.5 * lumen(old, /^hvRight/).areaMm2);
});

it('en la intercostal ninguna costilla cae sobre la suprahepática derecha (decisión 388)', () => {
  // Revisión del 14-11-2026: con la pose de la decisión 383 la costilla central tapaba el tramo alto de la vena y esta parecía
  // prolongar su sombra hasta la cava. Es donde se coloca el Doppler de la vena hepática.
  const roi = { theta: [-0.5, 0.5] as [number, number], r: [40, 176] as [number, number] };
  // Medido el 14-11-2026: el 0 % de la luz de la vena (398 mm² en el plano) bajo hueso o pulmón.
  const now = shadowedLumen(person.anatomy, person.sample, poseOf('intercostal', 's0028'), roi, /^hvRight/);
  expect(now.lumenMm2).toBeGreaterThan(300);
  expect(now.shadowed).toBeLessThan(0.03);
  // Control: la pose de la decisión 383 dejaba el 21 % en sombra.
  const before: ProbePose = { phi: 3.475, z: -70, lift: 0, yaw: -0.05, rock: 0.075, tilt: 0.112 };
  expect(shadowedLumen(person.anatomy, person.sample, before, roi, /^hvRight/).shadowed).toBeGreaterThan(0.12);
});

it('la intrahepática sigue la porta derecha y no corta la grasa junto a la vesícula (decisión 385)', () => {
  // Valoración del responsable del 14-11-2026: «demasiado brusco cómo se separa la porta en su rama» y «raro el borde del
  // hígado, como si tuviera concavidad». La concavidad era grasa junto a la vesícula entrando por el borde del sector.
  const roi = { theta: [-0.5, 0.5] as [number, number], r: [30, 126] as [number, number] };
  const fat = new Set([Tissue.Fat, Tissue.MesentericFat, Tissue.PerirenalFat, Tissue.UnsegmentedSoftTissue]);
  const measure = (pose: ProbePose) => ({
    lumen: portalDarkLumen(person.anatomy, person.sample, pose, roi, 2).lengthMm,
    fat: sectorFraction(person.anatomy, person.sample, pose, fat, [30, 110]),
  });
  const now = measure(poseOf('portal', 's0028')),
    before = measure({ phi: 2.8, z: -65, lift: 0, yaw: -0.996, rock: 0.097, tilt: 0.067 });
  // Medido el 14-11-2026: luz portal continua de 80,8 mm y 7,9 % de grasa; la pose anterior, 54,1 mm y 11,6 %.
  expect(now.lumen).toBeGreaterThan(72);
  expect(now.fat).toBeLessThan(0.095);
  expect(before.lumen).toBeLessThan(60);
  expect(before.fat).toBeGreaterThan(0.105);
});

it('la subxifoidea enseña la cava entrando en la aurícula derecha, en el centro y en sus vecinas (decisión 391)', () => {
  // Contrato de la otra persona (`ivcAtriumWindow.test.ts`): cinco rayos claros vecinos y 20 mm de aurícula, a más de 5° del borde.
  const sp = poseOf('subxiphoid', 's0028');
  for (const [rock, tilt] of [
    [0, 0],
    [0.035, 0],
    [-0.035, 0],
    [0, 0.035],
    [0, -0.035],
  ]) {
    const now = s0028AtriumWindow(person.anatomy, person.sample, { ...sp, rock: sp.rock + rock, tilt: sp.tilt + tilt });
    // Medido el 15-11-2026 en el centro: 13 rayos y 31 mm; en las vecinas, de 10 rayos y 21 mm a 15 y 36.
    expect(now.accepted, JSON.stringify({ rock, tilt, ...now })).toBe(true);
  }
  // Control: la pose anterior (decisión 351) dejaba la entrada a 30° de un sector de ±34° y la aurícula fuera.
  const before = { phi: 1.65, z: -65, lift: 0, yaw: -0.037, rock: 0.063, tilt: -0.115 };
  expect(s0028AtriumWindow(person.anatomy, person.sample, before).longestRun).toBe(0);
});

it('la ventana renal ofrece una vena interlobar a lo largo del haz, y sus interlobares van hacia el borde convexo (decisión 395)', () => {
  // Con el giro de la fila de la otra persona (−0,4π) iban de delante atrás y la mejor puerta quedaba a 57° del vaso (cos 0,54):
  // la S pequeña de la renal monofásica, cerca del suelo, salía bifásica. Medido el 15-11-2026: cos 0,93 con 1,3 mm a la pared.
  const frame = S0028_KIDNEY_FRAMES[0];
  for (const id of ['interlobarVein1', 'interlobarVein2', 'interlobarVein3', 'interlobarArtery2'] as const) {
    // el tramo interlobar: desde la decisión 402 la vena empieza en su arcuata y la arteria acaba en ella (dos nodos cada una)
    const all = person.scene.vessels.find((v) => v.id === id && v.flowFactor === undefined)!.tube.nodes;
    const nodes = id.includes('Vein') ? all.slice(-3) : all.slice(0, 3);
    const d = nodes[0].p.map((x, i) => x - nodes.at(-1)!.p[i]);
    const toBorder = -(d[0] * frame.hilum[0] + d[1] * frame.hilum[1] + d[2] * frame.hilum[2]) / Math.hypot(...d);
    // la vena va del borde al seno (sentido del flujo); la arteria al revés: lo que cuenta es la dirección
    expect(Math.abs(toBorder), id).toBeGreaterThan(0.85);
  }
  const pose = poseOf('renal', 's0028');
  const contact = probeContact(pose, CONVEX_C35, person.scene.torso);
  person.anatomy.setProbeCompression(contact);
  const best = bestGateOnVessel(
    person.anatomy,
    contact.frame,
    CONVEX_C35,
    person.sample,
    ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'],
    135,
  );
  expect(best, 'sin puerta en una interlobar').not.toBeNull();
  expect(best!.cosAngle).toBeGreaterThan(0.85);
});

it('cada tarjeta con Doppler enmarca en su caja de color el sitio de la puerta sobre su vaso', () => {
  // Las cajas de partida (`windowPreset`) se ajustaron a la otra persona; en s0028 los vasos están más hondos. Lo que importa al
  // alumno es que el sitio de la puerta (la técnica del operador) quede dentro. Medido el 15-11-2026: intercostal (84 mm),
  // subcostal (69), intrahepática en la rama derecha (77, a 42°), subcostal portal (96) y renal (86), todas dentro.
  for (const [id, vessels] of [
    ['intercostal', ['hvRight']],
    ['subcostal', ['hvMiddle', 'hvRight']],
    ['portal', ['pvRight']],
    ['portalSubcostal', ['pvTrunk']],
    ['renal', ['interlobarVein1', 'interlobarVein2', 'interlobarVein3']],
  ] as const) {
    const color: { theta0?: number; theta1?: number; r0?: number; r1?: number } = {};
    let depthMm = 180;
    for (const c of windowPreset(id, CONVEX_C35.f0Doppler, true, true)) {
      if (c.type === 'color') Object.assign(color, c.patch);
      if (c.type === 'bmode' && c.patch.depthMm !== undefined) depthMm = c.patch.depthMm;
    }
    const contact = probeContact(poseOf(id, 's0028'), CONVEX_C35, person.scene.torso);
    person.anatomy.setProbeCompression(contact);
    const gate = bestGateOnVessel(person.anatomy, contact.frame, CONVEX_C35, person.sample, [...vessels], depthMm - 5);
    expect(gate, `${id}: sin puerta`).not.toBeNull();
    const tag = `${id}: puerta θ ${gate!.theta.toFixed(2)} r ${gate!.r.toFixed(0)}, caja ${JSON.stringify(color)}`;
    expect(gate!.theta >= color.theta0! && gate!.theta <= color.theta1!, tag).toBe(true);
    expect(gate!.r >= color.r0! && gate!.r <= color.r1!, tag).toBe(true);
  }
});

it('el riñón derecho de s0028 mide 110 mm, sin pisar a sus vecinos, y la ventana renal lo enseña casi entero (decisión 387)', () => {
  // Valoración del responsable del 14-11-2026: «el riñón parece corto». El de su TAC medía 91 mm y 108 ml; se alarga a lo
  // largo de su eje, con el centro y el ancho fijos. Oráculo: el campo del riñón y el interior renal, leídos aquí punto a punto.
  const regional = person.scene.person.cpu.regional!,
    field = S0028_BUNDLE.fields.find((f) => f.name === 'kidneyRight')!;
  const frame = S0028_KIDNEY_FRAMES[0],
    long = frame.long,
    hilum = frame.hilum;
  let voxels = 0,
    labelled = 0,
    conflicts = 0,
    [lo, hi, wlo, whi] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let k = 0; k < field.dimensions[2]; k++)
    for (let j = 0; j < field.dimensions[1]; j++)
      for (let i = 0; i < field.dimensions[0]; i++) {
        const p: Vec3 = [field.originMm[0] + 1.5 * i, field.originMm[1] + 1.5 * j, field.originMm[2] + 1.5 * k];
        if (!(regional.s0028SourceValue(p, 'kidneyRight').d < 0)) continue;
        voxels++;
        const d = p.map((v, a) => v - frame.center[a]);
        const t = d[0] * long[0] + d[1] * long[1] + d[2] * long[2],
          w = d[0] * hilum[0] + d[1] * hilum[1] + d[2] * hilum[2];
        [lo, hi, wlo, whi] = [Math.min(lo, t), Math.max(hi, t), Math.min(wlo, w), Math.max(whi, w)];
        if ([1, 2].includes(regional.s0028RenalInterior(p))) labelled++;
        if ((i + j + k) % 3 === 0 && person.scene.classify(p, BASELINE_CALIBER).solids?.state === 'conflict') conflicts++;
      }
  // Medido el 14-11-2026: 109,6 mm de polo a polo, 59,0 de ancho, 128,2 ml, 98,4 % con corteza o médula, ningún conflicto.
  expect(hi - lo).toBeGreaterThan(105);
  expect(hi - lo).toBeLessThan(113);
  expect(whi - wlo).toBeLessThan(62);
  expect((voxels * 3.375) / 1000).toBeLessThan(135);
  expect(labelled / voxels).toBeGreaterThan(0.95);
  expect(conflicts).toBe(0);
  // La ventana renal enseña 106,9 mm de riñón (decisión 395; antes, 99,1); con el de 91 mm, 80,6.
  expect(renalSection(person.anatomy, person.sample, poseOf('renal', 's0028'), 140).lengthMm).toBeGreaterThan(95);
});
