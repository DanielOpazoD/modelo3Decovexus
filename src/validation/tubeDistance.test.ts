import { describe, expect, it } from 'vitest';
import { shapeMetric, tubeDistance, tubeNoise, tubeQuery, tubeShapeOf, type Tube, type TubeHit } from '../anatomy/primitives';
import { NORMAL_ADULT } from '../cases';
import { SeededRandom } from '../core/random';
import type { Vec3 } from '../core/vec3';
import { AnatomyScene } from './support/legacyPerson/scene';

/**
 * `tubeQuery` y `tubeDistance` comparten un recorrido desde la decisión 416: `tubeDistance` da la `d` y la `r` sin crear el
 * resultado ni el tubo del instante, para el volumen de muestra PW, que consulta la distancia a los tubos vecinos millones de veces
 * por segundo de señal en las uniones de la porta. Aquí queda `tubeQuery` como era antes, tal cual, de referencia: las dos de
 * hoy deben dar sus mismos valores, bit a bit, en todos los tubos del modelo y en cada rama de la cuenta (semieje AP, forma
 * orgánica con ruido del radio, radio smoothstep, segmento degenerado, coordenadas no finitas).
 */
function referenceTubeQuery(p: Vec3, tube: Tube, radiusScale = 1): TubeHit {
  const nodes = tube.nodes;
  const shape = tube.apScale === 1 && tube.shape ? shapeMetric(tube.shape, radiusScale) : null;
  const smooth = tube.smoothRadius === true;
  let bestD = Infinity;
  let bestDist = 0;
  let bestR = 1;
  let bestI = 0;
  let bestS = 0;
  let bestArc = 0;
  let bestT: Vec3 = [0, 0, 1];
  let arc = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i].p;
    const b = nodes[i + 1].p;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const apx = p[0] - a[0];
    const apy = p[1] - a[1];
    const apz = p[2] - a[2];
    const len2 = abx * abx + aby * aby + abz * abz;
    const len = Math.sqrt(len2);
    let s = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    const cx = a[0] + abx * s;
    const cy = a[1] + aby * s;
    const cz = a[2] + abz * s;
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    let dist: number;
    if (tube.apScale !== 1) {
      const l = len || 1;
      const tx = abx / l;
      const ty = aby / l;
      const tz = abz / l;
      const along = dx * tx + dy * ty + dz * tz;
      const px = dx - tx * along;
      const py = (dy - ty * along) / tube.apScale;
      const pz = dz - tz * along;
      dist = Math.sqrt(px * px + py * py + pz * pz + along * along);
    } else if (shape) {
      const q = dx * shape.wt[0] + dy * shape.wt[1] + dz * shape.wt[2];
      dist = shape.c * Math.sqrt(dx * dx + dy * dy + dz * dz + q * q);
    } else {
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const r = (nodes[i].r + (nodes[i + 1].r - nodes[i].r) * (smooth ? s * s * (3 - 2 * s) : s)) * radiusScale;
    const d = dist - r;
    if (d < bestD) {
      const l = len || 1;
      bestD = d;
      bestDist = dist;
      bestR = r;
      bestI = i;
      bestS = s;
      bestArc = arc + s * len;
      bestT = [abx / l, aby / l, abz / l];
    }
    arc += len;
  }
  const amp = tube.shape?.amp ?? 0;
  const r = amp > 0 ? bestR * (1 + amp * tubeNoise(tube.shape!.seed, bestArc)[0]) : bestR;
  return { d: bestDist - r, rho: bestDist / Math.max(1e-6, r), tangent: bestT, r, segment: bestI, s: bestS, arc: bestArc };
}

const numbers = (h: TubeHit): number[] => [h.d, h.rho, ...h.tangent, h.r, h.segment, h.s, h.arc];

/** ¿Dan `tubeQuery` y `tubeDistance` lo mismo que la referencia en `p`, con el tubo del instante de semieje `apScale`? */
function compare(tube: Tube, radiusScale: number, apScale: number, p: Vec3): boolean {
  const instant = apScale === tube.apScale ? tube : { ...tube, apScale };
  const before = numbers(referenceTubeQuery(p, instant, radiusScale));
  const now = numbers(tubeQuery(p, instant, radiusScale));
  const metric = apScale === 1 && tube.shape ? shapeMetric(tube.shape, radiusScale) : null;
  const out = { r: Number.NaN };
  const d = tubeDistance(p, tube, { scale: radiusScale, ap: apScale, wt: metric ? metric.wt : null, c: metric ? metric.c : 1 }, out);
  return now.length === 9 && now.every((x, k) => Object.is(x, before[k])) && Object.is(d, before[0]) && Object.is(out.r, before[5]);
}

describe('tubeQuery y tubeDistance dan lo mismo que la consulta de antes (decisión 416)', () => {
  it('en cada tubo del modelo, con otros calibres y semiejes AP: los mismos valores, bit a bit', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const tubes = [...scene.vessels, ...scene.ducts].map((def) => def.tube);
    const rng = new SeededRandom(1117);
    let points = 0;
    const different: string[] = [];
    for (const [k, tube] of tubes.entries())
      for (const radiusScale of [0.7, 1, 1.37, 1.8])
        for (const apScale of [tube.apScale, 0.31, 1.6])
          for (let n = 0; n < 60; n++) {
            // junto al eje (dentro de la luz, en la pared y fuera), más allá de los extremos y lejos
            const node = tube.nodes[Math.floor(rng.float() * tube.nodes.length)];
            const reach = [0.5, 3, 12, 60][n % 4];
            const p = node.p.map((x) => x + reach * (2 * rng.float() - 1)) as Vec3;
            points++;
            if (!compare(tube, radiusScale, apScale, p))
              different.push(`tubo ${k}, escala ${radiusScale}, AP ${apScale}, punto ${p.join(' ')}`);
          }
    // las ramas de la cuenta están todas en el modelo: forma con ruido, semieje AP propio y radio smoothstep
    expect(tubes.some((t) => t.shape && t.shape.amp > 0)).toBe(true);
    expect(tubes.some((t) => t.apScale !== 1)).toBe(true);
    expect(tubes.some((t) => t.smoothRadius)).toBe(true);
    expect(points).toBeGreaterThan(50_000);
    expect(different.slice(0, 5)).toEqual([]);
  });

  it('en los casos límite: un solo nodo, un segmento de longitud nula, puntos sobre un nodo y coordenadas no finitas', () => {
    const nodes = [
      { p: [0, 0, 0] as Vec3, r: 4 },
      { p: [0, 0, 0] as Vec3, r: 5 },
      { p: [10, 2, -3] as Vec3, r: 3 },
      { p: [18, 9, -3] as Vec3, r: 2 },
    ];
    const plain: Tube = { kind: 'tube', nodes, apScale: 1 };
    const tubes: Tube[] = [
      plain,
      { ...plain, nodes: nodes.slice(0, 1) },
      { ...plain, nodes: nodes.slice(0, 2) },
      { ...plain, apScale: 0.4, smoothRadius: true },
      { ...plain, shape: tubeShapeOf(7, 'portal', nodes) },
      { ...plain, shape: tubeShapeOf(3, 'vein', nodes) },
    ];
    const points: Vec3[] = [
      [0, 0, 0],
      [10, 2, -3],
      [5, 1, -1.5],
      [-40, 0, 0],
      [18, 9, -3.0000001],
      [Number.NaN, 0, 0],
      [Infinity, 1, 1],
      [1, -Infinity, 1],
    ];
    for (const [k, tube] of tubes.entries())
      for (const radiusScale of [0.5, 1, 1.7])
        for (const apScale of [tube.apScale, 1.3])
          for (const p of points)
            expect(compare(tube, radiusScale, apScale, p), `tubo ${k}, escala ${radiusScale}, AP ${apScale}, punto ${p.join(' ')}`).toBe(
              true,
            );
  });
});
