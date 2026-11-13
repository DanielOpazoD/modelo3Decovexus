import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { HALF } from '../anatomy/halfFloat';
import { gpuPlan } from '../anatomy/people/s0028/gpu';
import { s0028RenalPages, s0028WideFatPages } from '../anatomy/people/s0028/solidsData';
import { createAbdominalTexture } from '../ultrasound/abdominalTexture';
import { setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { S0028_BUNDLE as B, installAnatomyBundle } from './support/legacyPerson/anatomyBundle';
import { s0028FatPages, setS0028Solids } from './support/legacyPerson/s0028Solids';
import { s0028WallUploads, setS0028Wall } from './support/legacyPerson/s0028Wall';
import { fixturePerson } from './support/legacyPerson/state';

it('sube los 16 tiles RG16F y centros como vistas de la carta cargada en el único atlas P1, sin copiar el atlas ni derivar la carta S−dN', () => {
  installAnatomyBundle(B);
  const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
  const data = new Uint16Array(B.abdominal.rawBytes / 2),
    capacity = raw('annotation-capacity');
  setAbdominalAtlas(data);
  setS0028Wall(capacity, raw('skin-polar'));
  setS0028Solids(capacity);
  const storage = vi.fn(),
    uploads: { x: number; y: number; z: number; w: number; h: number; d: number; input: Uint16Array }[] = [];
  const gl = {
    TEXTURE_3D: 0x806f,
    MAX_3D_TEXTURE_SIZE: 0x8073,
    RG16F: 0x822f,
    RG: 0x8227,
    HALF_FLOAT: 0x140b,
    NO_ERROR: 0,
    createTexture: () => ({}),
    bindTexture: vi.fn(),
    getParameter: () => 2048,
    getError: () => 0,
    texParameteri: vi.fn(),
    texStorage3D: storage,
    deleteTexture: vi.fn(),
    texSubImage3D: (
      _t: number,
      _l: number,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      _f: number,
      _s: number,
      input: Uint16Array,
    ) => uploads.push({ x, y, z, w, h, d, input }),
  };
  const person = fixturePerson();
  createAbdominalTexture(gl as unknown as WebGL2RenderingContext, true, false, person, gpuPlan(person));
  expect(storage).toHaveBeenCalledExactlyOnceWith(gl.TEXTURE_3D, 1, gl.RG16F, ...B.abdominal.textureDimensions);
  const chart = s0028WallUploads()[0].data.buffer;
  for (const [tile, offset] of B.wall.placements.entries()) {
    const u = uploads.find((u) => u.x === offset[0] && u.y === offset[1] && u.z === offset[2] && u.w === 65 && u.h === 91 && u.d === 2);
    expect(u, `tile ${tile}`).toBeDefined();
    // La carta cargada es una sola copia alisada del recurso (decisión 373); cada tesela es una vista suya, sin más copias.
    // Se compara la identidad, no el contenido: un fallo no debe volcar megabytes en el informe.
    expect(u?.input.buffer === chart).toBe(true);
    expect(chart === capacity).toBe(false);
    expect(u?.input.byteOffset).toBe(tile * 65 * 91 * 2 * 4);
  }
  const centre = uploads.find((u) => u.x === 48 && u.y === 0 && u.z === 398 && u.w === 1 && u.h === 181);
  expect(centre?.input.buffer === chart).toBe(true);
  expect(centre?.input.byteLength).toBe(724);
  // Regla directa: sólo pared y centros; la carta S−dN del Newton descartado ya no se deriva ni se sube.
  expect(uploads.filter((u) => u.w === 65 && u.h === 91)).toHaveLength(16);
  expect(uploads.filter((u) => u.x === 65 && u.z >= 619)).toEqual([]);
  // P3 r3: las 77 páginas de grasa D, vistas de la reserva tras el derivado P2, en las colocaciones de su tabla.
  const allPages = uploads.filter((u) => u.w === 32 && u.h === 32 && u.d === 1);
  const pages = allPages.slice(0, 77);
  expect(pages.map((u) => [u.x, u.y, u.z])).toEqual(s0028FatPages());
  pages.forEach((u, i) => {
    expect(u.input.buffer).toBe(capacity);
    expect([u.input.byteOffset, u.input.length]).toEqual([4096 + B.solids.offsetBytes + 4096 * i, 2048]);
  });
  expect(pages).toHaveLength(77);
  // Interior renal (decisión 341): 46 páginas más, en huecos propios del mismo atlas y fuera de la reserva de pared; cada
  // half es un byte exacto con dos códigos de vóxel válidos (0 U, 3, 4, 9, 10, 13).
  const renal = allPages.slice(77, 123);
  expect(renal.map((u) => [u.x, u.y, u.z])).toEqual(s0028RenalPages());
  expect(renal).toHaveLength(46);
  const taken = new Set(s0028FatPages().map((o) => o.join()));
  for (const u of renal) {
    expect(taken.has([u.x, u.y, u.z].join())).toBe(false);
    taken.add([u.x, u.y, u.z].join());
    expect(u.input.buffer).not.toBe(capacity);
    expect(u.input.length).toBe(2048);
    for (const half of u.input) {
      const byte = HALF[half];
      expect([0, 3, 4, 9, 10, 13]).toContain(byte & 15);
      expect([0, 3, 4, 9, 10, 13]).toContain(byte >> 4);
    }
  }
  // Grasa del abdomen a 3 mm (decisión 343): 43 páginas más, vistas de la misma reserva tras el bloque P3, en huecos propios.
  const wide = allPages.slice(123);
  expect(wide.map((u) => [u.x, u.y, u.z])).toEqual(s0028WideFatPages());
  expect(wide).toHaveLength(43);
  wide.forEach((u, i) => {
    expect(taken.has([u.x, u.y, u.z].join())).toBe(false);
    taken.add([u.x, u.y, u.z].join());
    expect(u.input.buffer).toBe(capacity);
    expect([u.input.byteOffset, u.input.length]).toEqual([4096 + B.wideFat.offsetBytes + 4096 * i, 2048]);
  });
  expect(data.every((x) => x === 0)).toBe(true);
});

it('las teselas apiladas en z dejan huecos U NaN junto a celdas D/E: la carta no admite filtro del hardware', () => {
  // Página 1 de la tesela 3 (interfaz/código) y página 0 de la 4 (posterior U) son cortes z contiguos del atlas: el
  // filtro trilineal mezcla el vecino aun con peso 0 y NaN·0 = NaN. El lector GLSL lee esquinas con texelFetch.
  installAnatomyBundle(B);
  const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
  setS0028Wall(raw('annotation-capacity'), raw('skin-polar'));
  const uploads = s0028WallUploads();
  expect(uploads[4].offset[2]).toBe(uploads[3].offset[2] + 2);
  const at = (tile: number, page: number, x: number, y: number, k: number) => HALF[uploads[tile].data[((page * 91 + y) * 65 + x) * 2 + k]];
  let hazards = 0;
  for (let y = 0; y < 91; y++)
    for (let x = 0; x < 65; x++) if (Number.isFinite(at(3, 1, x, y, 0)) && Number.isNaN(at(4, 0, x, y, 0))) hazards++;
  expect(hazards).toBeGreaterThan(1000);
});
