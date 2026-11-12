import type { Vec3 } from '../../../core/vec3';
import type { TubeNode } from '../../primitives';
import { S0028_PORTAL_BRANCHES, S0028_TRUNKS } from '../../s0028TrunksData';
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
  reroute(vessels);
  accompany(vessels, 'splenicArtery', 'portalSplenic');
  addPortalBranches(vessels);
}

/** Radio (mm) con que se apaga la punta de una rama portal propia: por debajo de la resolución, sin acabar en una bola. */
const PORTAL_TIP_MM = 0.6;
/**
 * Ramas portales propias de s0028 (decisión 357): además de las cuatro de segundo orden, las que su TAC muestra saliendo de ellas.
 * Como las procedurales, comparten el id de su madre (su velocidad por `flowFactor`, su pared periportal más fina) y no definen su
 * área; van al final de la lista, tras las madres, y las procedurales ocupan los tubos que queden.
 */
function addPortalBranches(vessels: VesselDef[]): void {
  for (const [mother, nodes] of S0028_PORTAL_BRANCHES) {
    const parent = vessels.find((v) => v.id === mother && v.flowFactor === undefined);
    if (!parent) continue;
    vessels.push({
      id: parent.id,
      tube: {
        kind: 'tube',
        nodes: nodes.map(([x, y, z, r], i) => ({ p: [x, y, z], r: i === nodes.length - 1 ? PORTAL_TIP_MM : r })),
        apScale: 1,
      },
      refRadius: nodes[0][3],
      profileN: parent.profileN,
      wallTissue: parent.wallTissue,
      wallMm: Math.max(0.4, parent.wallMm * 0.7),
      flowFactor: 0.85,
    });
  }
}

/**
 * Vasos sin máscara cuyo trayecto heredado de la otra persona atravesaba la luz de otro vaso de s0028 (decisión 354): nodos
 * interiores (x, y, z, radio) en mm LAS; los extremos marcados con `keep` conservan el que ya tenían (su unión o su órgano).
 * - `portalSmv`: seguida corte a corte en el propio TAC (su realce portal, 130–150 HU) desde la confluencia: baja por delante del
 *   hueco entre la cava y la aorta, no por dentro de la cava. Entera de la tabla; muere en el primer nodo del tronco portal.
 * - `sma`, `renalArteryRight` y las hepáticas: no se distinguen en esta fase del TAC. Trazadas por relación anatómica [EXTRAPOLACIÓN PROPIA]: la
 *   mesentérica nace de la cara anterior de la aorta, cruza por delante de la vena renal izquierda y baja a la izquierda de su
 *   vena; la renal derecha pasa por detrás de la cava. La hepática común atravesaba el tronco portal por su centro: sale del
 *   tronco celíaco por encima de la confluencia y queda por delante de la porta, y la hepática propia continúa desde ahí.
 */
const ROUTES: Partial<Record<VesselDef['id'], { keep: readonly ('first' | 'last')[]; nodes: readonly (readonly number[])[] }>> = {
  portalSmv: {
    keep: [],
    nodes: [
      [-0.5, 21, -174, 2],
      [1, 21.4, -156, 2.6],
      [2.3, 21.8, -147, 3.2],
      [1.8, 20.6, -138, 3.8],
      [1.7, 19.5, -129, 4.4],
      [-0.8, 18.7, -120, 4.8],
      [0.6, 19.5, -111, 4.9],
      [1.7, 18.4, -102, 5],
    ],
  },
  sma: {
    keep: ['first', 'last'],
    nodes: [
      [15, 6, -107, 3.3],
      [12, 20, -116, 3.2],
      [11, 24, -126, 3.1],
      [10, 23, -145, 3],
      [9, 22, -170, 2.8],
      [-8, 16, -200, 2.5],
    ],
  },
  commonHepaticArtery: {
    keep: ['first'],
    nodes: [
      [3, 10, -74, 2.4],
      [-2, 20, -72, 2.4],
      [-5, 24, -70, 2.4],
    ],
  },
  hepaticArtery: {
    keep: ['last'],
    nodes: [
      [-5, 24, -70, 2.6],
      [-7, 29, -62, 2.5],
      [-17, 34, -49, 2.3],
      [-45, 28, -39, 2.1],
    ],
  },
  renalArteryRight: {
    keep: ['first', 'last'],
    nodes: [
      [6, -11, -131, 3],
      [-3, -19, -132, 2.8],
      [-11, -23, -132, 2.6],
      [-24, -25, -133, 2.4],
    ],
  },
};
function reroute(vessels: VesselDef[]): void {
  const confluence = S0028_TRUNKS.pvTrunk[1][0];
  for (const v of vessels) {
    const route = ROUTES[v.id];
    if (!route || v.flowFactor !== undefined) continue;
    const old = v.tube.nodes,
      inner: TubeNode[] = route.nodes.map(([x, y, z, r]) => ({ p: [x, y, z], r }));
    v.tube = {
      ...v.tube,
      nodes: [
        ...(route.keep.includes('first') ? [old[0]] : []),
        ...inner,
        ...(route.keep.includes('last')
          ? [old[old.length - 1]]
          : v.id === 'portalSmv'
            ? [{ p: [confluence[0], confluence[1], confluence[2]] as Vec3, r: 4.5 }]
            : []),
      ],
    };
  }
}

/** Separación entre una arteria sin máscara y la vena de la persona a la que acompaña (mm, hacia la cabeza). */
const COMPANION_MM = 5;

/**
 * Una arteria sin máscara acompaña a la vena de esta persona que sí la tiene: conserva su origen y sus radios, y recorre el eje de
 * la vena en sentido contrario, `COMPANION_MM` por encima. La esplénica de la otra persona atravesaba el riñón izquierdo de s0028;
 * en la anatomía real corre con su vena por el borde superior del páncreas hasta el hilio esplénico. [EXTRAPOLACIÓN PROPIA]
 */
function accompany(vessels: VesselDef[], artery: VesselDef['id'], vein: VesselDef['id']): void {
  const a = vessels.find((v) => v.id === artery),
    along = vessels.find((v) => v.id === vein)?.tube.nodes;
  if (!a || !along) return;
  const old = a.tube.nodes,
    path = [...along].reverse().slice(1, old.length);
  a.tube = {
    ...a.tube,
    nodes: [old[0], ...path.map((n, i) => ({ p: add(n.p, [0, 0, COMPANION_MM]), r: old[Math.min(i + 1, old.length - 1)].r }))],
  };
}

/** Tramos por tubo que recorre el shader de s0028 (el de la otra persona, `MAX_TUBE_SEGMENTS`). */
export const S0028_TUBE_SEGMENTS = 24;
/** Giro máximo entre dos tramos consecutivos de un eje suavizado (rad): por debajo no se ve la esquina con el moteado. */
const SMOOTH_TURN = (8 * Math.PI) / 180;
/** Vasos sin máscara propia cuyo eje, movido con los troncos, también se dibuja como curva. */
const SMOOTHED: readonly VesselDef['id'][] = ['portalSmv', 'sma', 'splenicArtery', 'renalVeinLeft', 'renalVeinRight'];

/** Punto de la Catmull-Rom centrípeta por p1 y p2 (vecinos p0 y p3) en t ∈ [0, 1]: pasa por los nodos y no hace bucles. */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const knot = (a: Vec3, b: Vec3) => Math.max(1e-3, Math.sqrt(distance(a, b)));
  const t1 = knot(p0, p1),
    t2 = t1 + knot(p1, p2),
    t3 = t2 + knot(p2, p3),
    u = t1 + t * (t2 - t1);
  const mix = (a: Vec3, b: Vec3, ta: number, tb: number): Vec3 => add(add([0, 0, 0], a, (tb - u) / (tb - ta)), b, (u - ta) / (tb - ta));
  const a1 = mix(p0, p1, 0, t1),
    a2 = mix(p1, p2, t1, t2),
    a3 = mix(p2, p3, t2, t3);
  return mix(mix(a1, a2, 0, t2), mix(a2, a3, t1, t3), t1, t2);
}

/** Longitud recta que cuenta como un giro de `SMOOTH_TURN` al repartir los nodos (mm): un tramo recto largo también recibe alguno. */
const SMOOTH_LENGTH_MM = 90;

/**
 * El eje de un tubo como curva (decisión 354): el motor dibuja tramos rectos entre nodos, y con 9 nodos un vaso que gira se ve
 * quebrado. La curva es la Catmull-Rom centrípeta que pasa por los mismos nodos (los extremos, que son uniones con otros vasos, no
 * se mueven); se muestrea fina y los nodos nuevos se reparten a giro acumulado constante, de modo que ninguna unión gire más de
 * `SMOOTH_TURN` mientras quepan en `maxSegments` tramos. El radio sigue lineal entre los nodos originales.
 */
export function smoothAxis(nodes: readonly TubeNode[], maxSegments = S0028_TUBE_SEGMENTS): TubeNode[] {
  const n = nodes.length;
  if (n < 3) return [...nodes];
  const at = (i: number): Vec3 =>
    i < 0
      ? add(nodes[0].p, add(nodes[1].p, nodes[0].p, -1), -1)
      : i >= n
        ? add(nodes[n - 1].p, add(nodes[n - 2].p, nodes[n - 1].p, -1), -1)
        : nodes[i].p;
  const FINE = 12,
    fine: TubeNode[] = [nodes[0]];
  for (let i = 0; i + 1 < n; i++)
    for (let k = 1; k <= FINE; k++) {
      const t = k / FINE;
      fine.push(
        k === FINE
          ? nodes[i + 1]
          : { p: catmullRom(at(i - 1), at(i), at(i + 1), at(i + 2), t), r: nodes[i].r + (nodes[i + 1].r - nodes[i].r) * t },
      );
    }
  // Medida acumulada en cada muestra: el giro de la curva hasta ella más su longitud, en unidades de `SMOOTH_TURN`.
  const step = fine.slice(1).map((q, i) => add(q.p, fine[i].p, -1)),
    length = step.map((d) => Math.hypot(d[0], d[1], d[2])),
    measure = [0];
  for (let i = 0; i < step.length; i++) {
    const a = step[Math.max(0, i - 1)],
      b = step[i],
      cosine = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.max(1e-9, length[Math.max(0, i - 1)] * length[i]);
    measure.push(measure[i] + Math.acos(Math.min(1, Math.max(-1, cosine))) / SMOOTH_TURN + length[i] / SMOOTH_LENGTH_MM);
  }
  const total = measure[measure.length - 1],
    segments = Math.min(maxSegments, Math.max(1, Math.ceil(total)));
  const out: TubeNode[] = [nodes[0]];
  let j = 0;
  for (let k = 1; k < segments; k++) {
    const target = (k * total) / segments;
    while (j + 1 < fine.length - 1 && measure[j + 1] <= target) j++;
    // La muestra más cercana al objetivo, siempre por delante de la anterior.
    const pick = j + 1 < fine.length - 1 && target - measure[j] > measure[j + 1] - target ? j + 1 : j;
    if (pick > 0 && fine[pick] !== out[out.length - 1]) out.push(fine[pick]);
  }
  out.push(nodes[n - 1]);
  return out;
}

/** Los troncos de las máscaras y los vasos que los acompañan, con el eje como curva. Las ramas procedurales ya están colocadas. */
export function smoothS0028Vessels(vessels: VesselDef[]): void {
  for (const v of vessels)
    // Los troncos medidos, con todos los tramos; los vasos que los acompañan, con la mitad: los nodos de la escena tienen techo
    // (`MAX_NODES`) y las ramas portales propias, cortas y ya ajustadas a cinco nodos, se quedan como están.
    if (v.flowFactor === undefined && (v.id in S0028_TRUNKS || SMOOTHED.includes(v.id)))
      v.tube = { ...v.tube, nodes: smoothAxis(v.tube.nodes, v.id in S0028_TRUNKS ? S0028_TUBE_SEGMENTS : S0028_TUBE_SEGMENTS / 2) };
}
