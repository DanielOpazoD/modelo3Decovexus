/**
 * Rejilla de tejidos de la persona s0028 sobre los propios vóxeles de su TAC (1,5 mm), para medir la lista de
 * `docs/anatomia/relaciones-tac.md` con las mismas funciones en el modelo y en las máscaras (`s0028-relations.py`).
 *
 *   node --import tsx tools/anatomy/s0028-relations-grid.ts <carpeta de salida>
 *
 * Clasifica en material, en reposo y sin sonda. Escribe `model-grid.u8.gz` (tejido), `model-vessel.u8.gz` (0 ninguno, 1 aorta,
 * 2 cava, 3 porta, 4 suprahepática, 5 otro vaso) y `model-grid.json` (caja en índices de vóxel del TAC y nombres de tejido).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Tissue } from '../../src/anatomy/tissues';
import type { Vec3 } from '../../src/core/vec3';
import { BASELINE_CALIBER } from '../../src/validation/support/legacyPerson/scene';
import { loadS0028 } from './s0028Windows';

const out = process.argv[2];
if (!out) throw new Error('Falta la carpeta de salida');
mkdirSync(out, { recursive: true });
const meta = JSON.parse(readFileSync('tools/anatomy/s0028-case.json', 'utf8')) as {
  affineRASmm: number[][];
  rasToLASmm: number[][];
  shape: number[];
};
// Vóxel del TAC → mm LAS: una reflexión en x y una traslación (el mismo registro rígido de toda la migración).
const toLas = (i: number, j: number, k: number): Vec3 => {
  const ras = [0, 1, 2].map((a) => meta.affineRASmm[a][a] * [i, j, k][a] + meta.affineRASmm[a][3]);
  return [0, 1, 2].map((a) => meta.rasToLASmm[a][a] * ras[a] + meta.rasToLASmm[a][3]) as Vec3;
};
// Caja: todo el ancho, de y −150 a 130 mm y de z −250 a 80 mm (del polo renal inferior a la base del corazón).
const lo = [0, 54, 98],
  hi = [meta.shape[0], 241, 318],
  dim = hi.map((v, a) => v - lo[a]);
const { scene } = loadS0028();
const tissue = new Uint8Array(dim[0] * dim[1] * dim[2]),
  vessel = new Uint8Array(tissue.length);
const vesselCode = (id: string) =>
  id === 'aorta' ? 1 : id.startsWith('ivc') ? 2 : /^(pv|portal)/.test(id) ? 3 : id.startsWith('hv') ? 4 : 5;
const t0 = Date.now();
for (let k = 0; k < dim[2]; k++) {
  for (let j = 0; j < dim[1]; j++)
    for (let i = 0; i < dim[0]; i++) {
      const c = scene.classify(toLas(i + lo[0], j + lo[1], k + lo[2]), BASELINE_CALIBER);
      const at = (k * dim[1] + j) * dim[0] + i;
      tissue[at] = Number(c.tissue);
      if (c.vessel !== null) vessel[at] = vesselCode(String(c.vessel));
    }
  if (k % 40 === 0) console.log(`corte ${k} de ${dim[2]}: ${Math.round((Date.now() - t0) / 1000)} s`);
}
writeFileSync(`${out}/model-grid.u8.gz`, gzipSync(tissue));
writeFileSync(`${out}/model-vessel.u8.gz`, gzipSync(vessel));
const names = Object.fromEntries(
  Object.entries(Tissue)
    .filter(([, v]) => typeof v === 'number')
    .map(([name, v]) => [String(v), name]),
);
writeFileSync(
  `${out}/model-grid.json`,
  JSON.stringify(
    { voxelLo: lo, dimensions: dim, order: 'i-fastest', originLASmm: toLas(lo[0], lo[1], lo[2]), tissueNames: names },
    null,
    1,
  ),
);
console.log(`hecho: ${dim.join('×')} vóxeles en ${Math.round((Date.now() - t0) / 1000)} s`);
