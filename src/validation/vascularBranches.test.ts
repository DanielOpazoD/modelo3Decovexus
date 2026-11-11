import { describe, expect, it } from 'vitest';
import { curvedBranch, curveVascularBranches } from '../anatomy/people/default/vascularBranches';
import { tubeQuery, type TubeNode } from '../anatomy/primitives';
import { buildVesselTree } from '../anatomy/vesselTree';
import { AnatomyScene } from './support/legacyPerson/scene';
import { NORMAL_ADULT } from '../cases';

const parent: TubeNode[] = [
  { p: [-10, 0, 0], r: 5 },
  { p: [10, 0, 0], r: 5 },
];
const branch: TubeNode[] = [
  { p: [-20, 20, 0], r: 2 },
  { p: [-10, 10, 0], r: 2.5 },
  { p: [0, 0, 0], r: 3 },
];
const direction = (a: TubeNode, b: TubeNode) => {
  const d = b.p.map((x, j) => x - a.p[j]);
  const l = Math.hypot(...d);
  return d.map((x) => x / l);
};
describe('curved vascular courses', () => {
  it('turns into the receiving axis while retaining every original landmark and radius', () => {
    const before = structuredClone(branch),
      curve = curvedBranch(branch, parent, false);
    expect(branch).toEqual(before);
    for (const n of branch) expect(curve).toContainEqual(n);
    expect(curve).toHaveLength(9);
    const originalAngle = Math.acos(direction(branch[1], branch[2])[0]);
    const curvedAngle = Math.acos(direction(curve.at(-2)!, curve.at(-1)!)[0]);
    expect(curvedAngle).toBeLessThan(originalAngle / 2);
    expect(curve.some((n) => Math.abs(n.p[0] + n.p[1]) > 1)).toBe(true);
    expect(curve.every((n) => n.r >= 2 && n.r <= 3 && n.p[2] === 0)).toBe(true);
    curve[0].p[0] = 999;
    expect(branch).toEqual(before);
  });
  it('reverses geometry and flow direction consistently for a branch leaving its parent', () => {
    const arriving = curvedBranch(branch, parent, false);
    const leaving = curvedBranch([...branch].reverse(), [...parent].reverse(), true).reverse();
    arriving.forEach((n, i) => {
      n.p.forEach((x, j) => expect(leaving[i].p[j]).toBeCloseTo(x, 12));
      expect(leaving[i].r).toBeCloseTo(n.r, 12);
    });
  });
  it('keeps a collinear vessel straight and its lumen and wall radius unchanged', () => {
    const line: TubeNode[] = [
      { p: [-20, 0, 0], r: 3 },
      { p: [-10, 0, 0], r: 3 },
      { p: [0, 0, 0], r: 3 },
    ];
    const nodes = curvedBranch(line, parent, false),
      tube = { kind: 'tube' as const, nodes, apScale: 1 };
    for (let x = -19; x < 0; x += 0.37) {
      expect(tubeQuery([x, 0, 0], tube).d).toBeCloseTo(-3, 12);
      expect(tubeQuery([x, 3, 0], tube).d).toBeCloseTo(0, 12);
      expect(tubeQuery([x, 3.6, 0], tube).d).toBeCloseTo(0.6, 12);
    }
  });
  it('retains all anchors even when their count does not divide the GPU segment capacity', () => {
    for (let count = 2; count <= 9; count++) {
      const nodes: TubeNode[] = Array.from({ length: count }, (_, i) => ({
        p: [(i - count + 1) * 7, i === count - 1 ? 0 : Math.sin(i) * 3, 0],
        r: 2 + i * 0.1,
      }));
      const curve = curvedBranch(nodes, parent, false);
      expect(curve).toHaveLength(9);
      for (const n of nodes) expect(curve).toContainEqual(n);
      expect(curve.every((n) => n.p.every(Number.isFinite))).toBe(true);
    }
  });
  it('handles zero-length segments without producing nonfinite nodes', () => {
    const nodes = curvedBranch([branch[2], branch[2]], [parent[0], parent[0]], false);
    expect(nodes.every((n) => n.p.every(Number.isFinite))).toBe(true);
  });
  it('rejects unusable geometry instead of truncating landmarks', () => {
    for (const nodes of [
      [],
      [branch[0]],
      Array(10).fill(branch[0]),
      [{ p: [NaN, 0, 0], r: 2 }, branch[1]],
      [{ p: [0, 0, 0], r: -1 }, branch[1]],
    ])
      expect(() => curvedBranch(nodes as TubeNode[], parent, false)).toThrow('Invalid vascular landmarks');
    expect(() => curvedBranch(branch, [], false)).toThrow();
  });
  it('changes courses, not identities, calibers, wall definitions, principal portal axes or organs', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const { vessels } = buildVesselTree(scene.kidneyRight, scene.kidneyLeft, true);
    const before = structuredClone(vessels);
    curveVascularBranches(vessels);
    const changed = vessels.filter((v, i) => JSON.stringify(v.tube.nodes) !== JSON.stringify(before[i].tube.nodes));
    expect(changed.map((v) => v.id).sort()).toEqual(
      [
        'hvCommonTrunk',
        'hvLeft',
        'hvLeftTributary',
        'hvMiddle',
        'hvMiddleTributary',
        'hvRight',
        'hvRightAnterior',
        'hvRightPosterior',
        'pvLeftLateral',
        'pvLeftMedial',
        'pvRightAnterior',
        'pvRightPosterior',
        'interlobarArtery1',
        'interlobarArtery2',
        'interlobarArtery3',
        'interlobarVein1',
        'interlobarVein2',
        'interlobarVein3',
      ].sort(),
    );
    for (let i = 0; i < vessels.length; i++) {
      const { tube, ...rest } = vessels[i],
        { tube: old, ...previous } = before[i];
      expect(rest).toEqual(previous);
      for (const n of old.nodes) expect(tube.nodes).toContainEqual(n);
      expect(tube.nodes.length).toBeLessThanOrEqual(9);
      if (!changed.includes(vessels[i])) expect(tube).toEqual(old);
    }
    for (const id of ['ivcInfra', 'ivcSupra', 'pvTrunk', 'aorta']) {
      expect(vessels.find((v) => v.id === id)).toEqual(before.find((v) => v.id === id));
    }
  });
});
