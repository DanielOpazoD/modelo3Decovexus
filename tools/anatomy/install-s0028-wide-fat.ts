/**
 * Instala la grasa compatible D del abdomen s0028 a 3 mm (`s0028-wide-fat.py`) en el espacio libre de la reserva de
 * pared, tras el bloque P3, y la coloca en páginas libres del atlas abdominal. No añade activos, texturas ni memoria:
 * la reserva ya estaba asignada. Re-fija la reserva, el manifiesto y la procedencia de las mallas, y escribe el
 * descriptor `S0028_WIDE_FAT` y los testigos de prueba. Se puede repetir sobre una reserva ya instalada.
 *
 *   python -I tools/anatomy/s0028-wide-fat.py --case-dir "$VEXUS_S0028_CASE_DIR" --out <carpeta>
 *   node --import tsx tools/anatomy/install-s0028-wide-fat.ts <carpeta>
 *   npx prettier --write src/anatomy/s0028WideFatData.ts src/validation/fixtures/s0028-wide-fat.json
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { S0028_BUNDLE as B } from '../../src/anatomy/people/s0028/descriptor';
import { s0028FatPages, s0028RenalPages } from '../../src/anatomy/people/s0028/solidsData';

const folder = process.argv[2];
if (!folder) throw new Error('Indicar la carpeta de s0028-wide-fat.py');
const hash = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const info = JSON.parse(readFileSync(resolve(folder, 'wide-fat.json'), 'utf8')) as {
  format: string;
  person: string;
  provenance: string;
  pitchMm: number;
  originMm: number[];
  dimensions: number[];
  bitCount: number;
  byteCount: number;
  fatCells: number;
  sha256: string;
  ctSha256: string;
};
const bits = readFileSync(resolve(folder, 'wide-fat.bin'));
const cells = info.dimensions[0] * info.dimensions[1] * info.dimensions[2];
if (
  info.format !== 's0028-wide-fat-3mm-v1' ||
  info.person !== 's0028' ||
  info.provenance !== 'D' ||
  info.pitchMm !== 3 ||
  info.ctSha256 !== B.ctSha256 ||
  info.bitCount !== cells ||
  info.byteCount !== Math.ceil(cells / 8) ||
  bits.length !== info.byteCount ||
  hash(bits) !== info.sha256
)
  throw new Error('Grasa amplia de otro formato, persona o contenido');
// Las celdas de 3 mm agrupan 2 × 2 × 2 vóxeles de la rejilla común: sus caras caen a medio vóxel de los nodos P1.
const lattice = B.fields[0].originMm;
if (info.originMm.some((v, k) => Math.abs((((v - lattice[k] + 0.75) / 1.5) % 1) + 1) % 1 > 1e-6))
  throw new Error('La caja no está alineada con la rejilla común del TAC');

const capacityPath = 'src/anatomy/s0028/annotation-capacity.gzip.bin';
const raw = Buffer.from(gunzipSync(readFileSync(capacityPath)));
if (raw.length !== B.capacity.rawBytes || raw.toString('ascii', 0, 4) !== 'S28C') throw new Error('Reserva distinta');
const headerBytes = raw.readUInt32LE(4);
const header = JSON.parse(raw.toString('utf8', 8, 8 + headerBytes)) as { parts: Record<string, unknown>[] };
const wall = header.parts.find((p) => p.name === 'wall');
const S = B.solids;
if (!wall || wall.offsetBytes !== 4096 || wall.p3Bytes !== S.encodedBytes + S.pageTableBytes) throw new Error('Cabecera de pared distinta');
// El bloque P3 y todo lo anterior no se tocan.
if (hash(raw.subarray(4096 + S.offsetBytes, 4096 + S.offsetBytes + S.encodedBytes)) !== S.sha256) throw new Error('Bloque P3 alterado');
const offsetBytes = S.offsetBytes + S.encodedBytes + S.pageTableBytes;
const pages = Math.ceil(info.byteCount / 2048);
const encodedBytes = pages * 4096;
if (offsetBytes % 2 || offsetBytes + encodedBytes > (wall.bytes as number))
  throw new Error('La grasa amplia no cabe en la reserva de pared');
// Un byte exacto por half, como la grasa P3; el relleno de la última página es cero.
const half = (n: number): number => {
  if (n === 0) return 0;
  const e = Math.floor(Math.log2(n));
  return ((e + 15) << 10) | ((n / 2 ** e - 1) * 1024);
};
const block = Buffer.alloc(encodedBytes);
for (let i = 0; i < bits.length; i++) block.writeUInt16LE(half(bits[i]), 2 * i);
block.copy(raw, 4096 + offsetBytes);
wall.wideFatBytes = encodedBytes;
wall.wideFatFormat = `${info.format}; ${pages} RG16F 32x32 pages of exact byte halves, after the P3 block`;
const headerText = Buffer.from(JSON.stringify(header));
if (8 + headerText.length > 4096) throw new Error('La cabecera no cabe');
raw.fill(0, 8, 8 + headerBytes);
raw.writeUInt32LE(headerText.length, 4);
headerText.copy(raw, 8);
const compressed = gzipSync(raw, { level: 9 });
const capacity = { rawBytes: raw.length, gzipBytes: compressed.length, sha256Gzip: hash(compressed), sha256Raw: hash(raw) };

// Páginas 32×32 libres del atlas abdominal: fuera de campos P1, EDT, pared P2, grasa P3 e interior renal.
const [W, H, D] = B.abdominal.textureDimensions;
const used = new Uint8Array(W * H * D);
const free = (o: readonly number[], s: readonly number[]): boolean => {
  if (o[0] + s[0] > W || o[1] + s[1] > H || o[2] + s[2] > D) return false;
  for (let z = o[2]; z < o[2] + s[2]; z++)
    for (let y = o[1]; y < o[1] + s[1]; y++) for (let x = o[0]; x < o[0] + s[0]; x++) if (used[(z * H + y) * W + x]) return false;
  return true;
};
const occupy = (o: readonly number[], s: readonly number[], what: string) => {
  if (!free(o, s)) throw new Error('Solape o desborde en el atlas: ' + what);
  for (let z = o[2]; z < o[2] + s[2]; z++)
    for (let y = o[1]; y < o[1] + s[1]; y++) for (let x = o[0]; x < o[0] + s[0]; x++) used[(z * H + y) * W + x] = 1;
};
for (const f of B.fields) if (f.asset === 'abdominal') occupy(f.offset, f.dimensions, f.name);
occupy(B.depth.offset, B.depth.dimensions, 'depth');
B.wall.placements.forEach((o, i) => occupy(o, B.wall.tileSize, 'tesela ' + i));
occupy(B.wall.centerOffset, [1, 181, 1], 'centros');
occupy(B.wallDerived.ramps.placement, B.wallDerived.ramps.size, 'rampas');
s0028FatPages().forEach((o, i) => occupy(o, [32, 32, 1], 'grasa ' + i));
s0028RenalPages().forEach((o, i) => occupy(o, [32, 32, 1], 'interior renal ' + i));
let placements = '';
let placed = 0;
for (let z = 0; z < D && placed < pages; z++)
  for (let y = 0; y < 8 && placed < pages; y++)
    for (let x = 0; x < 6 && placed < pages; x++) {
      const o = [32 * x, 32 * y, z];
      if (!free(o, [32, 32, 1])) continue;
      occupy(o, [32, 32, 1], 'grasa amplia');
      placements += (x + 6 * y + 48 * z).toString(36).padStart(3, '0');
      placed++;
    }
if (placed !== pages) throw new Error('El atlas abdominal no tiene páginas libres suficientes');

// El manifiesto fija el archivo de la reserva: mismas claves y mismo número de cifras, sólo cambian los valores.
const manifestPath = 'src/anatomy/s0028/candidate-manifest.bin';
let manifest = readFileSync(manifestPath, 'utf8');
const swap = (from: string | number, to: string | number) => {
  const a = JSON.stringify(from),
    b = JSON.stringify(to);
  if (a === b) return;
  if (!manifest.includes(a)) throw new Error('El manifiesto no contiene ' + a);
  manifest = manifest.split(a).join(b);
};
swap(B.capacity.sha256Gzip, capacity.sha256Gzip);
swap(B.capacity.sha256Raw, capacity.sha256Raw);
swap(B.capacity.gzipBytes, capacity.gzipBytes);
swap(B.capacity.rawBytes - B.capacity.gzipBytes, capacity.rawBytes - capacity.gzipBytes);
JSON.parse(manifest);
const manifestPin = { bytes: Buffer.byteLength(manifest), sha256: hash(manifest) };

writeFileSync(capacityPath, compressed);
writeFileSync(manifestPath, manifest);
const dataPath = 'src/anatomy/s0028WallData.ts';
const pin = (text: string, key: string, value: object) => {
  const re = new RegExp(`  ${key}: \\{[^}]*\\},\\n`, 'u');
  if (!re.test(text)) throw new Error('Sin bloque ' + key);
  return text.replace(
    re,
    `  ${key}: {\n${Object.entries(value)
      .map(([k, v]) => `    ${k}: ${typeof v === 'string' ? `'${v}'` : v},`)
      .join('\n')}\n  },\n`,
  );
};
writeFileSync(dataPath, pin(pin(readFileSync(dataPath, 'utf8'), 'capacity', capacity), 'manifest', manifestPin));
const wideFat = {
  format: info.format,
  provenance: 'D',
  pitchMm: 3,
  originMm: info.originMm,
  dimensions: info.dimensions,
  byteCount: info.byteCount,
  fatCells: info.fatCells,
  offsetBytes,
  encodedBytes,
  sha256: info.sha256,
  pages: placements,
};
writeFileSync(
  'src/anatomy/s0028WideFatData.ts',
  '/** Generado por tools/anatomy/install-s0028-wide-fat.ts. Grasa compatible D del abdomen a 3 mm; sin validación clínica. */\n' +
    'export const S0028_WIDE_FAT = ' +
    JSON.stringify(wideFat, null, 2) +
    ' as const;\n',
);
copyFileSync(resolve(folder, 'samples.json'), 'src/validation/fixtures/s0028-wide-fat.json');
// La procedencia de las mallas fija el bundle completo: se calcula con el descriptor ya reescrito, en otro proceso.
const bundleSha = execFileSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '--input-type=module',
    '-e',
    "import { createHash } from 'node:crypto'; import { S0028_BUNDLE as B } from './src/anatomy/people/s0028/descriptor'; process.stdout.write(createHash('sha256').update(JSON.stringify(B)).digest('hex'));",
  ],
  { encoding: 'utf8' },
).trim();
if (!/^[0-9a-f]{64}$/u.test(bundleSha)) throw new Error('No se pudo calcular la procedencia del bundle');
const surfacePath = 'src/anatomy/s0028SurfaceData.ts';
writeFileSync(
  surfacePath,
  readFileSync(surfacePath, 'utf8').replace(/sourceBundleSha256: '[a-f0-9]+'/u, `sourceBundleSha256: '${bundleSha}'`),
);
console.log(JSON.stringify({ capacity, manifest: manifestPin, pages, offsetBytes, encodedBytes, bundleSha }));
