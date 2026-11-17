import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { GALLBLADDER_WALL_MM, gallbladderPearSdf } from '../anatomy/organs/gallbladder';
import { S0028_GALLBLADDER } from '../anatomy/people/s0028/gallbladder';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { S0028_BUNDLE as B, installAnatomyBundle } from './support/legacyPerson/anatomyBundle';
import { setAbdominalBody } from './support/legacyPerson/referenceBody';
import { setS0028Solids } from './support/legacyPerson/s0028Solids';
import { s0028SourceValue } from './support/legacyPerson/s0028Source';
import { setS0028Wall } from './support/legacyPerson/s0028Wall';
import { AnatomyScene, BASELINE_CALIBER } from './support/legacyPerson/scene';
import { setThoracicAtlas } from './support/legacyPerson/thoracicAtlas';

const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
let scene: AnatomyScene;
beforeAll(() => {
  installAnatomyBundle(B);
  setAbdominalAtlas(new Uint16Array(raw('abdominal-direct')));
  setThoracicAtlas(new Uint16Array(raw('thoracic-direct')));
  const capacity = raw('annotation-capacity');
  setS0028Wall(capacity, raw('skin-polar'));
  setS0028Solids(capacity);
  setAbdominalBody(new Float32Array(new Uint8Array(readFileSync('src/anatomy/abdominal-body.bin')).buffer));
  scene = new AnatomyScene(NORMAL_ADULT);
  // Cargar la persona tarda 2 s y unos 7 s bajo cobertura: el tope de 10 s por defecto se agota con un runner lento.
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
