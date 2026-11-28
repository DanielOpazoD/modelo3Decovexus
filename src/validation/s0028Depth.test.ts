import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { createSourceQueries } from '../anatomy/people/s0028/atlas';
import { installS0028Assets } from '../anatomy/people/s0028/assets';
import { packS0028DepthQuads } from '../anatomy/people/s0028/depthTexture';
import { S0028_BUNDLE as B } from '../anatomy/people/s0028/descriptor';
import { sourceDistance, sourceDistanceReader, sourceLabel } from '../anatomy/sourceVolume';
import type { Vec3 } from '../core/vec3';

/**
 * Las lecturas rápidas de s0028 (las que el contacto hace ~80 000 veces por pose) dan bit a bit lo mismo que la lectura
 * genérica: la EDT común con su proyección a la caja y cada campo fuente con `sourceDistanceReader`; y la consulta por nombre de
 * la clasificación (`s0028SourceValue`, con el campo resuelto una vez), la distancia y el rótulo de su campo. Si una difiere en un
 * bit, el contacto, el corte y la imagen dejan de ser los de antes sin que ninguna cifra lo diga.
 */
let abdominal: Uint16Array, thoracic: Uint16Array;
let source: ReturnType<typeof createSourceQueries>;
beforeAll(() => {
  const read = (name: string) => new Uint16Array(new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer);
  abdominal = read('abdominal-direct');
  thoracic = read('thoracic-direct');
  const auxiliary = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
  source = createSourceQueries(
    installS0028Assets({ abdominal, thoracic, capacity: auxiliary('annotation-capacity'), skin: auxiliary('skin-polar') }),
  );
}, 60_000);

/** Puntos pseudoaleatorios (semilla fija) en la caja y hasta 40 mm fuera de ella, más los nodos exactos y sus mitades. */
function points(origin: readonly number[], dimensions: readonly number[], pitch: number, n: number): Vec3[] {
  let state = 20261115;
  const rnd = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const node = i % 4 === 0;
    out.push(
      [0, 1, 2].map((k) => {
        const span = (dimensions[k] - 1) * pitch;
        if (node) return origin[k] + (Math.floor(rnd() * dimensions[k] * 2) / 2) * pitch;
        return origin[k] - 40 + rnd() * (span + 80);
      }) as Vec3,
    );
  }
  return out;
}

it('la EDT común de s0028 da bit a bit la proyección a la caja seguida de sourceDistance', () => {
  const f = B.depth;
  const reference = ([x, y, z]: Vec3): number => {
    const at: Vec3 = [0, 0, 0];
    let outside = 0;
    for (let i = 0; i < 3; i++) {
      const q = ((i === 0 ? x : i === 1 ? y : z) - f.originMm[i]) / 3;
      const a = Math.max(0, Math.min(f.dimensions[i] - 1, q));
      at[i] = f.originMm[i] + a * 3;
      outside += (q - a) ** 2;
    }
    return sourceDistance(abdominal, at, f, B.abdominal.textureDimensions) + Math.sqrt(outside) * 3;
  };
  const differ = points(f.originMm, f.dimensions, f.pitchMm, 40_000).filter(
    (p) => !Object.is(source.s0028DepthXyz(p[0], p[1], p[2]), reference(p)),
  );
  expect(differ.slice(0, 5)).toEqual([]);
});

it('la textura de profundidad conserva los cuatro nodos XY y satura en el borde', () => {
  const { data, width, height } = packS0028DepthQuads(abdominal);
  const [nx, ny, nz] = B.depth.dimensions;
  const [ox, oy, oz] = B.depth.offset;
  const [w, h] = B.abdominal.textureDimensions;
  const word = (x: number, y: number, z: number) => abdominal[2 * (((oz + z) * h + oy + y) * w + ox + x)];
  expect(data).toHaveLength(width * height * 4);
  for (const [x, y, z] of [
    [0, 0, 0],
    [8, 25, 1],
    [nx - 1, 10, 8],
    [5, ny - 1, nz - 1],
    [nx - 1, ny - 1, nz - 1],
  ]) {
    const offset = 4 * ((z * ny + y) * nx + x);
    const nextX = Math.min(x + 1, nx - 1),
      nextY = Math.min(y + 1, ny - 1);
    expect(Array.from(data.subarray(offset, offset + 4))).toEqual([
      word(x, y, z),
      word(nextX, y, z),
      word(x, nextY, z),
      word(nextX, nextY, z),
    ]);
  }
  expect(() => packS0028DepthQuads(undefined)).toThrow('EDT s0028 sin atlas abdominal completo');
});

it('sourceDistanceReader da bit a bit sourceDistance en cada campo fuente de s0028, dentro y fuera de su caja', () => {
  const bad: string[] = [];
  for (const f of B.fields) {
    const data = f.asset === 'abdominal' ? abdominal : thoracic,
      dims = B[f.asset].textureDimensions,
      read = sourceDistanceReader(data, f, dims);
    for (const p of points(f.originMm, f.dimensions, f.pitchMm, 4000))
      if (!Object.is(read(p[0], p[1], p[2]), sourceDistance(data, p, f, dims))) bad.push(`${f.name} ${p.join(',')}`);
  }
  expect(bad.slice(0, 5)).toEqual([]);
});

it('s0028SourceValue da bit a bit sourceDistance y sourceLabel del campo de ese nombre, y rechaza un nombre desconocido', () => {
  const bad: string[] = [];
  let inside = 0,
    labelled = 0;
  for (const f of B.fields) {
    const data = f.asset === 'abdominal' ? abdominal : thoracic,
      dims = B[f.asset].textureDimensions;
    for (const p of points(f.originMm, f.dimensions, f.pitchMm, 4000)) {
      const value = source.s0028SourceValue(p, f.name),
        d = sourceDistance(data, p, f, dims),
        label = sourceLabel(data, p, f, dims);
      if (!Object.is(value.d, d) || !Object.is(value.label, label)) bad.push(`${f.name} ${p.join(',')}`);
      inside += d < 0 ? 1 : 0;
      labelled += label > 0 ? 1 : 0;
    }
  }
  expect(bad.slice(0, 5)).toEqual([]);
  // el muestreo tiene dientes: puntos dentro de las máscaras y rótulos no nulos
  expect(inside).toBeGreaterThan(1000);
  expect(labelled).toBeGreaterThan(1000);
  expect(() => source.s0028SourceValue([0, 0, 0], 'liverr')).toThrow('Campo s0028 desconocido: liverr');
  // el campo se busca por su nombre en un mapa: ninguno se repite en el descriptor
  expect(new Set(B.fields.map((f) => f.name)).size).toBe(B.fields.length);
});
