import type { AnatomyScene } from '../../anatomy/scene';

interface Sample {
  p: readonly number[];
  r: number;
  /** Distancia al extremo más cercano del vaso, a lo largo de su eje (mm). */
  end: number;
}
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function samples(nodes: readonly { p: readonly number[]; r: number }[]): Sample[] {
  const out: { p: readonly number[]; r: number; s: number }[] = [];
  let s = 0;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i],
      b = nodes[i + 1],
      length = distance(a.p, b.p),
      n = Math.max(1, Math.round(length / 2));
    for (let k = 0; k < n; k++)
      out.push({ p: a.p.map((x, j) => x + ((b.p[j] - x) * k) / n), r: a.r + ((b.r - a.r) * k) / n, s: s + (length * k) / n });
    s += length;
  }
  out.push({ ...nodes[nodes.length - 1], s });
  return out.map((q) => ({ p: q.p, r: q.r, end: Math.min(q.s, s - q.s) }));
}

/**
 * Vasos madre cuyas luces se atraviesan sin estar unidos: pares «a × b: solape en (x, y, z)». Dos vasos están unidos si un extremo
 * de uno toca el eje del otro (nace o muere en él). No cuenta el tramo a menos de `endMm` de un extremo (zona de unión con su propio
 * tronco, donde las hermanas convergen), ni lo que queda por debajo de `floorZ` (pelvis, fuera de las ventanas del examen). Hasta
 * `minMm` de solape de luces es contacto de paredes (1 mm cada una), como la aorta y la cava apoyadas una en otra.
 */
export function lumenOverlaps(scene: AnatomyScene, { minMm = 2, endMm = 12, floorZ = -240 } = {}): string[] {
  const mothers = scene.vessels.filter((v) => v.flowFactor === undefined);
  const axes = new Map(mothers.map((v) => [v.id, samples(v.tube.nodes)]));
  const touches = (a: Sample[], b: Sample[]) => [a[0], a[a.length - 1]].some((e) => b.some((q) => distance(e.p, q.p) < q.r + 3));
  const found: string[] = [];
  for (let i = 0; i < mothers.length; i++)
    for (let j = i + 1; j < mothers.length; j++) {
      const a = axes.get(mothers[i].id)!,
        b = axes.get(mothers[j].id)!;
      if (touches(a, b) || touches(b, a)) continue;
      let worst = minMm,
        at: readonly number[] | null = null;
      for (const p of a)
        if (p.end >= endMm && p.p[2] >= floorZ)
          for (const q of b)
            if (q.end >= endMm && p.r + q.r - distance(p.p, q.p) > worst) [worst, at] = [p.r + q.r - distance(p.p, q.p), p.p];
      if (at) found.push(`${mothers[i].id} × ${mothers[j].id}: ${worst.toFixed(1)} mm en (${at.map((x) => x.toFixed(0)).join(', ')})`);
    }
  return found;
}
