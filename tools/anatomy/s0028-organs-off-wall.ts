/**
 * Saca de la banda de pared lo que sobresale de hígado, bazo y pulmón de s0028 (decisión 377). Con la carta de pared alisada a
 * mayor escala, las máscaras de esos órganos pisan la banda en sus abombamientos y el punto quedaba en conflicto, sin material. A
 * cada campo se le resta la banda medida con una unión suave: d' = smax(d, cara interna − profundidad + `MARGIN_MM`), de radio
 * `BLEND_MM`. Con el máximo seco, donde el borde propio y el recortado se alternan de vóxel a vóxel la cápsula salía en cuentas.
 * Una pared estimada (hueco rellenado, decisión 376) no recorta: ahí gana el órgano.
 *
 *   node --import tsx tools/anatomy/s0028-organs-off-wall.ts [--write]
 *
 * Parte de los recursos que dejan `s0028-liver-border.py` (abdominal) y `s0028-lung-cava.ts` (torácico), fijados por su hash: la
 * unión suave no es idempotente y no debe aplicarse dos veces.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { HALF, toHalf } from '../../src/anatomy/halfFloat';
import { S0028_BUNDLE as B } from '../../src/anatomy/people/s0028/descriptor';
import type { Vec3 } from '../../src/core/vec3';
import { loadS0028 } from './s0028Windows';

/** Holgura (mm) entre el órgano y la cara interna de la pared: la interpolación trilineal y la cuantización no devuelven el solape. */
const MARGIN_MM = 0.25;
/** Radio (mm) de la unión suave entre el borde propio del órgano y el recortado; aleja el borde como mucho un cuarto de este radio. */
const BLEND_MM = 2;
/** Fuera de la banda, distancia (mm) al borde del órgano y a la cara de la pared hasta la que se escribe la unión suave. */
const NEAR_MM = 3;
/** Crudo de cada recurso de partida: el abdomen de la decisión 372 y el tórax de la 375. */
const INPUT_RAW_SHA256 = {
  abdominal: '71c84fec75495c41d085d19d868bbe51571cacf606e8e4bf2687da3a5d7bbe4e',
  thoracic: '5c89a709627f53d1a2d5d717b2c33f093eb37408e9feb8c94fef8559788f6678',
};
/** Máximo suave polinómico: igual al máximo cuando los operandos distan más de `BLEND_MM`. */
const smax = (a: number, b: number) => {
  const h = Math.max(BLEND_MM - Math.abs(a - b), 0) / BLEND_MM;
  return Math.max(a, b) + (h * h * BLEND_MM) / 4;
};
const FIELDS = ['liver', 'spleen', 'lung'] as const;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const { scene } = loadS0028();
const regional = scene.person.cpu.regional!;

for (const asset of ['abdominal', 'thoracic'] as const) {
  const path = `src/anatomy/s0028/${asset}-direct.gzip.bin`;
  const raw = new Uint8Array(gunzipSync(readFileSync(path)));
  if (sha(raw) !== INPUT_RAW_SHA256[asset])
    throw new Error(`Este paso parte del recurso ${asset} anterior a la decisión 377: restáurelo antes`);
  const words = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const [W, H] = B[asset].textureDimensions;
  for (const field of B.fields.filter((f) => f.asset === asset && (FIELDS as readonly string[]).includes(f.name))) {
    let changed = 0,
      removed = 0,
      deepest = 0;
    for (let k = 0; k < field.dimensions[2]; k++)
      for (let j = 0; j < field.dimensions[1]; j++)
        for (let i = 0; i < field.dimensions[0]; i++) {
          const at = 2 * ((k + field.offset[2]) * W * H + (j + field.offset[1]) * W + i + field.offset[0]);
          const d = HALF[words[at]];
          // Lejos del órgano el campo ya vale su tope: la banda no puede acercarle la frontera.
          if (d >= 16) continue;
          const p: Vec3 = [
            field.originMm[0] + i * field.pitchMm,
            field.originMm[1] + j * field.pitchMm,
            field.originMm[2] + k * field.pitchMm,
          ];
          const q = regional.s0028WallAt(p);
          if (q?.kind !== 'known' || q.estimated) continue;
          // Cuantizado a 1/16 mm, como el resto del campo.
          const band = q.interfaceMm - q.depthMm + MARGIN_MM;
          // La unión suave sólo donde decide la superficie: dentro de la banda o a menos de `NEAR_MM` del borde y de la cara.
          if (!(band > d) && !(Math.abs(d) < NEAR_MM && Math.abs(band) < NEAR_MM)) continue;
          const next = Math.round(16 * Math.min(16, smax(d, band))) / 16;
          if (!(next > d)) continue;
          words[at] = next === 0 ? 0 : toHalf(next);
          changed++;
          if (d < 0 && next >= 0) {
            removed++;
            deepest = Math.max(deepest, -d);
          }
        }
    console.log(
      `${field.name}: ${changed} nodos cambiados; ${removed} dejan de ser órgano (${((removed * field.pitchMm ** 3) / 1000).toFixed(1)} ml); el más profundo, ${deepest.toFixed(1)} mm`,
    );
  }
  // El zlib del sistema (el de Python) comprime estos campos mejor que el de Node: es el que fija el tamaño del recurso.
  const packed = new Uint8Array(
    execFileSync(
      'python3',
      ['-c', 'import gzip,sys;sys.stdout.buffer.write(gzip.compress(sys.stdin.buffer.read(),compresslevel=9,mtime=0))'],
      {
        input: raw,
        maxBuffer: 1 << 28,
      },
    ),
  );
  console.log(`${asset}: gzipBytes ${packed.byteLength}\n  sha256Gzip ${sha(packed)}\n  sha256Raw ${sha(raw)}`);
  if (process.argv.includes('--write')) writeFileSync(path, packed);
}
