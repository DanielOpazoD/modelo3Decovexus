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

it('alisar no inventa ni borra pared: cada nodo U sigue U, cada nodo conocido sigue conocido y el código no cambia', () => {
  let known = 0,
    unknown = 0;
  for (let tile = 0; tile < 16; tile++)
    for (let cell = 0; cell < 65 * 91; cell++) {
      const before = faces(raw, tile * TILE + cell * 2),
        after = faces(loaded[tile], cell * 2);
      for (let k = 0; k < 3; k++) expect(Number.isNaN(after[k])).toBe(Number.isNaN(before[k]));
      expect(loaded[tile][cell * 2 + PAGE + 1]).toBe(raw[tile * TILE + cell * 2 + PAGE + 1]);
      if (Number.isNaN(before[0])) unknown++;
      else known++;
    }
  expect(known).toBeGreaterThan(20000);
  expect(unknown).toBeGreaterThan(20000);
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
