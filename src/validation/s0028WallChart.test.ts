import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { HALF, toHalf } from '../anatomy/halfFloat';
import { S0028_BUNDLE as B, installAnatomyBundle } from './support/legacyPerson/anatomyBundle';
import { s0028WallUploads, setS0028Wall } from './support/legacyPerson/s0028Wall';

// Carta de pared idealizada (decisión 373): la que se usa es la del recurso alisada al cargar.
const TILE = 65 * 91 * 2 * 2,
  PAGE = 65 * 91 * 2;
let raw: Uint16Array, loaded: Uint16Array[];
beforeAll(() => {
  installAnatomyBundle(B);
  const read = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
  const capacity = read('annotation-capacity');
  setS0028Wall(capacity, read('skin-polar'));
  raw = new Uint16Array(capacity, 4096, 16 * TILE);
  loaded = s0028WallUploads()
    .slice(0, 16)
    .map((u) => u.data);
});

/** Las tres fronteras (externa, interna, interfaz) de la celda (x, y) de una tesela. */
const faces = (words: Uint16Array, at: number) => [HALF[words[at]], HALF[words[at + 1]], HALF[words[at + PAGE]]];

it('toHalf redondea al half más cercano y es la inversa de la tabla en los valores exactos', () => {
  for (const word of [0x3e00, 0x4000, 0x4a80, 0x5140, 0x3c01, 0x55ff]) expect(toHalf(HALF[word])).toBe(word);
  // 1/3 no es representable: el half elegido es el más cercano de sus dos vecinos.
  const third = toHalf(1 / 3);
  expect(Math.abs(HALF[third] - 1 / 3)).toBeLessThanOrEqual(Math.abs(HALF[third + 1] - 1 / 3));
  expect(Math.abs(HALF[third] - 1 / 3)).toBeLessThanOrEqual(Math.abs(HALF[third - 1] - 1 / 3));
  expect(() => toHalf(NaN)).toThrow(/half/);
  expect(() => toHalf(1e9)).toThrow(/half/);
});

/**
 * Oráculo independiente de los huecos (decisión 376): componentes de nodos U del recurso, con la vuelta cerrada en columnas, que
 * no tocan el borde superior ni el inferior de la carta y tienen hasta 200 nodos. Devuelve el hueco (≥ 1) de cada nodo, o 0.
 */
function closedHoles(): { hole: Int32Array; count: number } {
  const ROWS = 181,
    COLS = 512;
  const unknown = (row: number, col: number) => {
    const band = row < 90 ? 0 : 1;
    return Number.isNaN(HALF[raw[(band * 8 + (col >> 6)) * TILE + ((row - 90 * band) * 65 + (col & 63)) * 2]]);
  };
  const hole = new Int32Array(ROWS * COLS),
    seen = new Uint8Array(ROWS * COLS);
  let count = 0;
  for (let start = 0; start < ROWS * COLS; start++) {
    if (seen[start] || !unknown(Math.floor(start / COLS), start % COLS)) continue;
    const stack = [start],
      nodes: number[] = [];
    let open = false;
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!,
        row = Math.floor(i / COLS),
        col = i % COLS;
      nodes.push(i);
      if (row === 0 || row === ROWS - 1) open = true;
      for (const [r, c] of [
        [row, (col + 1) % COLS],
        [row, (col + COLS - 1) % COLS],
        [row - 1, col],
        [row + 1, col],
      ])
        if (r >= 0 && r < ROWS && !seen[r * COLS + c] && unknown(r, c)) {
          seen[r * COLS + c] = 1;
          stack.push(r * COLS + c);
        }
    }
    if (open || nodes.length > 200) continue;
    count++;
    for (const i of nodes) hole[i] = count;
  }
  return { hole, count };
}

it('la carta cargada rellena sólo los huecos cerrados y los rotula como estimación; el resto de U sigue U (decisión 376)', () => {
  const { hole, count } = closedHoles();
  // Medido el 13-11-2026 sobre el recurso: 267 huecos cerrados, 2.147 nodos, el mayor de 154.
  expect(count).toBe(267);
  expect(hole.reduce((n, h) => n + (h ? 1 : 0), 0)).toBe(2147);
  let known = 0,
    unknown = 0,
    filled = 0;
  // Cada hueco queda entre los valores de su borde: una interpolación no fabrica un máximo ni un mínimo propios.
  const range = Array.from({ length: count + 1 }, () => [Infinity, -Infinity, Infinity, -Infinity]);
  const cells: [number, number, number][] = [];
  for (let tile = 0; tile < 16; tile++)
    for (let cell = 0; cell < 65 * 91; cell++) {
      const row = (tile >> 3) * 90 + Math.floor(cell / 65),
        col = ((tile & 7) * 64 + (cell % 65)) % 512,
        h = hole[row * 512 + col];
      const before = faces(raw, tile * TILE + cell * 2),
        after = faces(loaded[tile], cell * 2),
        code = loaded[tile][cell * 2 + PAGE + 1];
      if (h) {
        filled++;
        for (let k = 0; k < 3; k++) expect(Number.isFinite(after[k]), `hueco ${h} fila ${row} columna ${col}`).toBe(true);
        // Procedencia E, E, E: una estimación en sus tres fronteras, nunca una medida.
        expect(HALF[code]).toBe(504);
        cells.push([h, after[0], after[2]]);
        continue;
      }
      for (let k = 0; k < 3; k++) expect(Number.isNaN(after[k])).toBe(Number.isNaN(before[k]));
      expect(code).toBe(raw[tile * TILE + cell * 2 + PAGE + 1]);
      if (Number.isNaN(before[0])) {
        unknown++;
        continue;
      }
      known++;
      // Nodos conocidos vecinos de un hueco: su borde.
      for (const [dr, dc] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        const r = row + dr,
          around = r >= 0 && r <= 180 ? hole[r * 512 + ((col + dc + 512) % 512)] : 0;
        if (!around) continue;
        const edge = range[around];
        edge[0] = Math.min(edge[0], after[0]);
        edge[1] = Math.max(edge[1], after[0]);
        edge[2] = Math.min(edge[2], after[2]);
        edge[3] = Math.max(edge[3], after[2]);
      }
    }
  for (const [h, outer, face] of cells) {
    // 2 mm de holgura: el alisado posterior mezcla cada nodo con vecinos de hasta seis celdas, también de fuera de su borde.
    expect(outer, `hueco ${h}`).toBeGreaterThan(range[h][0] - 2);
    expect(outer, `hueco ${h}`).toBeLessThan(range[h][1] + 2);
    expect(face, `hueco ${h}`).toBeGreaterThan(range[h][2] - 2);
    expect(face, `hueco ${h}`).toBeLessThan(range[h][3] + 2);
  }
  expect(known).toBeGreaterThan(20000);
  expect(unknown).toBeGreaterThan(20000);
  expect(filled).toBeGreaterThanOrEqual(2147);
});

it('la carta alisada conserva el orden de las capas y se aparta poco de la medida', () => {
  let worst = 0,
    sum = 0,
    count = 0;
  for (let tile = 0; tile < 16; tile++)
    for (let cell = 0; cell < 65 * 91; cell++) {
      const before = faces(raw, tile * TILE + cell * 2),
        [a, b, c] = faces(loaded[tile], cell * 2);
      if (Number.isNaN(a)) continue;
      expect(a).toBeGreaterThan(1.5);
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThanOrEqual(c);
      expect(c).toBeLessThanOrEqual(80);
      // Los nodos rellenados (decisión 376) no tienen medida con la que compararse.
      if (Number.isNaN(before[0])) continue;
      for (const [k, v] of [a, b, c].entries()) {
        const moved = Math.abs(v - before[k]);
        worst = Math.max(worst, moved);
        sum += moved;
        count++;
      }
    }
  // Medido el 13-11-2026: 0,56 mm de media y 8,8 mm en el peor nodo, el borde de un escalón de la pared que el alisado redondea.
  expect(sum / count).toBeLessThan(0.7);
  expect(worst).toBeLessThan(10);
});

it('las fascias pierden el ruido de nodo a nodo: la segunda diferencia a lo largo del arco cae a menos de la cuarta parte', () => {
  const roughness = (tiles: (tile: number) => { words: Uint16Array; base: number }) => {
    let sum = 0,
      count = 0;
    for (let tile = 0; tile < 16; tile++) {
      const { words, base } = tiles(tile);
      for (let y = 0; y < 90; y++)
        for (let x = 1; x < 64; x++)
          for (const k of [0, 1, PAGE]) {
            const at = base + (y * 65 + x) * 2 + k,
              d = HALF[words[at - 2]] - 2 * HALF[words[at]] + HALF[words[at + 2]];
            if (Number.isNaN(d)) continue;
            sum += Math.abs(d);
            count++;
          }
    }
    return sum / count;
  };
  const before = roughness((tile) => ({ words: raw, base: tile * TILE })),
    after = roughness((tile) => ({ words: loaded[tile], base: 0 }));
  expect(before).toBeGreaterThan(0.2);
  expect(after).toBeLessThan(0.25 * before);
});

it('los halos de la carta alisada repiten a su vecina, también al cerrar la vuelta', () => {
  for (let tile = 0; tile < 16; tile++) {
    const right = (tile & 8) | ((tile + 1) & 7);
    for (let y = 0; y < 91; y++)
      for (const k of [0, 1, PAGE, PAGE + 1])
        expect(loaded[tile][(y * 65 + 64) * 2 + k], `tesela ${tile} fila ${y}`).toBe(loaded[right][y * 65 * 2 + k]);
    if (tile < 8)
      for (let x = 0; x < 65; x++)
        for (const k of [0, 1, PAGE, PAGE + 1]) expect(loaded[tile][(90 * 65 + x) * 2 + k]).toBe(loaded[tile + 8][x * 2 + k]);
  }
});
