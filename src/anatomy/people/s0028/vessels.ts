import type { Vec3 } from '../../../core/vec3';
import type { TubeNode } from '../../primitives';
import { S0028_TRUNKS } from '../../s0028TrunksData';
import type { VesselDef } from '../../vesselTree';

/** Un extremo a esta distancia (mm) o menos del eje anterior de un vaso nacía o moría en él. */
const TOUCH_MM = 3;

interface Hit {
  /** Distancia al eje y longitud de arco del punto más cercano. */
  d: number;
  s: number;
  point: Vec3;
}
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function arcs(nodes: readonly TubeNode[]): number[] {
  let s = 0;
  return nodes.map((n, i) => (s += i ? distance(n.p, nodes[i - 1].p) : 0));
}

function closest(nodes: readonly TubeNode[], q: Vec3): Hit {
  const s = arcs(nodes);
  let best: Hit = { d: Infinity, s: 0, point: nodes[0].p };
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i].p,
      ab = add(nodes[i + 1].p, a, -1),
      l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = l2 ? Math.min(1, Math.max(0, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1] + (q[2] - a[2]) * ab[2]) / l2)) : 0;
    const point = add(a, ab, t),
      d = distance(q, point);
    if (d < best.d) best = { d, s: s[i] + t * (s[i + 1] - s[i]), point };
  }
  return best;
}

/**
 * Troncos de s0028 desde sus propias máscaras (decisión 345): aorta, tronco portal, ramas portales derecha e izquierda y vena
 * esplénica dejan los hitos de la otra persona. Los vasos que nacían o morían en un tronco lo siguen: su extremo va al mismo
 * extremo del tronco nuevo, o al punto más cercano de su eje, y el desplazamiento se apaga linealmente hasta el otro extremo,
 * que se queda donde estaba. Sus propios hijos los siguen igual. Solo construcción: CPU, Worker y GPU reciben los mismos nodos.
 */
export function placeS0028Vessels(vessels: VesselDef[]): void {
  const before = new Map(vessels.map((v) => [v, v.tube.nodes]));
  /** Desplazamiento de cada vaso ya colocado, en función de la longitud de arco sobre su eje anterior. */
  const moved = new Map<VesselDef, (hit: Hit) => Vec3>();
  for (const v of vessels) {
    const trunk = (S0028_TRUNKS as Partial<Record<VesselDef['id'], readonly [number, readonly (readonly number[])[]]>>)[v.id];
    if (!trunk) continue;
    const old = before.get(v)!,
      length = arcs(old).at(-1)!,
      nodes: TubeNode[] = trunk[1].map(([x, y, z, r]) => ({ p: [x, y, z], r }));
    v.tube = { ...v.tube, nodes };
    v.refRadius = trunk[0];
    moved.set(v, (hit) =>
      add(hit.s < 1e-6 ? nodes[0].p : hit.s > length - 1e-6 ? nodes[nodes.length - 1].p : closest(nodes, hit.point).point, hit.point, -1),
    );
  }
  for (;;) {
    const followers: [VesselDef, (hit: Hit) => Vec3][] = [];
    for (const v of vessels) {
      if (moved.has(v)) continue;
      const old = before.get(v)!,
        s = arcs(old),
        length = s[s.length - 1];
      // Cada extremo sigue al vaso ya colocado cuyo eje anterior toca más de cerca.
      const ends = [old[0].p, old[old.length - 1].p].map((q) => {
        let pull: Vec3 | null = null,
          near = TOUCH_MM;
        for (const [parent, shift] of moved) {
          const hit = closest(before.get(parent)!, q);
          if (hit.d <= near) [near, pull] = [hit.d, shift(hit)];
        }
        return pull;
      });
      if (!ends[0] && !ends[1]) continue;
      const shift = (at: number): Vec3 => add(add([0, 0, 0], ends[0] ?? [0, 0, 0], 1 - at / length), ends[1] ?? [0, 0, 0], at / length);
      v.tube = { ...v.tube, nodes: old.map((n, i) => ({ ...n, p: add(n.p, shift(s[i])) })) };
      followers.push([v, (hit) => shift(hit.s)]);
    }
    if (!followers.length) break;
    for (const [v, shift] of followers) moved.set(v, shift);
  }
}
