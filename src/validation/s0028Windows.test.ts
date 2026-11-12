import { beforeAll, expect, it } from 'vitest';
import { loadS0028, s0028WindowTargets, scoreWindow, type WindowScore } from '../../tools/anatomy/s0028Windows';
import { startPointsFor } from '../app/startPoints';
import type { ProbePose } from '../probe/probe';

let person: ReturnType<typeof loadS0028>;
beforeAll(() => {
  person = loadS0028();
});
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
    expect(q.coupled, tag).toBeGreaterThanOrEqual(0.9);
    // Fracción de la profundidad libre de barreras: la intercostal ve el pulmón al fondo, las demás casi nada.
    expect(q.clear, tag).toBeGreaterThanOrEqual(id === 'intercostal' ? 0.6 : 0.75);
  }
});

it('las poses de la otra persona no sirven en s0028: la porta intrahepática y la suprahepática quedaban tapadas', () => {
  // Control: la misma medida sobre las poses que s0028 heredaba. Si pasaran, las poses propias sobrarían.
  const foreign = scores('current');
  expect(foreign.portal.seen).toBeLessThan(0.5);
  expect(foreign.intercostal.seen).toBeLessThan(0.5);
  expect(foreign.hepatorenal.coupled).toBeLessThan(0.9);
});
