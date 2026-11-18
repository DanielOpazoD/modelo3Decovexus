/** Conservative candidates inside the original tube-sphere domain; optional segment envelopes tighten membership. */
export const TUBE_GRID_PITCH_MM = 32;
export const TUBE_GRID_WIDTH = 256;
const MAX_TEXELS = TUBE_GRID_WIDTH * 2048;
// A conservative margin also covers shader float rounding at cell and sphere boundaries.
const PAD_MM = 1;
/**
 * Alcance (mm) de la lista de tubos «cercanos» de cada celda (decisión 418): los que no pueden contener ningún punto de la celda
 * pero pasan a menos de esta distancia de alguno. La pasada B los mira para saber si el plano central tiene la pared de un vaso a
 * menos de un grosor de haz (σe + 0,5 mm: 2,4 mm a 9 cm y 3,2 mm a 16 cm en armónica); más allá de él no ve los vasos vecinos.
 */
export const TUBE_GAP_REACH_MM = 4.5;
/** La cuenta de una celda lleva sus candidatos y, multiplicados por esta base, los tubos cercanos que les siguen en la lista. */
export const TUBE_GRID_NEAR_BASE = 256;
export type TubeSphere = readonly [number, number, number, number];
export type TubeBox = { min: readonly number[]; max: readonly number[] };
export interface TubeGrid {
  origin: [number, number, number];
  size: [number, number, number];
  /** Por celda, (primer índice, candidatos + `TUBE_GRID_NEAR_BASE` × cercanos); después, las listas: candidatos y cercanos. */
  data: Float32Array;
  height: number;
  pitch: number;
}

/**
 * Euclidean envelope of the current Float32 H0/H1/H4 tube header. The metric
 * distance is at least |delta| / stretch, and noise cannot exceed amp * radius.
 * Round only UP, for cache reuse; a changed reach must invalidate membership.
 */
export function tubeGridReach(header: ArrayLike<number>, maximumRadius: number, offset = 0): number {
  const ap = header[offset + 2],
    scale = header[offset + 3],
    wall = header[offset + 4];
  if (maximumRadius < 0 || scale < 0 || ap <= 0 || wall < 0) return NaN;
  const stretch = Math.max(1, ap, Math.pow(1 + header[offset + 16] ** 2 + header[offset + 17] ** 2 + header[offset + 18] ** 2, 0.25));
  const radius = maximumRadius * scale * (1 + Math.max(0, header[offset + 19]));
  // Portal wallThicknessMm is capped at 1.4 mm; other walls use H1.x.
  return Math.ceil(((radius + Math.max(1.4, wall)) * stretch) / 4) * 4;
}

/** Union of segment capsules, enclosed by boxes. Reads the exact packed GPU nodes. */
export function tubeGridRegions(nodes: ArrayLike<number>, firstFloat: number, count: number, reach: number): TubeBox[] {
  const result: TubeBox[] = [];
  if (
    !Number.isSafeInteger(count) ||
    count < 2 ||
    !Number.isSafeInteger(firstFloat) ||
    firstFloat < 0 ||
    !Number.isFinite(reach) ||
    reach < 0 ||
    firstFloat + 4 * count > nodes.length
  )
    return result;
  for (let segment = 0; segment < count - 1; segment++) {
    const a = firstFloat + segment * 4,
      b = a + 4;
    result.push({
      min: [0, 1, 2].map((k) => Math.min(nodes[a + k], nodes[b + k]) - reach),
      max: [0, 1, 2].map((k) => Math.max(nodes[a + k], nodes[b + k]) + reach),
    });
  }
  return result;
}

function malformed(lists: readonly (readonly TubeBox[])[], tubes: number): boolean {
  return (
    lists.length !== tubes ||
    lists.some(
      (list) =>
        !list.length ||
        list.some(
          (box) =>
            box.min.length !== 3 ||
            box.max.length !== 3 ||
            box.min.some(
              (v, k) =>
                !Number.isFinite(v) ||
                !Number.isFinite(box.max[k]) ||
                Math.abs(v) > 32768 ||
                Math.abs(box.max[k]) > 32768 ||
                v > box.max[k],
            ),
        ),
    )
  );
}

/**
 * Cell headers are (first index, count); entries retain ascending compact tube order.
 *
 * Con `near` (las envolventes de cada tubo ampliadas `TUBE_GAP_REACH_MM`, decisión 418) cada celda lleva además, detrás de sus
 * candidatos, los tubos «cercanos»: los que tocan la celda con la envolvente ampliada y no con la suya. No son candidatos a
 * contener un punto (el bucle del clasificador no los recorre); solo dicen qué vasos pasan junto a la celda. La cuenta de la
 * celda es entonces candidatos + `TUBE_GRID_NEAR_BASE` × cercanos, y la rejilla se extiende ese mismo alcance.
 */
export function buildTubeGrid(
  spheres: readonly TubeSphere[],
  regions?: readonly (readonly TubeBox[])[],
  pitch = TUBE_GRID_PITCH_MM,
  near?: readonly (readonly TubeBox[])[],
): TubeGrid | null {
  if (!Number.isFinite(pitch) || pitch <= 0) return null;
  if (!spheres.length || spheres.length >= TUBE_GRID_NEAR_BASE) return null;
  if (spheres.some((s) => !s.every((v) => Number.isFinite(v) && Math.abs(v) <= 32768) || s[3] < 0)) return null;
  if ((regions && malformed(regions, spheres.length)) || (near && malformed(near, spheres.length))) return null;
  const pad = PAD_MM + (near ? TUBE_GAP_REACH_MM : 0);
  const origin = [0, 1, 2].map((k) => Math.floor(Math.min(...spheres.map((s) => s[k] - s[3] - pad)) / pitch) * pitch) as TubeGrid['origin'];
  const size = [0, 1, 2].map(
    (k) => Math.floor((Math.max(...spheres.map((s) => s[k] + s[3] + pad)) - origin[k]) / pitch) + 1,
  ) as TubeGrid['size'];
  const cells = size[0] * size[1] * size[2];
  if (!Number.isSafeInteger(cells) || cells <= 0 || cells > MAX_TEXELS) return null;
  // Dos pasadas sobre las mismas celdas, sin mapas ni conjuntos (la rejilla se rehace al mover la sonda): la primera cuenta
  // candidatos y cercanos por celda y la segunda los escribe tras las cabeceras, celda a celda. `stamp` recuerda el último tubo
  // que visitó cada celda como candidato y `nearStamp` como cercano: una celda no repite tubo, y un candidato no es cercano.
  const boxesOf = (t: number): readonly TubeBox[] => {
    const sphere = spheres[t];
    return regions?.[t] ?? [{ min: [0, 1, 2].map((k) => sphere[k] - sphere[3]), max: [0, 1, 2].map((k) => sphere[k] + sphere[3]) }];
  };
  const stamp = new Int32Array(cells),
    nearStamp = new Int32Array(cells);
  const count = new Uint16Array(cells),
    nearCount = new Uint16Array(cells);
  /** Recorre las celdas nuevas de las cajas de `t` (candidato o cercano) y llama a `visit` con cada una. */
  const sweep = (t: number, boxes: readonly TubeBox[], nearby: boolean, visit: (cell: number) => void): void => {
    const marks = nearby ? nearStamp : stamp;
    for (const box of boxes) {
      const lo0 = Math.max(0, Math.floor((box.min[0] - PAD_MM - origin[0]) / pitch)),
        lo1 = Math.max(0, Math.floor((box.min[1] - PAD_MM - origin[1]) / pitch)),
        lo2 = Math.max(0, Math.floor((box.min[2] - PAD_MM - origin[2]) / pitch));
      const hi0 = Math.min(size[0] - 1, Math.floor((box.max[0] + PAD_MM - origin[0]) / pitch)),
        hi1 = Math.min(size[1] - 1, Math.floor((box.max[1] + PAD_MM - origin[1]) / pitch)),
        hi2 = Math.min(size[2] - 1, Math.floor((box.max[2] + PAD_MM - origin[2]) / pitch));
      for (let z = lo2; z <= hi2; z++)
        for (let y = lo1; y <= hi1; y++) {
          const row = size[0] * (y + size[1] * z);
          for (let x = lo0; x <= hi0; x++) {
            const i = row + x;
            if (marks[i] === t + 1 || (nearby && stamp[i] === t + 1)) continue;
            marks[i] = t + 1;
            visit(i);
          }
        }
    }
  };
  let entries = 0;
  for (let t = 0; t < spheres.length; t++) {
    sweep(t, boxesOf(t), false, (i) => {
      count[i]++;
      entries++;
    });
    if (near)
      sweep(t, near[t], true, (i) => {
        nearCount[i]++;
        entries++;
      });
    if (entries + cells > MAX_TEXELS) return null;
  }
  const height = Math.ceil((cells + entries) / TUBE_GRID_WIDTH);
  const data = new Float32Array(TUBE_GRID_WIDTH * height * 2);
  // Cada celda con algún tubo: sus candidatos y, detrás, sus cercanos. `next` y `nearNext`, dónde escribe el siguiente.
  const next = new Int32Array(cells),
    nearNext = new Int32Array(cells);
  let at = cells;
  for (let i = 0; i < cells; i++) {
    if (!count[i] && !nearCount[i]) continue;
    data[i * 2] = at;
    data[i * 2 + 1] = count[i] + TUBE_GRID_NEAR_BASE * nearCount[i];
    next[i] = at;
    nearNext[i] = at + count[i];
    at += count[i] + nearCount[i];
  }
  stamp.fill(0);
  nearStamp.fill(0);
  for (let t = 0; t < spheres.length; t++) {
    sweep(t, boxesOf(t), false, (i) => {
      data[next[i]++ * 2] = t;
    });
    if (near)
      sweep(t, near[t], true, (i) => {
        data[nearNext[i]++ * 2] = t;
      });
  }
  return { origin, size, data, height, pitch };
}
