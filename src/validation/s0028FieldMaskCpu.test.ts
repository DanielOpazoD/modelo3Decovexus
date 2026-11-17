import { beforeAll, expect, it } from 'vitest';
import { GALLBLADDER_WALL_MM, gallbladderPearSdf } from '../anatomy/organs/gallbladder';
import { s0028FieldsNear, type S0028FieldsNear } from '../anatomy/people/s0028/fieldMask';
import { S0028_MASK_FIELDS } from '../anatomy/people/s0028/fieldMaskFields';
import { S0028_GALLBLADDER } from '../anatomy/people/s0028/gallbladder';
import { S0028_EVERY_FIELD_NEAR, type S0028Ownership } from '../anatomy/people/s0028/solids';
import { torsoDepth } from '../anatomy/primitives';
import { S0028_FIELD_MASK as M } from '../anatomy/s0028FieldMaskData';
import { sourceDistance } from '../anatomy/sourceVolume';
import { startPointsFor } from '../app/startPoints';
import type { Vec3 } from '../core/vec3';
import { probeContact } from '../probe/contact';
import { CONVEX_C35 } from '../probe/probe';
import { abdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { S0028_BUNDLE as B } from './support/legacyPerson/anatomyBundle';
import { loadS0028Fixture } from './support/legacyPerson/loadS0028Fixture';
import { s0028Owners, s0028RigidSpan } from './support/legacyPerson/s0028Solids';
import { s0028WallAt } from './support/legacyPerson/s0028Wall';
import type { AnatomyScene } from './support/legacyPerson/scene';
import { fixturePerson } from './support/legacyPerson/state';
import { thoracicAtlas } from './support/legacyPerson/thoracicAtlas';

/**
 * La CPU de s0028 usa el mapa de ocupación (decisión 417): no lee un campo cuyo bit está apagado en la celda del punto y toma 16.
 * Aquí, que eso da EXACTAMENTE lo mismo que leerlos todos (`S0028_EVERY_FIELD_NEAR`, la ruta de antes): los mismos dueños en el
 * mismo orden, las mismas distancias bit a bit y el mismo `kidneyMm`, que usa la distancia positiva al riñón hasta 16 mm; y los
 * mismos tramos rígidos de `s0028RigidSpan` en todo el sector de cada ventana. Con un mapa mal leído (una celda corrida, o sin el
 * bit de un campo) la misma comparación falla: tiene dientes.
 */
let scene: AnatomyScene, near: S0028FieldsNear;
beforeAll(() => {
  ({ scene } = loadS0028Fixture());
  near = s0028FieldsNear(fixturePerson().cpu.regional!.s0028FieldMask);
}, 60_000);

/** mulberry32 con semilla fija. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** El tronco entero: la rejilla del mapa (cubre las cajas de los 19 campos) y 30 mm más a cada lado, donde ya no hay campos. */
const LO = M.originMm.map((v) => v - 30),
  HI = M.originMm.map((v, k) => v + M.dimensions[k] * M.cellMm + 30);
const bit = (name: string) => 1 << (S0028_MASK_FIELDS as readonly string[]).indexOf(name);

/** Igualdad exacta de dos resultados: `Object.is` distingue −0 de 0 y acepta NaN = NaN. */
const same = (a: S0028Ownership, b: S0028Ownership): boolean =>
  a.state === b.state &&
  Object.is(a.kidneyMm, b.kidneyMm) &&
  a.owners.length === b.owners.length &&
  a.owners.every((o, i) => o.id === b.owners[i].id && Object.is(o.d, b.owners[i].d) && o.certainty === b.owners[i].certainty);

/** Rejilla y aleatorios por todo el tronco. */
function trunkPoints(): Vec3[] {
  const out: Vec3[] = [];
  // paso irracional respecto de la celda de 6 mm y del vóxel de 1,5 mm: la rejilla no cae siempre en el mismo sitio de la celda
  const step = 8.3;
  for (let z = LO[2]; z <= HI[2]; z += step)
    for (let y = LO[1]; y <= HI[1]; y += step) for (let x = LO[0]; x <= HI[0]; x += step) out.push([x, y, z]);
  const rnd = random(415);
  for (let i = 0; i < 80_000; i++) out.push([0, 1, 2].map((k) => LO[k] + rnd() * (HI[k] - LO[k])) as Vec3);
  return out;
}

/** Puntos a menos de 3 mm de la frontera de cada campo (y de la pera vesicular): donde el valor leído decide. */
function borderPoints(): { points: Vec3[]; perField: Record<string, number> } {
  const points: Vec3[] = [],
    perField: Record<string, number> = {};
  const rnd = random(2026);
  const collect = (name: string, lo: readonly number[], hi: readonly number[], d: (p: Vec3) => number) => {
    let kept = 0;
    for (let tries = 0; tries < 600_000 && kept < 6000; tries++) {
      const p = [0, 1, 2].map((k) => lo[k] + rnd() * (hi[k] - lo[k])) as Vec3;
      if (!(Math.abs(d(p)) < 3)) continue;
      points.push(p);
      kept++;
    }
    perField[name] = kept;
  };
  for (const name of S0028_MASK_FIELDS) {
    const f = B.fields.find((x) => x.name === name)!,
      data = f.asset === 'abdominal' ? abdominalAtlas! : thoracicAtlas!,
      dims = B[f.asset].textureDimensions;
    collect(
      name,
      f.originMm,
      f.originMm.map((v, k) => v + (f.dimensions[k] - 1) * f.pitchMm),
      (p) => sourceDistance(data, p, f, dims),
    );
  }
  const g = S0028_GALLBLADDER.nodes.map((n) => n.p);
  collect(
    'pera vesicular',
    [0, 1, 2].map((k) => Math.min(...g.map((p) => p[k])) - 20),
    [0, 1, 2].map((k) => Math.max(...g.map((p) => p[k])) + 20),
    (p) => gallbladderPearSdf(p, S0028_GALLBLADDER) - GALLBLADDER_WALL_MM,
  );
  return { points, perField };
}

/** Puntos a 0,1 µm de las caras de las celdas del mapa y del borde de su rejilla: donde la celda leída cambia. */
function cellFacePoints(): Vec3[] {
  const out: Vec3[] = [];
  const rnd = random(400);
  for (let i = 0; i < 40_000; i++)
    out.push(
      [0, 1, 2].map((k) => {
        // uno de cada ocho, en el borde de la rejilla (celda −1, 0, n − 1 o n)
        const c = i % 8 ? Math.floor(rnd() * (M.dimensions[k] + 1)) : rnd() < 0.5 ? 0 : M.dimensions[k];
        return M.originMm[k] + c * M.cellMm + (rnd() < 0.5 ? -1e-4 : 1e-4);
      }) as Vec3,
    );
  return out;
}

it('s0028Owners da el mismo objeto con el mapa y leyendo todos los campos: tronco entero, fronteras de campo y caras de celda', () => {
  const trunk = trunkPoints(),
    border = borderPoints(),
    faces = cellFacePoints(),
    points = [...trunk, ...border.points, ...faces];
  // el muestreo tiene dientes: cada campo aporta su frontera
  expect(Object.keys(border.perField)).toHaveLength(S0028_MASK_FIELDS.length + 1);
  for (const [name, n] of Object.entries(border.perField)) expect(n, `frontera de ${name}`).toBe(6000);
  expect(points.length).toBeGreaterThanOrEqual(300_000);
  const bad: string[] = [];
  const seen = { owned: 0, conflict: 0, fat: 0, wall: 0, kidneyOutside: 0, read: 0, inside: 0 };
  const owners = new Set<string>();
  for (const p of points) {
    const q = s0028WallAt(p),
      a = s0028Owners(p, q),
      b = s0028Owners(p, q, S0028_EVERY_FIELD_NEAR);
    if (!same(a, b)) bad.push(`${p.map((v) => v.toFixed(4)).join(',')}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
    for (const o of b.owners) owners.add(o.id);
    seen.owned += b.owners.length ? 1 : 0;
    seen.conflict += b.state === 'conflict' ? 1 : 0;
    seen.fat += b.owners.some((o) => o.id === 'compatible_fat') ? 1 : 0;
    seen.wall += b.owners.some((o) => o.id === 'wall') ? 1 : 0;
    seen.kidneyOutside += b.kidneyMm > 0 && b.kidneyMm < 16 ? 1 : 0;
    // campos de dueños (bits 0–18 salvo los tres vasos) que el mapa deja leer en los puntos bajo la piel del tronco
    if (p[2] >= scene.torso.zMin && p[2] <= scene.torso.zMax && torsoDepth(p, scene.torso) < -1.5) {
      seen.inside++;
      for (
        let bits = near(p[0], p[1], p[2]) & ~(bit('aorta') | bit('inferior_vena_cava') | bit('portal_vein_and_splenic_vein'));
        bits;
        bits >>>= 1
      )
        seen.read += bits & 1;
    }
  }
  expect(bad.slice(0, 5)).toEqual([]);
  // La comparación ve de todo: los 20 dueños del vocabulario (la vesícula, por su pera), conflictos, grasa, pared y el contorno renal
  // positivo, que es donde un mapa que solo guardara el signo fallaría.
  expect([...owners].sort()).toEqual(
    [
      ...['autochthon_left', 'autochthon_right', 'bladder', 'bone', 'bowel', 'cartilage', 'compatible_fat', 'gallbladder', 'heart'],
      ...['iliopsoas_left', 'iliopsoas_right', 'kidney_cyst_left', 'kidney_left', 'kidney_right', 'liver', 'lung', 'pancreas'],
      ...['spleen', 'stomach', 'wall'],
    ].sort(),
  );
  expect(seen.owned).toBeGreaterThan(100_000);
  expect(seen.conflict).toBeGreaterThan(30);
  expect(seen.fat).toBeGreaterThan(5000);
  expect(seen.wall).toBeGreaterThan(5000);
  expect(seen.kidneyOutside).toBeGreaterThan(10_000);
  // Y el mapa ahorra: de los 15 campos que `s0028Owners` leía en cada punto bajo la piel quedan de media 2,3 (17-11-2026), con más de
  // la mitad de estos puntos pegados a una frontera.
  expect(seen.inside).toBeGreaterThan(150_000);
  expect(seen.read / seen.inside).toBeLessThan(3);
});

it('todo campo fuente del descriptor tiene su bit en el mapa: ninguno queda sin leer por no tenerlo', () => {
  expect(B.fields.map((f) => f.name).sort()).toEqual([...S0028_MASK_FIELDS].sort());
});

it('con dientes: una celda corrida o un bit de menos cambian el resultado en la frontera', () => {
  const { points } = borderPoints();
  const differ = (other: S0028FieldsNear) =>
    points.filter((p) => !same(s0028Owners(p, undefined, other), s0028Owners(p, undefined))).length;
  // Medido el 17-11-2026 en estos 120 000 puntos: 194, 7578 y 13 181.
  // la celda vecina en x en vez de la propia (pocas veces apaga un bit que hacía falta: los órganos ocupan varias celdas)
  expect(differ((x, y, z) => near(x + M.cellMm, y, z))).toBeGreaterThan(100);
  // sin el bit del hígado se pierde su dueño
  expect(differ((x, y, z) => near(x, y, z) & ~bit('liver'))).toBeGreaterThan(5000);
  // sin el de los riñones se pierde también el contorno renal positivo: `kidneyMm` usa la distancia aunque no sea interior
  const noKidneys: S0028FieldsNear = (x, y, z) => near(x, y, z) & ~(bit('kidneyRight') | bit('kidneyLeft'));
  const lost = points.filter((p) => {
    const mm = s0028Owners(p, undefined).kidneyMm;
    return mm > 0 && mm < 16 && s0028Owners(p, undefined, noKidneys).kidneyMm === 16;
  });
  expect(lost.length).toBeGreaterThan(5000);
});

it('un punto no finito no tiene celda: se leen todos los campos y el resultado es el de siempre', () => {
  for (const p of [
    [NaN, 0, -100],
    [0, NaN, -100],
    [0, 0, NaN],
    [NaN, NaN, NaN],
    [Infinity, 0, -100],
    [0, -Infinity, -100],
    [NaN, 1e6, -100],
  ] as Vec3[]) {
    const a = s0028Owners(p, undefined),
      b = s0028Owners(p, undefined, S0028_EVERY_FIELD_NEAR);
    expect(same(a, b), `${p.join(',')}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`).toBe(true);
  }
  // sin índice de celda se leen todos los campos; con otra coordenada fuera de la rejilla el campo ya valía 16
  expect(near(NaN, 0, -100)).toBe(-1);
  expect(near(NaN, 1e6, -100)).toBe(-1);
  expect(near(Infinity, 0, -100)).toBe(-1);
});

it('s0028RigidSpan da los mismos tramos con el mapa y leyendo todos los campos, en todo el sector de cada ventana', () => {
  const tr = CONVEX_C35,
    poses = startPointsFor(scene.torso, B);
  expect(poses.length).toBeGreaterThanOrEqual(10);
  const bad: string[] = [];
  let lines = 0,
    bones = 0,
    renal = 0,
    renalLost = 0;
  const noKidneys: S0028FieldsNear = (x, y, z) => near(x, y, z) & ~(bit('kidneyRight') | bit('kidneyLeft'));
  for (const pose of poses) {
    const f = probeContact({ ...pose, rock: pose.rock ?? 0, tilt: pose.tilt ?? 0, lift: 0 }, tr, scene.torso).frame;
    for (let a = -1; a <= 1.0001; a += 1 / 32) {
      const th = a * tr.halfSector,
        dir = f.axial.map((v, j) => v * Math.cos(th) + f.lateral[j] * Math.sin(th)) as Vec3,
        E = f.curvatureCenter.map((c, j) => c + dir[j] * tr.curvatureRadius) as Vec3;
      // 320 mm: más que el alcance que pide el contacto (pared + tramo de compresión + 120 mm) en cualquier ventana
      const masked = s0028RigidSpan(E, dir, 320),
        every = s0028RigidSpan(E, dir, 320, S0028_EVERY_FIELD_NEAR);
      lines++;
      bones += every[0].length;
      renal += every[1].length / 2;
      if (every[1].length && !s0028RigidSpan(E, dir, 320, noKidneys)[1].length) renalLost++;
      const equal = [0, 1].every((k) => masked[k].length === every[k].length && masked[k].every((v, i) => Object.is(v, every[k][i])));
      if (!equal) bad.push(`${pose.id} a=${a}: ${JSON.stringify(masked)} ≠ ${JSON.stringify(every)}`);
    }
  }
  expect(bad.slice(0, 5)).toEqual([]);
  // las líneas cruzan huesos y riñones, y sin el bit renal sus tramos desaparecen: la comparación tiene dientes (17-11-2026: 706
  // entradas óseas, 253 tramos renales y 178 líneas que los pierden)
  expect(lines).toBe(65 * poses.length);
  expect(bones).toBeGreaterThan(500);
  expect(renal).toBeGreaterThan(100);
  expect(renalLost).toBeGreaterThan(100);
});
