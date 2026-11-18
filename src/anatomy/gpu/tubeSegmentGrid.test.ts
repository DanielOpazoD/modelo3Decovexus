import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../core/vec3';
import { tubeQuery, tubeShapeTexel, type Tube } from '../primitives';
import { TUBE_GAP_REACH_MM, TUBE_GRID_NEAR_BASE, buildTubeGrid, tubeGridReach, tubeGridRegions, type TubeGrid } from './tubeGrid';

/** Los candidatos de la celda del punto y, con `near`, los tubos «cercanos» que les siguen (decisión 418). */
function candidates(grid: TubeGrid, point: Vec3, near = false): number[] {
  const q = point.map((v, k) => Math.floor(Math.fround(Math.fround(Math.fround(v) - grid.origin[k]) / grid.pitch)));
  if (q.some((v, k) => v < 0 || v >= grid.size[k])) return [];
  const cell = q[0] + grid.size[0] * (q[1] + grid.size[1] * q[2]);
  const first = grid.data[2 * cell],
    count = grid.data[2 * cell + 1] % TUBE_GRID_NEAR_BASE,
    nearby = Math.floor(grid.data[2 * cell + 1] / TUBE_GRID_NEAR_BASE);
  return Array.from({ length: near ? nearby : count }, (_, i) => grid.data[2 * (first + (near ? count : 0) + i)]);
}

function header(tube: Tube, scale: number, wall: number): Float32Array {
  const data = new Float32Array(20);
  data.set([0, tube.nodes.length, tube.apScale, scale, wall]);
  data.set(tubeShapeTexel(tube, scale), 16);
  return data;
}

describe('segment envelopes of the uploaded vascular geometry', () => {
  it('keeps every lumen/wall point selected by the original query across bends, caliber, anisotropy and radius noise', () => {
    const nodes: Tube['nodes'] = [
      { p: [-72, 8, -50], r: 2 },
      { p: [-32, 12, 30], r: 12 },
      { p: [40, -8, 80], r: 5 },
      { p: [92, 48, 110], r: 1 },
    ];
    const packed = Float32Array.from(nodes.flatMap((n) => [...n.p, n.r]));
    let checked = 0;
    for (const apScale of [0.25, 1, 1.8])
      for (const shaped of [false, true])
        for (const scale of [0.2, 0.7, 1, 1.5, 3]) {
          const tube: Tube = {
            kind: 'tube',
            nodes,
            apScale,
            ...(shaped ? { shape: { seed: 73, w: [0.6, 0, 0.8] as Vec3, kappa: 0.9, amp: 0.06 } } : { smoothRadius: true }),
          };
          const reach = tubeGridReach(header(tube, scale, 0.4), 12);
          const regions = tubeGridRegions(packed, 0, nodes.length, reach);
          const grid = buildTubeGrid([[0, 0, 0, 280]], [regions], 8)!;
          expect(grid).not.toBeNull();
          for (let segment = 0; segment < nodes.length - 1; segment++)
            for (const fraction of [-0.1, 0, 0.25, 0.5, 0.75, 1, 1.1]) {
              const a = nodes[segment],
                b = nodes[segment + 1];
              for (let direction = 0; direction < 24; direction++)
                for (const radius of [0, 0.5, 1, 1.1, 1.5, 2, 3]) {
                  const angle = (direction * Math.PI) / 12;
                  const delta = radius * scale * Math.max(a.r, b.r);
                  const point = a.p.map(
                    (v, k) => v + fraction * (b.p[k] - v) + delta * [Math.cos(angle), Math.sin(angle), Math.sin(3 * angle)][k],
                  ) as Vec3;
                  // An independent physical query decides positives, not the envelope formula.
                  if (tubeQuery(point, tube, scale).d < 1.4) {
                    expect(candidates(grid, point)).toContain(0);
                    checked++;
                  }
                }
            }
        }
    expect(checked).toBeGreaterThan(20_000);
  });

  it('lists as nearby every tube whose wall passes within TUBE_GAP_REACH_MM of a point, without touching the candidates (decisión 418)', () => {
    const wall = 0.4;
    let found = 0,
      nearbyOnly = 0;
    for (const nodes of [
      // el tubo grueso y curvo de la prueba de arriba y uno fino, como una rama portal o un conducto
      [
        { p: [-72, 8, -50], r: 2 },
        { p: [-32, 12, 30], r: 12 },
        { p: [40, -8, 80], r: 5 },
        { p: [92, 48, 110], r: 1 },
      ],
      [
        { p: [-60, 3, 5], r: 2.2 },
        { p: [10, 5, 9], r: 2.2 },
        { p: [70, -20, 30], r: 1.6 },
      ],
    ] as Tube['nodes'][]) {
      const packed = Float32Array.from(nodes.flatMap((n) => [...n.p, n.r]));
      const maxRadius = Math.max(...nodes.map((n) => n.r));
      for (const apScale of [0.25, 1, 1.8])
        for (const shaped of [false, true])
          for (const scale of [0.7, 1, 1.5]) {
            const tube: Tube = {
              kind: 'tube',
              nodes,
              apScale,
              ...(shaped ? { shape: { seed: 73, w: [0.6, 0, 0.8] as Vec3, kappa: 0.9, amp: 0.06 } } : { smoothRadius: true }),
            };
            const reach = tubeGridReach(header(tube, scale, wall), maxRadius);
            const regions = tubeGridRegions(packed, 0, nodes.length, reach);
            const near = tubeGridRegions(packed, 0, nodes.length, reach + TUBE_GAP_REACH_MM);
            const plain = buildTubeGrid([[0, 0, 0, 280]], [regions], 8)!;
            const grid = buildTubeGrid([[0, 0, 0, 280]], [regions], 8, [near])!;
            expect(grid).not.toBeNull();
            for (let segment = 0; segment < nodes.length - 1; segment++)
              for (const fraction of [-0.1, 0, 0.3, 0.6, 1, 1.1]) {
                const a = nodes[segment],
                  b = nodes[segment + 1];
                for (let direction = 0; direction < 24; direction++)
                  for (const beyond of [-1, 0.2, 1, 2, 3, 4, 4.4, 6, 9]) {
                    const angle = (direction * Math.PI) / 12;
                    const delta = scale * Math.max(a.r, b.r) + wall + beyond;
                    const point = a.p.map(
                      (v, k) => v + fraction * (b.p[k] - v) + delta * [Math.cos(angle), Math.sin(angle), Math.sin(3 * angle)][k],
                    ) as Vec3;
                    // Los candidatos a contener el punto no cambian por llevar la lista de cercanos.
                    expect(candidates(grid, point)).toEqual(candidates(plain, point));
                    // Una consulta física independiente decide quién está cerca, no la fórmula de la envolvente.
                    const hueco = tubeQuery(point, tube, scale).d - wall;
                    if (hueco > TUBE_GAP_REACH_MM) continue;
                    const listed = candidates(grid, point),
                      nearby = candidates(grid, point, true);
                    expect([...listed, ...nearby], `a ${hueco.toFixed(2)} mm`).toContain(0);
                    // un tubo va en una lista o en la otra, nunca en las dos
                    expect(listed.filter((t) => nearby.includes(t))).toEqual([]);
                    found++;
                    if (!listed.includes(0)) nearbyOnly++;
                  }
              }
          }
    }
    expect(found).toBeGreaterThan(10_000);
    // La lista de cercanos hace falta de verdad, aunque pocas veces: junto a la pared de un tubo fino hay puntos en celdas que no
    // lo tienen entre sus candidatos (su envolvente apenas pasa de su pared). Con estos dos tubos, 7 de más de 10.000.
    expect(nearbyOnly).toBeGreaterThan(0);
    // Sin envolventes ampliadas no hay cercanos y la cuenta de la celda es la de siempre.
    const thin = new Float32Array([-96, 0, 0, 2, 0, 0, 0, 2, 96, 0, 0, 2]);
    const regions = tubeGridRegions(thin, 0, 3, 4);
    const plain = buildTubeGrid([[0, 0, 0, 120]], [regions], 8)!;
    expect(Array.from(plain.data.filter((_, i) => i % 2 === 1)).every((count) => count < TUBE_GRID_NEAR_BASE)).toBe(true);
    // Envolventes ampliadas mal formadas: sin rejilla, como con las propias.
    expect(buildTubeGrid([[0, 0, 0, 120]], [regions], 8, [])).toBeNull();
  });

  it('deduplicates overlapping segment cells, preserves tube order and removes empty corners of a whole-tube sphere', () => {
    const nodes = new Float32Array([-96, 0, 0, 2, 0, 0, 0, 2, 96, 0, 0, 2]);
    const regions = tubeGridRegions(nodes, 0, 3, 4);
    const spheres = [
      [0, 0, 0, 120],
      [0, 0, 0, 120],
    ] as const;
    const full = buildTubeGrid(spheres)!;
    for (const pitch of [8, 16, 32]) {
      const grid = buildTubeGrid(spheres, [regions, regions], pitch)!;
      for (const x of [-96, -32, -1e-7, 0, 1e-7, 32, 96]) expect(candidates(grid, [x, 0, 0])).toEqual([0, 1]);
      expect(candidates(grid, [0, 80, 0])).toEqual([]);
      expect(candidates(full, [0, 80, 0])).toEqual([0, 1]);
    }
  });

  it('changes the cache reach when dilation crosses its conservative bucket and reads compact-header offsets', () => {
    const tube: Tube = {
      kind: 'tube',
      nodes: [
        { p: [0, 0, 0], r: 10 },
        { p: [0, 0, 10], r: 10 },
      ],
      apScale: 1,
    };
    const low = header(tube, 0.5, 0.4),
      nearby = header(tube, 0.65, 0.4),
      expanded = header(tube, 0.67, 0.4);
    expect(tubeGridReach(low, 10)).toBe(tubeGridReach(nearby, 10));
    expect(tubeGridReach(expanded, 10)).toBeGreaterThan(tubeGridReach(low, 10));
    const packed = new Float32Array(60);
    packed.set(expanded, 40);
    expect(tubeGridReach(packed, 10, 40)).toBe(tubeGridReach(expanded, 10));
  });

  it('rejects malformed envelopes and pitches so the renderer can retain the original traversal', () => {
    const sphere = [[0, 0, 0, 2]] as const;
    for (const pitch of [0, -1, NaN, Infinity, 1e-9]) expect(buildTubeGrid(sphere, undefined, pitch)).toBeNull();
    for (const regions of [[], [[]], [[{ min: [0, 0, 0], max: [-1, 1, 1] }]], [[{ min: [NaN, 0, 0], max: [1, 1, 1] }]]])
      expect(buildTubeGrid(sphere, regions)).toBeNull();
    const nodes = new Float32Array(8);
    for (const [start, count, reach] of [
      [0, Infinity, 4],
      [-1, 2, 4],
      [0, 3, 4],
      [0, 2, NaN],
      [0, 2, -1],
    ])
      expect(tubeGridRegions(nodes, start, count, reach)).toEqual([]);
    const h = new Float32Array(20);
    h[2] = 1;
    h[3] = 1;
    h[4] = 0.4;
    expect(Number.isNaN(tubeGridReach(h, -1))).toBe(true);
    h[2] = 0;
    expect(Number.isNaN(tubeGridReach(h, 1))).toBe(true);
  });
});
