/**
 * Poses de inicio de s0028 por búsqueda sobre su anatomía fija: la sonda apunta a un hito de esta persona y el plano contiene su
 * eje largo; después se afina como haría un ecografista, deslizando, rotando y abanicando un poco. No mueve órganos ni costillas.
 *
 *   node --import tsx tools/anatomy/find-s0028-poses.ts [ventana]
 *
 * El resultado se copia a `S0028_POSES` de `src/app/startPoints.ts`; `s0028Windows.test.ts` vigila que sigan mostrando su hito.
 */
import { dot, normalize, scale, sub, type Vec3 } from '../../src/core/vec3';
import { CONVEX_C35, probeFrame, type ProbePose } from '../../src/probe/probe';
import { loadS0028, s0028WindowTargets, scoreWindow, type WindowScore } from './s0028Windows';

const { scene, anatomy, sample } = loadS0028();

const MARKER: Vec3 = normalize([-0.5, 0, 1]);
/** Pose en (phi, z) cuyo eje apunta a `pivot` y cuyo plano contiene la dirección `long`. */
function aimed(phi: number, z: number, pivot: Vec3, long: Vec3, maxAngle = 0.6): ProbePose | null {
  const pose = { phi, z, lift: 0, yaw: 0, rock: 0, tilt: 0 };
  const f = probeFrame(pose, scene.torso, CONVEX_C35);
  const a = normalize(sub(pivot, f.face));
  let l = normalize(sub(long, scale(a, dot(a, long))));
  // Convención de pantalla: el lado del marcador (izquierda de la imagen) mira a la cabeza o, en cortes transversales, a la derecha del paciente.
  if (dot(l, MARKER) < 0) l = scale(l, -1);
  const rock = Math.asin(Math.max(-1, Math.min(1, -dot(l, f.axial))));
  const yaw = Math.atan2(-dot(l, f.elevation), dot(l, f.lateral));
  const afterRock = probeFrame({ ...pose, yaw, rock }, scene.torso, CONVEX_C35);
  const tilt = Math.atan2(-dot(a, afterRock.elevation), dot(a, afterRock.axial));
  return Math.abs(rock) > maxAngle || Math.abs(tilt) > maxAngle ? null : { ...pose, yaw, rock, tilt };
}
const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;
const only = process.argv[2];
const result: Record<string, unknown> = {};
for (const t of s0028WindowTargets(scene).filter((t) => !only || t.id === only)) {
  let best: { pose: ProbePose; q: WindowScore } | undefined;
  const consider = (pose: ProbePose | null) => {
    if (!pose) return;
    const q = scoreWindow(anatomy, sample, pose, t);
    if (!best || q.score > best.q.score) best = { pose, q };
  };
  for (let phi = t.phi[0]; phi <= t.phi[1] + 1e-6; phi += 0.05)
    for (let z = t.z[0]; z <= t.z[1]; z += 5) consider(aimed(phi, z, t.pivot, t.long, t.maxAngle));
  for (let step = 1, rounds = 0; best && step >= 0.2 && rounds < 40; rounds++) {
    const from: { pose: ProbePose; q: WindowScore } = best;
    for (const [key, size] of [
      ['phi', 0.02],
      ['z', 3],
      ['yaw', 0.04],
      ['rock', 0.04],
      ['tilt', 0.03],
    ] as const)
      for (const sign of [-1, 1]) consider({ ...from.pose, [key]: from.pose[key] + sign * size * step });
    if (best === from) step /= 2;
  }
  const found = best;
  const rounded = (row: object, digits: number) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, round(Number(v), digits)]));
  result[t.id] = found && { pose: rounded(found.pose, 3), ...rounded(found.q, 2) };
  console.error(t.id, JSON.stringify(result[t.id]));
}
console.log(JSON.stringify(result, null, 1));
