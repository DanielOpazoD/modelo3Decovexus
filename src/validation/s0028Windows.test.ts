import { beforeAll, expect, it } from 'vitest';
import { loadS0028, s0028WindowTargets, scoreWindow, type WindowScore } from '../../tools/anatomy/s0028Windows';
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
