import { beforeAll, expect, it } from 'vitest';
import { GALLBLADDER_WALL_MM, gallbladderPearSdf } from '../anatomy/organs/gallbladder';
import { S0028_GALLBLADDER } from '../anatomy/people/s0028/gallbladder';
import { Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import { loadS0028Fixture } from './support/legacyPerson/loadS0028Fixture';
import { s0028SourceValue } from './support/legacyPerson/s0028Source';
import { type AnatomyScene, BASELINE_CALIBER } from './support/legacyPerson/scene';

let scene: AnatomyScene;
beforeAll(() => {
  ({ scene } = loadS0028Fixture());
}, 60_000);

/** Puntos de una rejilla de `step` mm sobre la caja de la pera, con su distancia a la luz (oráculo: la pera de los datos). */
function grid(step: number, margin: number): { p: Vec3; d: number }[] {
  const n = S0028_GALLBLADDER.nodes,
    lo = [0, 1, 2].map((k) => Math.min(...n.map((q) => q.p[k] - q.r)) - margin),
    hi = [0, 1, 2].map((k) => Math.max(...n.map((q) => q.p[k] + q.r)) + margin),
    out: { p: Vec3; d: number }[] = [];
  for (let x = lo[0]; x <= hi[0]; x += step)
    for (let y = lo[1]; y <= hi[1]; y += step)
      for (let z = lo[2]; z <= hi[2]; z += step) {
        const p: Vec3 = [x, y, z];
        out.push({ p, d: gallbladderPearSdf(p, S0028_GALLBLADDER) });
      }
  return out;
}

it('vesícula en ayunas de s0028: pera de ~21 ml que contiene la contraída del TAC, con el fondo delante, abajo y afuera (decisión 413)', () => {
  // Volumen de la luz y de la vesícula contraída del TAC (su máscara, 4,7 ml), a 1 mm.
  const cells = grid(1, 3);
  const lumen = cells.filter((c) => c.d < 0).length / 1000;
  const ct = cells.filter((c) => s0028SourceValue(c.p, 'gallbladder').d < 0);
  const inside = ct.filter((c) => c.d < 0).length / ct.length;
  // Medido el 16-11-2026: 21,1 ml de luz; la del TAC, 4,7 ml, queda dentro en un 94 %.
  expect(lumen).toBeGreaterThan(18);
  expect(lumen).toBeLessThan(25);
  expect(ct.length / 1000).toBeLessThan(6);
  expect(inside).toBeGreaterThan(0.9);
  // Largo de fondo a cuello: ≥ 55 mm (unos 6 cm); el fondo va delante (y), abajo (z) y a la derecha del paciente (x) del cuello.
  const [fundus, , , , neck] = S0028_GALLBLADDER.nodes;
  expect(Math.hypot(...fundus.p.map((v, k) => v - neck.p[k])) + fundus.r + neck.r).toBeGreaterThan(55);
  expect(fundus.p[1]).toBeGreaterThan(neck.p[1] + 10);
  expect(fundus.p[2]).toBeLessThan(neck.p[2] - 10);
  expect(fundus.p[0]).toBeLessThan(neck.p[0] - 10);
});

it('dentro de la vesícula en ayunas no hay conflicto: ceden hígado e intestino, y ningún vaso la cruza (decisión 413)', () => {
  const regional = scene.person.cpu.regional!;
  let wall = 0,
    lumen = 0,
    yielded = 0;
  for (const { p, d } of grid(1.5, 2)) {
    if (d >= GALLBLADDER_WALL_MM + 1) continue;
    // Ningún vaso a menos de 1 mm de la cara externa de su pared (los conductos sí: el cístico entra por su cuello).
    const tube = scene.classifyTubes(p, BASELINE_CALIBER);
    expect(tube?.vessel ?? null, p.join(',')).toBeNull();
    if (d >= GALLBLADDER_WALL_MM) continue;
    const owners = regional.s0028Owners(p, regional.s0028WallAt(p));
    expect(
      owners.owners.map((o) => o.id),
      p.join(','),
    ).toEqual(['gallbladder']);
    // Lo que había antes en la máscara del TAC: el hígado y el intestino ceden (la fosa se adapta a la vesícula llena).
    if (s0028SourceValue(p, 'liver').d < 0 || s0028SourceValue(p, 'digestiveTract').d < 0) yielded++;
    if (tube) continue;
    const c = scene.classify(p, BASELINE_CALIBER);
    if (d < 0) {
      lumen++;
      expect(c.tissue, p.join(',')).toBe(Tissue.Fluid);
    } else {
      wall++;
      expect(c.tissue, p.join(',')).toBe(Tissue.BileDuctWall);
    }
  }
  // Medido el 16-11-2026 a 1,5 mm: 6.242 muestras de luz y 2.470 de pared; 5.616 eran hígado o intestino en sus máscaras.
  expect(lumen).toBeGreaterThan(5000);
  expect(wall).toBeGreaterThan(1500);
  expect(yielded).toBeGreaterThan(4000);
});

it('la normal de la vesícula en ayunas es el gradiente de su pera, no el del canal contraído del atlas (decisión 413)', () => {
  // La cara de la luz da su eco con la normal de `faceGradient`. La persona tiene atlas abdominal (el canal 7 es la vesícula
  // contraída del TAC): con la pera, la normal debe salir de la misma distancia que clasifica. Oráculo: diferencias centrales
  // de la pera de los datos.
  const numeric = (p: Vec3): Vec3 => {
    const h = 1e-4;
    return [0, 1, 2].map((k) => {
      const a: Vec3 = [...p],
        b: Vec3 = [...p];
      a[k] += h;
      b[k] -= h;
      return (gallbladderPearSdf(a, S0028_GALLBLADDER) - gallbladderPearSdf(b, S0028_GALLBLADDER)) / (2 * h);
    }) as Vec3;
  };
  let n = 0,
    worst = 0;
  for (const { p, d } of grid(2.3, 2)) {
    if (Math.abs(d) > GALLBLADDER_WALL_MM) continue;
    const face = scene.faceGradient(p, BASELINE_CALIBER, 'gallbladder');
    expect(face, p.join(',')).not.toBeNull();
    const ref = numeric(p),
      norm = Math.hypot(...ref);
    worst = Math.max(worst, Math.hypot(...face!.normal.map((v, k) => v - ref[k] / norm)));
    n++;
  }
  // Medido el 17-11-2026: 1.261 puntos a menos de una pared de la cara, error máximo 2·10⁻¹⁰.
  expect(n).toBeGreaterThan(800);
  expect(worst).toBeLessThan(1e-5);
});

it('el cístico entra en la vesícula en ayunas por su cuello y llega al colédoco (decisiones 384 y 413)', () => {
  const cystic = scene.ducts.find((d) => d.id === 'cysticDuct')!.tube.nodes,
    cbd = scene.ducts.find((d) => d.id === 'cbd')!.tube.nodes,
    neck = S0028_GALLBLADDER.nodes[S0028_GALLBLADDER.nodes.length - 1],
    fundus = S0028_GALLBLADDER.nodes[0];
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // Nace dentro de la luz, en la mitad del cuello (más cerca del cuello que del fondo), y su otro extremo está sobre el colédoco.
  expect(gallbladderPearSdf(cystic[0].p, S0028_GALLBLADDER)).toBeLessThanOrEqual(0);
  expect(dist(cystic[0].p, neck.p)).toBeLessThan(dist(cystic[0].p, fundus.p) / 2);
  const end = cystic[cystic.length - 1].p;
  let gap = Infinity;
  for (let i = 0; i + 1 < cbd.length; i++)
    for (let t = 0; t <= 1; t += 0.01)
      gap = Math.min(
        gap,
        dist(
          end,
          cbd[i].p.map((v, k) => v + (cbd[i + 1].p[k] - v) * t),
        ),
      );
  expect(gap).toBeLessThan(0.5);
  // Largo razonable para un cístico (20–40 mm en la realidad): medido 18,0 mm, a 6,1 mm del cuello y 42 del fondo.
  const length = dist(cystic[0].p, end);
  expect(length).toBeGreaterThan(12);
  expect(length).toBeLessThan(45);
});
