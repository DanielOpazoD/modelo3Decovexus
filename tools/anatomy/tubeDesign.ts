/**
 * Geometría compartida por las herramientas de diseño anatómico de s0028 (`tube-gaps.ts`, `window-plane.ts`, `pear-fit.ts`):
 * lectura de nodos y propuestas, muestreo del eje de un tubo, hueco de pared entre tubos y coordenadas de un punto en el plano
 * de una ventana. Importarla no carga nada: la escena la trae quien la usa (`loadS0028`).
 */
import { existsSync } from 'node:fs';
import { tubeQuery, type Tube, type TubeNode } from '../../src/anatomy/primitives';
import { wallThicknessMm, type DuctDef, type VesselDef } from '../../src/anatomy/vesselTree';
import type { StartPoint } from '../../src/app/startPoints';
import { dist, dot, sub, type Vec3 } from '../../src/core/vec3';
import type { ProbeFrame, ProbePose } from '../../src/probe/probe';
import { UsageError, readJsonArgument } from '../toolArgs';

/** Abreviaturas que admiten las propuestas además del id del tubo. */
export const TUBE_ALIASES: Readonly<Record<string, string>> = {
  cha: 'commonHepaticArtery',
  ha: 'hepaticArtery',
  rhd: 'rightHepaticDuct',
  lhd: 'leftHepaticDuct',
};

/** Un vaso madre o un conducto de la escena, con los nodos de la propuesta si la propuesta lo nombra. */
export interface DesignTube {
  id: string;
  tube: Tube;
  /** Espesor de su pared (mm) donde la luz tiene ese radio. */
  wallMm: (radiusMm: number) => number;
  /** Sus nodos vienen de la propuesta, no de la escena. */
  proposed: boolean;
}

/** Una muestra del eje: punto, radio lineal entre nodos y longitud de arco desde el primer nodo (mm). */
export interface AxisSample extends TubeNode {
  arcMm: number;
}

export interface WallGap {
  gapMm: number;
  /** Punto del eje del primer tubo donde se da. */
  at: Vec3;
}

/** Un punto en el plano de imagen (mm): lateral hacia el marcador, profundidad desde la cara y elevación fuera del plano. */
export interface PlanePoint {
  lateralMm: number;
  depthMm: number;
  elevationMm: number;
}

/** Nodos `[[x, y, z, r], …]` en mm del marco del modelo (x = izquierda del paciente), validados; al menos dos. */
export function parseNodes(value: unknown, what: string): TubeNode[] {
  if (!Array.isArray(value) || value.length < 2) throw new UsageError(`${what}: se esperan al menos dos nodos [[x, y, z, r], …]`);
  return value.map((row: unknown, i): TubeNode => {
    if (!Array.isArray(row) || row.length !== 4 || !row.every((v) => typeof v === 'number' && Number.isFinite(v)))
      throw new UsageError(`${what}: el nodo ${i} no es [x, y, z, r] con cuatro números`);
    const [x, y, z, r] = row as number[];
    if (r <= 0) throw new UsageError(`${what}: el nodo ${i} tiene radio ${r}; debe ser mayor que 0`);
    return { p: [x, y, z], r };
  });
}

/** Propuesta `{ "<id o abreviatura>": [[x, y, z, r], …], … }` → nodos por id de tubo. */
export function parseProposal(value: unknown): Map<string, TubeNode[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new UsageError('La propuesta debe ser un objeto { "<tubo>": [[x, y, z, r], …], … }');
  const out = new Map<string, TubeNode[]>();
  for (const [key, nodes] of Object.entries(value)) {
    const id = TUBE_ALIASES[key] ?? key;
    if (out.has(id)) throw new UsageError(`La propuesta nombra dos veces el tubo ${id}`);
    out.set(id, parseNodes(nodes, key));
  }
  return out;
}

/**
 * Vasos madre y conductos de la escena como tubos de diseño, con los nodos de la propuesta en los que nombra (el resto de su
 * forma, la de la escena). Las ramas procedurales (`flowFactor` definido) quedan fuera: comparten id con su madre.
 */
export function designTubes(
  scene: { vessels: readonly VesselDef[]; ducts: readonly DuctDef[] },
  proposal: ReadonlyMap<string, TubeNode[]> = new Map(),
): DesignTube[] {
  const tubes: DesignTube[] = [
    ...scene.vessels
      .filter((v) => v.flowFactor === undefined)
      .map((v) => ({ id: String(v.id), tube: v.tube, wallMm: (r: number) => wallThicknessMm(v, r), proposed: false })),
    ...scene.ducts.map((d) => ({ id: String(d.id), tube: d.tube, wallMm: () => d.wallMm, proposed: false })),
  ];
  for (const id of proposal.keys()) tubeById(tubes, id);
  return tubes.map((t) => {
    const nodes = proposal.get(t.id);
    return nodes ? { ...t, tube: { ...t.tube, nodes }, proposed: true } : t;
  });
}

/** El tubo `id` (o su abreviatura) de la lista; si no está, un error que dice cuáles hay. */
export function tubeById(tubes: readonly DesignTube[], id: string): DesignTube {
  const tube = tubes.find((t) => t.id === (TUBE_ALIASES[id] ?? id));
  if (!tube) throw new UsageError(`Tubo desconocido: ${id}. Los de la escena: ${tubes.map((t) => t.id).join(', ')}`);
  return tube;
}

const between = (a: TubeNode, b: TubeNode, t: number): TubeNode => ({
  p: [a.p[0] + t * (b.p[0] - a.p[0]), a.p[1] + t * (b.p[1] - a.p[1]), a.p[2] + t * (b.p[2] - a.p[2])],
  r: a.r + t * (b.r - a.r),
});

/** Eje muestreado cada `stepMm` como mucho, con todos sus nodos, el radio lineal entre ellos y la longitud de arco. */
export function sampleAxis(nodes: readonly TubeNode[], stepMm = 0.5): AxisSample[] {
  const out: AxisSample[] = [{ ...nodes[0], arcMm: 0 }];
  let arc = 0;
  for (let i = 1; i < nodes.length; i++) {
    const segment = dist(nodes[i - 1].p, nodes[i].p),
      n = Math.max(1, Math.ceil(segment / stepMm));
    for (let s = 1; s <= n; s++) out.push({ ...between(nodes[i - 1], nodes[i], s / n), arcMm: arc + (s / n) * segment });
    arc += segment;
  }
  return out;
}

/** Longitud del eje (mm) cuyas muestras cumplen `inside`: cada muestra cuenta la mitad de cada tramo vecino. */
export function axisLengthWhere(axis: readonly AxisSample[], inside: (p: Vec3) => boolean): number {
  let mm = 0;
  for (let i = 0; i < axis.length; i++) {
    if (!inside(axis[i].p)) continue;
    const before = i > 0 ? axis[i].arcMm - axis[i - 1].arcMm : 0,
      after = i + 1 < axis.length ? axis[i + 1].arcMm - axis[i].arcMm : 0;
    mm += (before + after) / 2;
  }
  return mm;
}

/** Puntos donde el eje cruza la altura `z` (mm), interpolados entre muestras vecinas. */
export function axisAtZ(axis: readonly AxisSample[], z: number): AxisSample[] {
  const out: AxisSample[] = [];
  for (let i = 1; i < axis.length; i++) {
    const a = axis[i - 1],
      b = axis[i],
      below = a.p[2] < z;
    if (below === b.p[2] < z) continue;
    const t = (z - a.p[2]) / (b.p[2] - a.p[2]);
    out.push({ ...between(a, b, t), arcMm: a.arcMm + t * (b.arcMm - a.arcMm) });
  }
  return out;
}

/** Extremos de uno u otro tubo que caen a menos de 1 mm del eje de los dos: sus uniones. */
export function sharedEnds(a: readonly AxisSample[], b: readonly AxisSample[]): Vec3[] {
  const onAxis = (p: Vec3, axis: readonly AxisSample[]) => axis.some((q) => dist(p, q.p) < 1);
  return [a[0].p, a[a.length - 1].p, b[0].p, b[b.length - 1].p].filter((p) => onAxis(p, a) && onAxis(p, b));
}

/** Hueco (mm) entre la cara externa de la pared de `a` en la muestra `s` de su eje y la de `b`; negativo si se pisan. */
export function wallGapAt(a: DesignTube, s: TubeNode, b: DesignTube): number {
  const hit = tubeQuery(s.p, b.tube);
  return hit.d - s.r - a.wallMm(s.r) - b.wallMm(hit.r);
}

/**
 * Menor hueco de pared entre `a` y `b` recorriendo el eje de `a`. No cuentan las muestras a menos de `junctionMm` de una unión
 * de los dos tubos, donde se tocan a propósito; null si así no queda ninguna.
 */
export function minWallGap(
  a: DesignTube,
  axisA: readonly AxisSample[],
  b: DesignTube,
  axisB: readonly AxisSample[],
  junctionMm = 8,
): WallGap | null {
  const junctions = sharedEnds(axisA, axisB);
  let best: WallGap | null = null;
  for (const s of axisA) {
    if (junctions.some((p) => dist(s.p, p) < junctionMm)) continue;
    const gapMm = wallGapAt(a, s, b);
    if (!best || gapMm < best.gapMm) best = { gapMm, at: s.p };
  }
  return best;
}

/** Un punto del modelo en el plano de imagen de `frame` (el marco de la sonda apoyada: `probeContact(…).frame`). */
export function planeCoordinates(p: Vec3, frame: Pick<ProbeFrame, 'face' | 'lateral' | 'axial' | 'elevation'>): PlanePoint {
  const d = sub(p, frame.face);
  return { lateralMm: dot(d, frame.lateral), depthMm: dot(d, frame.axial), elevationMm: dot(d, frame.elevation) };
}

/**
 * Profundidad y elevación de una línea de puntos en una posición lateral, interpoladas entre los dos puntos que la rodean una
 * vez ordenados por lateral (vale para un eje que avanza de lado en la imagen, no para uno que vuelve sobre sí); null fuera
 * de su recorrido.
 */
export function atLateral(points: readonly PlanePoint[], lateralMm: number): PlanePoint | null {
  const line = [...points].sort((p, q) => p.lateralMm - q.lateralMm);
  const i = line.findIndex((p) => p.lateralMm >= lateralMm);
  if (i <= 0) return null;
  const a = line[i - 1],
    b = line[i],
    t = (lateralMm - a.lateralMm) / (b.lateralMm - a.lateralMm || 1);
  return { lateralMm, depthMm: a.depthMm + t * (b.depthMm - a.depthMm), elevationMm: a.elevationMm + t * (b.elevationMm - a.elevationMm) };
}

/**
 * Pose de la sonda desde el id de una ventana de inicio o desde un JSON `{ "phi", "z", "yaw", "rock"?, "tilt"?, "lift"? }`
 * (el texto o un archivo); lo que falte de `rock`, `tilt` y `lift` vale 0.
 */
export function resolvePose(spec: string, points: readonly StartPoint[]): { label: string; pose: ProbePose } {
  const start = points.find((p) => p.id === spec);
  if (start)
    return { label: start.id, pose: { phi: start.phi, z: start.z, yaw: start.yaw, rock: start.rock ?? 0, tilt: start.tilt ?? 0, lift: 0 } };
  if (!/^\s*\{/.test(spec) && !existsSync(spec))
    throw new UsageError(`«${spec}» no es una ventana (${points.map((p) => p.id).join(', ')}), ni una pose JSON, ni un archivo`);
  const raw = readJsonArgument(spec, 'pose');
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new UsageError('pose: se espera un objeto { "phi", "z", "yaw", … }');
  const given = raw as Record<string, unknown>;
  const pose: ProbePose = { phi: 0, z: 0, yaw: 0, rock: 0, tilt: 0, lift: 0 };
  for (const key of Object.keys(pose) as (keyof ProbePose)[]) {
    const value = given[key];
    if (value === undefined && (key === 'rock' || key === 'tilt' || key === 'lift')) continue;
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new UsageError(`pose: «${key}» debe ser un número (rad; z y lift en mm)`);
    pose[key] = value;
  }
  return { label: 'pose', pose };
}
