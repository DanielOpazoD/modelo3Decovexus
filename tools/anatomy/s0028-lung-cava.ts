/**
 * Separa el pulmón de la cava en el atlas torácico de s0028 (decisión 375). En el TAC la base del pulmón derecho queda pegada a la
 * cava suprahepática y su máscara pisa el tubo idealizado del vaso: la línea pleural salía adosada a la pared posterior de la cava.
 * El pulmón se retira hasta `GAP_MM` de la luz (resta del vaso dilatado: d' = max(d, GAP_MM − c), con c la distancia a la luz), lo
 * justo para su pared y la lámina del diafragma. Parte siempre del recurso original; el resultado se fija en el descriptor.
 *
 *   node --import tsx tools/anatomy/s0028-lung-cava.ts [--write]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { HALF, toHalf } from '../../src/anatomy/halfFloat';
import { S0028_BUNDLE as B } from '../../src/anatomy/people/s0028/descriptor';
import { tubeQuery } from '../../src/anatomy/primitives';
import { DIAPHRAGM_THICKNESS_MM } from '../../src/anatomy/tissues';
import type { Vec3 } from '../../src/core/vec3';
import { loadS0028 } from './s0028Windows';

const ASSET = 'src/anatomy/s0028/thoracic-direct.gzip.bin';
const ORIGINAL_RAW_SHA256 = '0aef3f322af70ec5dc3f00221ac4710756abc42f31e055d61c05044ccbc92f0e';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const raw = new Uint8Array(gunzipSync(readFileSync(ASSET)));
if (sha(raw) !== ORIGINAL_RAW_SHA256)
  throw new Error('Este paso parte del atlas torácico original: restáurelo antes (git show <commit>:' + ASSET + ')');
const words = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
const { scene } = loadS0028();
const cava = scene.vessels.filter((v) => v.flowFactor === undefined && String(v.id).startsWith('ivc'));
if (cava.length !== 2) throw new Error('Se esperaban los dos tramos de la cava');
/** Pared de la cava, lámina del diafragma y un resto para la rejilla de 1,5 mm. */
const GAP_MM = Math.max(...cava.map((v) => v.wallMm)) + DIAPHRAGM_THICKNESS_MM + 0.2;
const lung = B.fields.find((f) => f.name === 'lung')!;
const [W, H] = B.thoracic.textureDimensions;
// Caja de los ejes de la cava con el alcance del cambio: fuera de ella nada puede cambiar.
const reach = GAP_MM + 16 + Math.max(...cava.flatMap((v) => v.tube.nodes.map((n) => n.r)));
const lo = [0, 1, 2].map((a) => Math.min(...cava.flatMap((v) => v.tube.nodes.map((n) => n.p[a]))) - reach);
const hi = [0, 1, 2].map((a) => Math.max(...cava.flatMap((v) => v.tube.nodes.map((n) => n.p[a]))) + reach);
let changed = 0,
  removed = 0,
  deepest = 0;
for (let k = 0; k < lung.dimensions[2]; k++)
  for (let j = 0; j < lung.dimensions[1]; j++)
    for (let i = 0; i < lung.dimensions[0]; i++) {
      const p: Vec3 = [lung.originMm[0] + i * lung.pitchMm, lung.originMm[1] + j * lung.pitchMm, lung.originMm[2] + k * lung.pitchMm];
      if (p.some((v, a) => v < lo[a] || v > hi[a])) continue;
      const at = 2 * ((k + lung.offset[2]) * W * H + (j + lung.offset[1]) * W + i + lung.offset[0]);
      const d = HALF[words[at]];
      const c = Math.min(...cava.map((v) => tubeQuery(p, v.tube).d));
      // Cuantizado a 1/16 mm, como el resto del campo: el recurso comprimido apenas crece.
      const next = Math.round(16 * Math.min(16, GAP_MM - c)) / 16;
      if (!(next > d)) continue;
      words[at] = next === 0 ? 0 : toHalf(next);
      changed++;
      if (d < 0 && next >= 0) removed++;
      if (d < 0 && next >= 0) deepest = Math.max(deepest, -d);
    }
// El zlib del sistema (el de Python) comprime este campo un 2,5 % mejor que el de Node: es el que fija el tamaño del recurso.
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
console.log(
  `separación ${GAP_MM} mm; nodos cambiados ${changed}; vóxeles que dejan de ser pulmón ${removed} (${((removed * lung.pitchMm ** 3) / 1000).toFixed(1)} ml)`,
);
console.log(`el vóxel retirado más profundo estaba ${deepest.toFixed(1)} mm dentro del pulmón`);
console.log(`gzipBytes ${packed.byteLength}\nsha256Gzip ${sha(packed)}\nsha256Raw ${sha(raw)}`);
if (process.argv.includes('--write')) writeFileSync(ASSET, packed);
