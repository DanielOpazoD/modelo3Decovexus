import { beforeAll, expect, it } from 'vitest';
import { loadS0028 } from '../../tools/anatomy/s0028Windows';
import { tubeQuery, type TubeNode } from '../anatomy/primitives';
import { add, dist, scale, sub, type Vec3 } from '../core/vec3';
import type { VesselId } from '../physiology/vessels';
import { lumenOverlaps } from './support/vesselOverlap';

let scene: ReturnType<typeof loadS0028>['scene'];
beforeAll(() => {
  ({ scene } = loadS0028());
}, 60_000);

it('s0028: ningún vaso atraviesa la luz de otro en el abdomen', () => {
  // Decisión 354: la mesentérica superior atravesaba la cava (11 mm de solape), la arteria renal derecha también (5 mm) y la
  // arteria y la vena mesentéricas se pisaban (6,5 mm). En una ecografía dos luces separadas no se funden en una.
  expect(lumenOverlaps(scene)).toEqual([]);
});

it('el oráculo solo une vasos del mismo tipo con un extremo dentro de la luz del otro (revisión r3)', () => {
  const tube = (id: VesselId) => scene.vessels.find((v) => v.id === id && v.flowFactor === undefined)!.tube;
  const last = (id: VesselId) => tube(id).nodes.length - 1;
  /** Punto del eje de `id` más cercano a p y su radio, interpolado como en el oráculo. */
  const onAxis = (p: Vec3, id: VesselId) => {
    const { nodes } = tube(id),
      h = tubeQuery(p, tube(id)),
      [a, b] = [nodes[h.segment], nodes[h.segment + 1]];
    return { p: add(a.p, scale(sub(b.p, a.p), h.s)), r: a.r + (b.r - a.r) * h.s };
  };
  type Edit = (n: TubeNode[]) => void;
  type Edits = Partial<Record<VesselId, Edit[]>>;
  const into =
    (id: VesselId, from: number, to: number): Edit =>
    (n) => {
      for (let k = from; k <= to; k++) n[k].p = onAxis(n[k].p, id).p;
    };
  const toward =
    (id: VesselId, k: number, mm: number): Edit =>
    (n) => {
      const q = onAxis(n[k].p, id).p;
      n[k].p = add(n[k].p, scale(sub(q, n[k].p), mm / dist(q, n[k].p)));
    };
  /** Deja el nodo k a `mm` por fuera de la pared de `id`. */
  const beside =
    (id: VesselId, k: number, mm: number): Edit =>
    (n) => {
      const q = onAxis(n[k].p, id);
      n[k].p = add(q.p, scale(sub(n[k].p, q.p), (q.r + mm) / dist(n[k].p, q.p)));
    };
  const mutated = (...edits: Edits[]) => ({
    vessels: scene.vessels.map((v) => {
      const fs = v.flowFactor === undefined ? edits.flatMap((e) => e[v.id] ?? []) : [];
      if (!fs.length) return v;
      const nodes = v.tube.nodes.map((n) => ({ ...n, p: [...n.p] as Vec3 }));
      fs.forEach((f) => f(nodes));
      return { ...v, tube: { ...v.tube, nodes } };
    }),
  });
  // Trifurcación celíaca `mm` más cerca del tronco portal: último nodo del tronco y primero de sus tres ramas.
  const celiac = (mm: number): Edits => ({
    celiacTrunk: [toward('pvTrunk', last('celiacTrunk'), mm)],
    splenicArtery: [toward('pvTrunk', 0, mm)],
    leftGastricArtery: [toward('pvTrunk', 0, mm)],
    commonHepaticArtery: [toward('pvTrunk', 0, mm)],
  });
  const hilum = last('splenicArtery'),
    inVein = into('portalSplenic', 3, 7);
  const cases: [VesselId, VesselId, ReturnType<typeof mutated>][] = [
    // La esplénica en su vena: su extremo hiliar ya queda a menos de 3 mm de la pared de la vena.
    ['splenicArtery', 'portalSplenic', mutated({ splenicArtery: [inVein] })],
    // Y con el extremo hiliar dentro de la luz de la vena: solo el tipo los separa (una arteria no nace ni muere en una vena).
    ['splenicArtery', 'portalSplenic', mutated({ splenicArtery: [inVein, into('portalSplenic', hilum, hilum)] })],
    // La mesentérica superior en su vena, con el extremo caudal de la vena 2 mm más cerca de la arteria.
    ['sma', 'portalSmv', mutated({ sma: [into('portalSmv', 5, 7)], portalSmv: [toward('sma', 0, 2)] })],
    // La hepática común cruzando el tronco portal (decisión 354), con la trifurcación 0,05 mm más cerca de él.
    ['commonHepaticArtery', 'pvTrunk', mutated(celiac(0.05), { commonHepaticArtery: [into('pvTrunk', 1, 2)] })],
    // Dos venas: la mesentérica superior dentro de la cava, con su extremo caudal 1,5 mm por fuera de la pared. Rozar no es unirse.
    ['portalSmv', 'ivcInfra', mutated({ portalSmv: [into('ivcInfra', 3, 8), beside('ivcInfra', 0, 1.5)] })],
  ];
  for (const [a, b, mutant] of cases)
    expect(lumenOverlaps(mutant), `${a} × ${b}`).toContainEqual(expect.stringMatching(new RegExp(`^(${a} × ${b}|${b} × ${a}):`)));
});
