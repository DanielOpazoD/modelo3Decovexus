import { smoothstep, type Vec3 } from '../../../core/vec3';
import { HALF } from '../../halfFloat';
import type { PersonAssets } from '../../personAssets';
import { S0028_RENAL_INTERIOR as R } from '../../s0028RenalInteriorData';
import { S0028_RENAL_INTERIOR_RUNS } from '../../s0028RenalInteriorRuns';
import { sourceDistance, sourceLabel } from '../../sourceVolume';
import { S0028_BUNDLE as B } from './descriptor';
import { s0028FatPages, s0028RenalPages, s0028WideFatPages } from './solidsData';
import type { S0028WallSample } from './wall';
/** O máscara fuente automática; D derivación reproducible; E hipótesis acotada; U desconocido (decisión 321). */
export type S0028Certainty = 'O' | 'D' | 'E' | 'U';
/**
 * Vocabulario cerrado de dueños P3 (el de r1, `s0028-solids.py`, más la banda P2): Gerota, cuadrado lumbar aislado,
 * diafragma posterior, interior renal y compartimentos perirrenal/pararrenal no son dueños; quedan U.
 */
export type S0028OwnerId =
  | 'liver'
  | 'spleen'
  | 'pancreas'
  | 'kidney_right'
  | 'kidney_left'
  | 'gallbladder'
  | 'bladder'
  | 'stomach'
  | 'bowel'
  | 'iliopsoas_left'
  | 'iliopsoas_right'
  | 'autochthon_left'
  | 'autochthon_right'
  | 'bone'
  | 'cartilage'
  | 'kidney_cyst_left'
  | 'lung'
  | 'heart'
  | 'wall'
  | 'compatible_fat';
/** Un dueño geométrico: borde D (SDF lineal de su máscara O, banda P2 o vóxel de grasa) y certeza de su interior. */
export interface S0028Owner {
  readonly id: S0028OwnerId;
  /** Distancia con signo al borde propio (mm, negativa dentro); 0 en la grasa, cuyo borde es el del vóxel. */
  readonly d: number;
  readonly certainty: S0028Certainty;
}
/** Todos los dueños independientes de un punto, antes de cualquier política: ≥ 2 es conflicto y se conservan todos. */
export interface S0028Ownership {
  readonly state: 'known' | 'conflict' | 'U';
  readonly owners: readonly S0028Owner[];
  /** Distancia con signo al borde O de la máscara renal más cercana (mm; 16 fuera de ambas cajas): su contorno acústico. */
  readonly kidneyMm: number;
}

/** Etiquetas del interior renal (r5): el exportador offline las saca del propio TAC; 0 es U. */
export const S0028_RENAL_LABEL = { U: 0, cortex: 1, medulla: 2, sinusFat: 3, collectingSystem: 4, sinusUnclassified: 5 } as const;
const RENAL_CODE: Readonly<Record<string, number>> = { U: 0, C: 9, M: 10, F: 3, P: 4, S: 13 };
let renalCodes: readonly Uint8Array[] | undefined;
/** Código por vóxel de cada caja (xyz, z rápida): bits 0–2 la etiqueta, bit 3 hipótesis E. Se expande una vez. */
function s0028RenalCodes(): readonly Uint8Array[] {
  renalCodes ??= R.boxes.map((b, i) => {
    const codes = new Uint8Array(b.dimensions[0] * b.dimensions[1] * b.dimensions[2]);
    let at = 0;
    for (const [, symbol, length] of S0028_RENAL_INTERIOR_RUNS[i].matchAll(/([A-Z])([0-9a-z]*)/gu)) {
      const n = length ? parseInt(length, 36) : 1;
      codes.fill(RENAL_CODE[symbol], at, at + n);
      at += n;
    }
    if (at !== codes.length) throw new Error('Interior renal s0028 truncado');
    return codes;
  });
  return renalCodes;
}
/** Half exacto de un byte 0…255, como lo guarda la textura RG16F. */
const byteHalf = (n: number): number => {
  if (n === 0) return 0;
  const e = Math.floor(Math.log2(n));
  return ((e + 15) << 10) | ((n / 2 ** e - 1) * 1024);
};

export function createSolidsQueries(assets: PersonAssets) {
  const abdominalAtlas = assets.buffers.abdominal,
    thoracicAtlas = assets.buffers.thoracic;
  /**
   * Contorno acústico renal (r3): el borde O de la máscara es la cara `RenalCapsule` aunque a ambos lados haya U. La
   * dibujan las muestras a menos de esto de él: más que el alcance del perfil de una cara de dos lados (0,49 mm por la
   * cota de gradiente 1,5 y la de la compresión) y dentro del vóxel en el que la GPU lee los ocho nodos exactos (con
   * 1,5 mm el corte caía en el borde del filtro del hardware: 4 de 364 muestras distintas). Dentro, sin corteza ni seno.
   */

  // Campo P1, dueño (o dueños por etiqueta nearest 1…n) y certeza del interior. Los vasos fuente son de P5.
  const TABLE: ReadonlyArray<readonly [string, S0028OwnerId | readonly S0028OwnerId[], S0028Certainty]> = [
    ['liver', 'liver', 'O'],
    ['spleen', 'spleen', 'O'],
    ['pancreas', 'pancreas', 'O'],
    // Borde D de la máscara. El dueño sigue siendo U: su interior lo rotula `s0028RenalInterior` (E) y sin rótulo es U.
    ['kidneyRight', 'kidney_right', 'U'],
    ['kidneyLeft', 'kidney_left', 'U'],
    ['gallbladder', 'gallbladder', 'O'],
    ['bladder', 'bladder', 'O'],
    ['digestiveTract', ['stomach', 'bowel', 'bowel', 'bowel'], 'O'],
    ['posteriorMuscle', ['iliopsoas_left', 'iliopsoas_right', 'autochthon_left', 'autochthon_right'], 'O'],
    ['lumbarSacralBone', 'bone', 'O'],
    ['sacrum', 'bone', 'O'],
    ['thoracicBone', 'bone', 'O'],
    ['cartilage', 'cartilage', 'O'],
    // Contenido líquido de un quiste simple: hipótesis E, rotulada.
    ['renalCysts', 'kidney_cyst_left', 'E'],
    ['lung', 'lung', 'O'],
    // Interiores cardíacos E de P7.
    ['heart', 'heart', 'E'],
  ];
  const FIELDS = TABLE.map(([name]) => B.fields.find((f) => f.name === name)!);
  // Vasos fuente (P5): no son dueños P3, pero la grasa compatible D tampoco puede reclamar su interior. Los nodos de grasa
  // nunca caen en un campo P1 (rejillas alineadas); la lámina subvóxel de los vasos sí (revisión r2: 9/800.000 muestras).
  const VESSELS = ['aorta', 'inferior_vena_cava', 'portal_vein_and_splenic_vein'].map((name) => B.fields.find((f) => f.name === name)!);
  const insideVessel = (p: Vec3): boolean =>
    VESSELS.some((f) => sourceDistance(f.asset === 'abdominal' ? abdominalAtlas! : thoracicAtlas!, p, f, B[f.asset].textureDimensions) < 0);

  let fat: Uint16Array | undefined;
  let wideFat: Uint16Array | undefined;
  /**
   * Vista del bloque P3 de la reserva verificada (tras el derivado P2): un byte por half exacto, bits little-endian,
   * cajas xyz con z rápida. Ninguna copia; rechaza bytes no enteros, fuera de 0…255, relleno no nulo o una tabla de
   * páginas distinta de la del descriptor (la que la GPU lleva como constante).
   */
  function setS0028Solids(capacity: ArrayBuffer): void {
    const S = B.solids;
    if (capacity.byteLength !== B.capacity.rawBytes) throw new Error('Paquete P3 s0028 incompleto');
    const words = new Uint16Array(capacity, 4096 + S.offsetBytes, S.encodedBytes / 2);
    for (let i = 0; i < words.length; i++) {
      const v = HALF[words[i]];
      if (i < S.byteCount ? !(v >= 0 && v <= 255 && v === Math.floor(v)) : words[i] !== 0) throw new Error('Grasa P3 corrupta');
    }
    const table = new Uint16Array(capacity, 4096 + S.offsetBytes + S.encodedBytes, S.pageTableBytes / 2);
    if (s0028FatPages().flat().join() !== table.join()) throw new Error('Tabla de páginas P3 distinta');
    // Grasa del abdomen a 3 mm, tras el bloque P3 en la misma reserva: un byte por half exacto, relleno nulo.
    const F = B.wideFat;
    const wide = new Uint16Array(capacity, 4096 + F.offsetBytes, F.encodedBytes / 2);
    for (let i = 0; i < wide.length; i++) {
      const v = HALF[wide[i]];
      if (i < F.byteCount ? !(v >= 0 && v <= 255 && v === Math.floor(v)) : wide[i] !== 0) throw new Error('Grasa amplia corrupta');
    }
    fat = words;
    wideFat = wide;
  }

  /** Las páginas de grasa en sus colocaciones del atlas abdominal ya asignado: texSubImage, sin textura ni sampler nuevos. */
  function s0028SolidsUploads(): ReadonlyArray<{ offset: readonly number[]; size: readonly number[]; data: Uint16Array }> {
    if (!fat) throw new Error('Paquete P3 s0028 no cargado');
    return [
      ...s0028FatPages().map((offset, i) => ({ offset, size: [32, 32, 1], data: fat!.subarray(2048 * i, 2048 * (i + 1)) })),
      ...s0028RenalUploads(),
      ...s0028WideFatPages().map((offset, i) => ({ offset, size: [32, 32, 1], data: wideFat!.subarray(2048 * i, 2048 * (i + 1)) })),
    ];
  }

  /** Páginas del interior renal: dos vóxeles por byte (el par en el nibble bajo), un byte exacto por half, página nueva por caja. */
  function s0028RenalUploads(): ReadonlyArray<{ offset: readonly number[]; size: readonly number[]; data: Uint16Array }> {
    const words = new Uint16Array(2048 * R.pageCount);
    s0028RenalCodes().forEach((codes, i) => {
      for (let v = 0; v < codes.length; v += 2)
        words[2048 * R.boxes[i].pageBase + (v >> 1)] = byteHalf(codes[v] | ((codes[v + 1] ?? 0) << 4));
    });
    return s0028RenalPages().map((offset, i) => ({ offset, size: [32, 32, 1], data: words.subarray(2048 * i, 2048 * (i + 1)) }));
  }

  /**
   * Etiqueta del interior renal en el vóxel nearest de la caja del lado de p (derecha si x < 10 mm): 1 corteza y 2 médula
   * (hipótesis E, dentro de la máscara renal), 3 seno graso y 4 colector (D, en el hueco del hilio, fuera de la máscara),
   * 5 vasos e interfaces del seno sin subclasificar (compartimento D, material E); 0 es U, también fuera de la caja.
   * Par GLSL: `s28PRen`.
   * @twin s0028-interior-renal
   */
  function s0028RenalInterior(p: Vec3): number {
    const side = p[0] < 10 ? 0 : 1,
      b = R.boxes[side],
      [nx, ny, nz] = b.dimensions,
      x = Math.round((p[0] - b.originMm[0]) / 1.5),
      y = Math.round((p[1] - b.originMm[1]) / 1.5),
      z = Math.round((p[2] - b.originMm[2]) / 1.5);
    // El dominio lo decide el índice redondeado, no la coordenada: en la última cara de la caja el float32 de la GPU
    // y el double de la CPU caerían a lados distintos de una comparación continua.
    if (!(x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz)) return 0;
    return s0028RenalCodes()[side][(x * ny + y) * nz + z] & 7;
  }

  /**
   * Gradiente analítico (mm/mm) de la trilineal del riñón cuya caja contiene p (derecho si x < 10 mm): lineal en cada eje
   * dentro de la celda, su derivada es exactamente la diferencia de la trilineal en las dos caras de la celda que
   * contienen a p, entre 1,5 mm (los mismos ocho nodos; no un paso de diferencias finitas). null fuera de la caja.
   * Par GLSL: `s28PGrad`.
   * @twin s0028-gradiente-renal
   */
  function s0028KidneyGradient(p: Vec3): Vec3 | null {
    const f = FIELDS[p[0] < 10 ? 3 : 4],
      d = (q: Vec3) => sourceDistance(abdominalAtlas!, q, f, B.abdominal.textureDimensions);
    if (p.some((v, k) => !((v - f.originMm[k]) / 1.5 >= 0 && (v - f.originMm[k]) / 1.5 <= f.dimensions[k] - 1))) return null;
    return p.map((v, k) => {
      const lo: Vec3 = [...p],
        hi: Vec3 = [...p];
      lo[k] = f.originMm[k] + 1.5 * Math.min(f.dimensions[k] - 2, Math.floor((v - f.originMm[k]) / 1.5));
      hi[k] = lo[k] + 1.5;
      return (d(hi) - d(lo)) / 1.5;
    }) as Vec3;
  }

  /**
   * Normal de la cara renal para el eco: la media del contorno a 3 mm (cuatro lecturas en los vértices de un tetraedro), que no
   * sigue el escalón del vóxel, mezclada de forma continua con el gradiente local: manda este donde la media se anula o se da la
   * vuelta (un borde fino del hilio) y junto al borde de la caja.
   * Par GLSL: `renalAtlasFaceGradient`.
   * @twin s0028-gradiente-renal
   */
  function s0028KidneyFaceGradient(p: Vec3): Vec3 | null {
    const local = s0028KidneyGradient(p);
    if (!local) return null;
    const f = FIELDS[p[0] < 10 ? 3 : 4];
    // Las cuatro lecturas caen dentro de la caja sólo a más de 3 mm de su borde: la media entra de 3 a 4,5 mm.
    const edge = Math.min(...p.map((v, k) => Math.min(v - f.originMm[k], f.originMm[k] + 1.5 * (f.dimensions[k] - 1) - v))),
      wb = smoothstep(3, 4.5, edge);
    if (wb <= 0) return local;
    const mean: Vec3 = [0, 0, 0];
    for (const k of [
      [3, -3, -3],
      [-3, -3, 3],
      [-3, 3, -3],
      [3, 3, 3],
    ]) {
      const d = sourceDistance(abdominalAtlas!, [p[0] + k[0], p[1] + k[1], p[2] + k[2]], f, B.abdominal.textureDimensions);
      for (let i = 0; i < 3; i++) mean[i] += (k[i] * d) / 36;
    }
    const lm = Math.hypot(...mean),
      ll = Math.hypot(...local),
      // Acuerdo entre la media y el local: su coseno; con el local degenerado (un nodo extremo de la trilineal) vale 1.
      agree =
        (mean[0] * local[0] + mean[1] * local[1] + mean[2] * local[2]) / Math.max(lm * Math.max(ll, 0.25), 1e-6) +
        1 -
        Math.min(1, ll / 0.25),
      w = wb * smoothstep(0.3, 0.7, lm) * smoothstep(0, 0.5, agree);
    return local.map((v, i) => v + (mean[i] - v) * w) as Vec3;
  }

  /**
   * Grasa compatible D del vóxel nearest (HU [−190, −30], ≤30 mm del riñón, sin máscara); null fuera de ambas cajas.
   * @twin s0028-duenos
   */
  function s0028CompatibleFat(p: Vec3): boolean | null {
    if (!fat) throw new Error('Paquete P3 s0028 no cargado');
    let covered = false;
    for (const b of B.solids.boxes) {
      const [nx, ny, nz] = b.dimensions,
        x = (p[0] - b.originMm[0]) / 1.5,
        y = (p[1] - b.originMm[1]) / 1.5,
        z = (p[2] - b.originMm[2]) / 1.5;
      if (!(x >= 0 && y >= 0 && z >= 0 && x <= nx - 1 && y <= ny - 1 && z <= nz - 1)) continue;
      covered = true;
      const bit = (Math.round(x) * ny + Math.round(y)) * nz + Math.round(z);
      if ((HALF[fat[b.byteOffset + (bit >> 3)]] >> (bit & 7)) & 1) return true;
    }
    return covered ? false : null;
  }

  /**
   * Grasa compatible D del abdomen en celdas de 3 mm (mayoría de sus 8 vóxeles de 1,5 mm con HU [−190, −30] y sin máscara
   * fuente): la celda que contiene p. Fuera de su caja, o sin la reserva cargada, no hay grasa. Par GLSL: `s28PWide`.
   * @twin s0028-grasa-amplia
   */
  function s0028WideFat(p: Vec3): boolean {
    if (!wideFat) return false;
    const F = B.wideFat,
      [nx, ny, nz] = F.dimensions,
      x = Math.floor((p[0] - F.originMm[0]) / 3),
      y = Math.floor((p[1] - F.originMm[1]) / 3),
      z = Math.floor((p[2] - F.originMm[2]) / 3);
    if (!(x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz)) return false;
    const bit = (x * ny + y) * nz + z;
    return ((HALF[wideFat[bit >> 3]] >> (bit & 7)) & 1) === 1;
  }

  /**
   * Zonas rígidas por dueño en la compresión (r3), a lo largo de la línea E + dir·t del tronco rígido (en apnea, material =
   * rígido): la entrada de cada hueso o cartílago (hasta ocho) y los tramos renales [entrada, salida] (el quiste y el seno
   * no son máscara renal: quedan entre dos tramos). Pasos de 0,75 mm afinados por bisección.
   */
  function s0028RigidSpan(E: Vec3, dir: Vec3, tMax: number): [number[], number[]] {
    const inside = (t: number, kidney: boolean): boolean =>
      (kidney ? [3, 4] : [9, 10, 11, 12]).some((i) => {
        const f = FIELDS[i];
        const p: Vec3 = [E[0] + dir[0] * t, E[1] + dir[1] * t, E[2] + dir[2] * t];
        return sourceDistance(f.asset === 'abdominal' ? abdominalAtlas! : thoracicAtlas!, p, f, B[f.asset].textureDimensions) < 0;
      });
    const edge = (a: number, kidney: boolean): number => {
      if (a < -2) return a + 0.75;
      let b = a + 0.75;
      const start = inside(a, kidney);
      for (let i = 0; i < 7; i++) {
        const m = (a + b) / 2;
        if (inside(m, kidney) === start) a = m;
        else b = m;
      }
      return (a + b) / 2;
    };
    const bones: number[] = [],
      renal: number[] = [];
    let bone = false;
    for (let t = -2; t <= tMax; t += 0.75) {
      const b = inside(t, false);
      if (b && !bone && bones.length < 8) bones.push(edge(t - 0.75, false));
      if (inside(t, true) !== renal.length % 2 > 0) renal.push(edge(t - 0.75, true));
      bone = b;
    }
    if (renal.length % 2) renal.push(tMax);
    return [bones, renal];
  }

  /**
   * Dueños independientes de un punto MATERIAL s0028: cada campo P1 con SDF lineal < 0 (identidad por etiqueta nearest),
   * la banda P2 conocida (1,5 ≤ profundidad < interfaz) y la grasa compatible D, que por definición sólo existe donde ninguna
   * máscara fuente reclama el punto. El hueso dentro de la pared es contenido del complejo P2, no un choque. Sin precedencia:
   * dos o más dueños son conflicto y se conservan todos.
   * @twin s0028-duenos
   */
  function s0028Owners(p: Vec3, q: S0028WallSample | undefined): S0028Ownership {
    if (!abdominalAtlas || !thoracicAtlas) throw new Error('Clasificador P3 sin s0028');
    const owners: S0028Owner[] = [];
    let kidneyMm = 16;
    for (let i = 0; i < TABLE.length; i++) {
      const f = FIELDS[i],
        data = f.asset === 'abdominal' ? abdominalAtlas : thoracicAtlas,
        dims = B[f.asset].textureDimensions,
        d = sourceDistance(data, p, f, dims);
      if (i === 3 || i === 4) kidneyMm = Math.min(kidneyMm, d);
      if (!(d < 0)) continue;
      const [, id, certainty] = TABLE[i];
      let owner = id as S0028OwnerId;
      if (typeof id !== 'string') {
        const label = sourceLabel(data, p, f, dims) % 128;
        if (!(label >= 1 && label <= id.length)) throw new Error('Etiqueta P3 fuera del contrato: ' + f.name);
        owner = id[label - 1];
      }
      // Vértebras, sacro, caderas y costillas son un mismo material O; el primero conserva su etiqueta P1.
      if (owner !== 'bone' || !owners.some((o) => o.id === 'bone')) owners.push({ id: owner, d, certainty });
    }
    const skeleton = owners.some((o) => o.id === 'bone' || o.id === 'cartilage');
    if (q?.kind === 'known' && q.depthMm >= 1.5 && q.depthMm < q.interfaceMm && !skeleton)
      owners.push({ id: 'wall', d: -Math.min(q.depthMm - 1.5, q.interfaceMm - q.depthMm), certainty: q.depthMm < q.outerMm ? 'D' : 'U' });
    if (!owners.some((o) => o.id !== 'wall') && s0028CompatibleFat(p) && !insideVessel(p))
      owners.push({ id: 'compatible_fat', d: 0, certainty: 'D' });
    // Fuera de las cajas renales la grasa P3 no está evaluada: ahí vale la del abdomen a 3 mm, sólo donde no hay ningún
    // dueño (tampoco la pared, que ya tiene su panículo) ni vaso fuente.
    if (!owners.length && s0028CompatibleFat(p) === null && s0028WideFat(p) && !insideVessel(p))
      owners.push({ id: 'compatible_fat', d: 0, certainty: 'D' });
    return { state: owners.length > 1 ? 'conflict' : owners.length ? 'known' : 'U', owners, kidneyMm };
  }

  if (assets.buffers.capacity) setS0028Solids(assets.buffers.capacity);
  return Object.freeze({
    s0028SolidsUploads,
    s0028KidneyGradient,
    s0028KidneyFaceGradient,
    s0028CompatibleFat,
    s0028WideFat,
    s0028RenalInterior,
    s0028RigidSpan,
    s0028Owners,
  });
}
