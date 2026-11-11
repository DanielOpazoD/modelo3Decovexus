import { cross, normalize, sub } from '../../../core/vec3';
import type { Vec3 } from '../../../core/vec3';
import type { TubeNode } from '../../primitives';
import type { VesselDef } from '../../vesselTree';
import type { VesselId } from '../../../physiology/vessels';

/** [EXTRAPOLACIÓN PROPIA] Trayecto curvo entre hitos existentes; el ostio sigue al padre.
 * Sólo construcción: CPU, GLSL, pared y flujo consumen los mismos nodos. */
export function curvedBranch(nodes: readonly TubeNode[], parent: readonly TubeNode[], atStart: boolean): TubeNode[] {
  if (
    nodes.length < 2 ||
    nodes.length > 9 ||
    parent.length < 2 ||
    [...nodes, ...parent].some((n) => !(n.r > 0) || !Number.isFinite(n.r) || n.p.length !== 3 || !n.p.every(Number.isFinite))
  )
    throw new Error('Invalid vascular landmarks');
  const length = (a: Vec3) => Math.hypot(...a);
  const delta = (a: Vec3, b: Vec3): Vec3 => b.map((x, j) => x - a[j]) as Vec3;
  const end = nodes[atStart ? 0 : nodes.length - 1].p;
  let nearest = Infinity;
  let direction: Vec3 = [0, 0, 0];
  for (let i = 1; i < parent.length; i++) {
    const d = delta(parent[i - 1].p, parent[i].p),
      l = length(d);
    if (l === 0) continue;
    const q = delta(parent[i - 1].p, end);
    const t = Math.max(0, Math.min(1, q.reduce((s, x, j) => s + x * d[j], 0) / (l * l)));
    const distance = length(q.map((x, j) => x - t * d[j]) as Vec3);
    if (distance < nearest) {
      nearest = distance;
      direction = d.map((x) => x / l) as Vec3;
    }
  }
  const tangents = nodes.map((_, i): Vec3 => {
    const before = nodes[Math.max(0, i - 1)].p,
      after = nodes[Math.min(nodes.length - 1, i + 1)].p;
    const d = delta(before, after),
      l = length(d);
    return l > 0 ? (d.map((x) => x / l) as Vec3) : [0, 0, 0];
  });
  tangents[atStart ? 0 : nodes.length - 1] = direction;
  const intervals = nodes.length - 1;
  const divisions = Array<number>(intervals).fill(Math.floor(8 / intervals));
  const bends = nodes
    .slice(0, -1)
    .map((a, i) => {
      const d = delta(a.p, nodes[i + 1].p),
        l = length(d);
      const score = l === 0 ? 0 : l * (2 - d.reduce((sum, x, j) => sum + (x / l) * (tangents[i][j] + tangents[i + 1][j]), 0));
      return { i, score };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i);
  for (let i = 0; i < 8 % intervals; i++) divisions[bends[i].i]++;
  const result: TubeNode[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i],
      b = nodes[i + 1],
      l = length(delta(a.p, b.p)),
      steps = divisions[i];
    for (let k = 0; k < steps; k++) {
      if (k === 0) {
        result.push({ p: [...a.p], r: a.r });
        continue;
      }
      const t = k / steps,
        t2 = t * t,
        t3 = t2 * t;
      result.push({
        p: a.p.map(
          (x, j) =>
            (2 * t3 - 3 * t2 + 1) * x +
            (t3 - 2 * t2 + t) * l * tangents[i][j] +
            (-2 * t3 + 3 * t2) * b.p[j] +
            (t3 - t2) * l * tangents[i + 1][j],
        ) as Vec3,
        r: a.r + t * (b.r - a.r),
      });
    }
  }
  const last = nodes[nodes.length - 1];
  result.push({ p: [...last.p], r: last.r });
  return result;
}

export function curveVascularBranches(vessels: VesselDef[]): void {
  const byId = (id: VesselId) => vessels.find((v) => v.id === id)!;
  // [EXTRAPOLACIÓN PROPIA] Red segmentaria del seno, ajustada al espacio entre columnas y paredes.
  // Construcción solamente: las tres muestras originales de cada interlobar y sus calibres se conservan.
  const arterial = byId('renalArteryRight').tube.nodes;
  const origin = arterial[arterial.length - 1].p;
  const medial = normalize(sub(arterial[arterial.length - 2].p, origin));
  const axis = normalize(cross(medial, sub(byId('renalVeinRight').tube.nodes[0].p, origin)));
  const anterior = normalize(cross(axis, medial));
  const routes: Partial<Record<VesselId, Vec3[]>> = {
    interlobarArtery1: [
      [-23, -2, 3],
      [-25, -4, 5],
      [-29, -4, 4],
      [-32, -1, 6],
    ],
    interlobarArtery2: [[0.6, 6, -2]],
    interlobarArtery3: [[17.4, 10, -6]],
    interlobarVein1: [[-10.8, 10, 5]],
    interlobarVein2: [[-0.5, 12, 5]],
    interlobarVein3: [[4.7, 12, 5]],
  };
  for (const v of vessels) {
    const route = routes[v.id];
    if (!route) continue;
    const venous = v.id.includes('Vein');
    const parent = byId(venous ? 'renalVeinRight' : 'renalArteryRight').tube.nodes;
    const root = parent[venous ? 0 : parent.length - 1];
    const tip = v.tube.nodes[venous ? v.tube.nodes.length - 1 : 0];
    const join = { p: [...root.p] as Vec3, r: Math.min(tip.r, root.r) };
    const bends = route.map(([u, y, z]) => ({
      p: origin.map((x, j) => x + u * axis[j] + (y - 6) * medial[j] + (z + 4) * anterior[j]) as Vec3,
      r: tip.r,
    }));
    if (venous) v.tube.nodes.push(...bends, join);
    else v.tube.nodes.unshift(join, ...bends);
  }
  // Preserve every source landmark; estimate a curved path only between them.
  for (const [child, parent, atStart] of [
    ['hvCommonTrunk', 'ivcInfra', false],
    ['hvRight', 'ivcInfra', false],
    ['hvMiddle', 'hvCommonTrunk', false],
    ['hvLeft', 'hvCommonTrunk', false],
    ['hvRightAnterior', 'hvRight', false],
    ['hvRightPosterior', 'hvRight', false],
    ['hvMiddleTributary', 'hvMiddle', false],
    ['hvLeftTributary', 'hvLeft', false],
    ['pvRightAnterior', 'pvRight', true],
    ['pvRightPosterior', 'pvRight', true],
    ['pvLeftLateral', 'pvLeft', true],
    ['pvLeftMedial', 'pvLeft', true],
  ] as const) {
    const branch = byId(child);
    branch.tube = { ...branch.tube, nodes: curvedBranch(branch.tube.nodes, byId(parent).tube.nodes, atStart) };
  }
}
