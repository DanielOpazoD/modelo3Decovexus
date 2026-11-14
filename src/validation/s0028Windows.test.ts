import { beforeAll, expect, it } from 'vitest';
import {
  loadS0028,
  portalDarkLumen,
  renalSection,
  sectorFraction,
  s0028WindowTargets,
  scoreWindow,
  type WindowScore,
} from '../../tools/anatomy/s0028Windows';
import { Tissue } from '../anatomy/tissues';
import { startPointsFor } from '../app/startPoints';
import type { ProbePose } from '../probe/probe';

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
  expect(foreign.hepatorenal.seen).toBeLessThan(0.5);
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
