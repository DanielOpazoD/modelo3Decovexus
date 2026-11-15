import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { HALF } from '../anatomy/halfFloat';
import { S0028_BUNDLE as B } from '../anatomy/people/s0028/descriptor';
import { buildS0028FieldMask, s0028FieldMaskCell, s0028FieldMaskPages, s0028FieldMaskUploads } from '../anatomy/people/s0028/fieldMask';
import { S0028_MASK_FIELDS } from '../anatomy/people/s0028/fieldMaskFields';
import { s0028FatPages, s0028RenalPages, s0028WideFatPages } from '../anatomy/people/s0028/solidsData';
import { S0028_FIELD_MASK as M } from '../anatomy/s0028FieldMaskData';
import { sourceDistance } from '../anatomy/sourceVolume';
import type { Vec3 } from '../core/vec3';

/**
 * Mapa de ocupación de los campos fuente de s0028 (decisión 400). La GPU no lee un campo cuyo bit está apagado y toma 16: es exacto
 * solo si el campo vale 16 en toda la celda. Aquí, que el mapa es conservador (ningún punto con un campo bajo 16 cae en una celda
 * con su bit apagado), que cubre las cajas y que sus páginas no pisan nada del atlas.
 */
let abdominal: Uint16Array, thoracic: Uint16Array, mask: Uint32Array;
beforeAll(() => {
  const read = (name: string) => new Uint16Array(new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer);
  abdominal = read('abdominal-direct');
  thoracic = read('thoracic-direct');
  mask = buildS0028FieldMask(abdominal, thoracic);
}, 60_000);

const fields = S0028_MASK_FIELDS.map((name) => B.fields.find((f) => f.name === name)!);

it('ningún punto con un campo bajo 16 cae en una celda con su bit apagado: dentro, en los bordes de celda y junto a las cajas', () => {
  let state = 400;
  const rnd = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const bad: string[] = [];
  let near = 0,
    checked = 0;
  fields.forEach((f, bit) => {
    const data = f.asset === 'abdominal' ? abdominal : thoracic,
      dims = B[f.asset].textureDimensions;
    for (let i = 0; i < 6000; i++) {
      // la mitad, puntos de la caja del campo (y 3 mm alrededor); la otra mitad, en los bordes de las celdas del mapa
      const p = [0, 1, 2].map((k) => {
        const span = (f.dimensions[k] - 1) * f.pitchMm;
        const x = f.originMm[k] - 3 + rnd() * (span + 6);
        if (i % 2) return x;
        const c = Math.round((x - M.originMm[k]) / M.cellMm);
        return M.originMm[k] + c * M.cellMm + (rnd() < 0.5 ? -1e-4 : 1e-4);
      }) as Vec3;
      const d = sourceDistance(data, p, f, dims);
      checked++;
      if (!(d < 16)) continue;
      near++;
      const cell = s0028FieldMaskCell(p);
      if (cell < 0 || !((mask[cell] >>> bit) & 1)) bad.push(`${f.name} ${p.map((v) => v.toFixed(3)).join(',')} d=${d.toFixed(3)}`);
    }
  });
  expect(near, 'el muestreo tiene dientes: puntos con el campo cerca').toBeGreaterThan(checked / 4);
  expect(bad.slice(0, 5)).toEqual([]);
});

it('la rejilla cubre las cajas de los 19 campos y el mapa deja leer de media dos campos por celda ocupada', () => {
  for (const f of fields)
    for (let k = 0; k < 3; k++) {
      expect(f.originMm[k], f.name).toBeGreaterThanOrEqual(M.originMm[k]);
      expect(f.originMm[k] + (f.dimensions[k] - 1) * f.pitchMm, f.name).toBeLessThan(M.originMm[k] + M.dimensions[k] * M.cellMm);
    }
  let cells = 0,
    bits = 0;
  for (const v of mask)
    if (v) {
      cells++;
      for (let x = v; x; x >>>= 1) bits += x & 1;
    }
  // medido el 15-11-2026: 2,0 de 19 campos por celda ocupada
  expect(bits / cells).toBeLessThan(3);
  expect(mask.every((v) => v < 2 ** fields.length)).toBe(true);
});

it('sus páginas caben, no pisan campos, EDT, pared, grasa ni interior renal, y guardan los bits como enteros exactos', () => {
  const pages = s0028FieldMaskPages();
  expect(pages).toHaveLength(Math.ceil(M.cells / 1024));
  const [W, H, D] = B.abdominal.textureDimensions;
  const boxes: Array<[readonly number[], readonly number[]]> = [
    ...B.fields.filter((f) => f.asset === 'abdominal').map((f): [readonly number[], readonly number[]] => [f.offset, f.dimensions]),
    [B.depth.offset, B.depth.dimensions],
    ...B.wall.placements.map((o): [readonly number[], readonly number[]] => [o, B.wall.tileSize]),
    [B.wall.centerOffset, [1, 181, 1]],
    [B.wallDerived.ramps.placement, B.wallDerived.ramps.size],
    ...[...s0028FatPages(), ...s0028RenalPages(), ...s0028WideFatPages()].map((o): [readonly number[], readonly number[]] => [
      o,
      [32, 32, 1],
    ]),
  ];
  const overlap = (a: readonly number[], as: readonly number[], b: readonly number[], bs: readonly number[]) =>
    [0, 1, 2].every((k) => a[k] < b[k] + bs[k] && b[k] < a[k] + as[k]);
  pages.forEach((o, i) => {
    expect(o[0] + 32 <= W && o[1] + 32 <= H && o[2] < D, `página ${i}`).toBe(true);
    expect(
      boxes.some(([b, s]) => overlap(o, [32, 32, 1], b, s)),
      `página ${i}`,
    ).toBe(false);
    pages.slice(0, i).forEach((q) => expect(overlap(o, [32, 32, 1], q, [32, 32, 1]), `páginas ${i}`).toBe(false));
  });
  const uploads = s0028FieldMaskUploads(mask);
  for (let i = 0; i < mask.length; i += 97) {
    const page = uploads[i >> 10].data,
      t = (i & 1023) * 2;
    expect(HALF[page[t]] + HALF[page[t + 1]] * 2048, `celda ${i}`).toBe(mask[i]);
  }
});
