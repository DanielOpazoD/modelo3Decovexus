import { beforeAll, expect, it } from 'vitest';
import { loadS0028 } from '../../tools/anatomy/s0028Windows';
import { heartChambers } from '../anatomy/organs/heart';
import { S0028_HEART } from '../anatomy/people/s0028/cpu';
import { Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import { BASELINE_CALIBER } from './support/legacyPerson/scene';

let person: ReturnType<typeof loadS0028>;
beforeAll(() => {
  person = loadS0028();
}, 60000);

it('s0028: su máscara cardíaca es sangre en cuatro cavidades y miocardio, sin «mediastino» ni pulmón dentro (decisión 356)', () => {
  const { scene } = person,
    heart = (p: Vec3) => scene.person.cpu.regional!.s0028SourceValue(p, 'heart').d;
  const count = { blood: 0, muscle: 0, other: 0 },
    chambers = [0, 0, 0, 0];
  for (let z = -16; z <= 104; z += 4)
    for (let y = -32; y <= 73; y += 4)
      for (let x = -47; x <= 84; x += 4) {
        const p: Vec3 = [x + 0.3, y + 0.2, z + 0.1];
        // Lejos del borde de la máscara y fuera del pulmón, que gana antes.
        if (heart(p) > -3 || scene.person.cpu.regional!.s0028SourceValue(p, 'lung').d < 0) continue;
        const c = scene.classify(p, BASELINE_CALIBER);
        if (c.vessel) continue;
        if (c.tissue === Tissue.Blood) {
          count.blood++;
          const d = heartChambers(p, scene.person.cpu);
          chambers[d.indexOf(Math.min(...d))]++;
        } else if (c.tissue === Tissue.Myocardium) count.muscle++;
        else count.other++;
      }
  expect(count.other).toBe(0);
  // Las cuatro cavidades están dentro de su máscara: VI, VD, AD y AI con sangre.
  for (const n of chambers) expect(n).toBeGreaterThan(100);
  // En su TAC la sangre realzada ocupa el 68 % de la máscara: el esquema encajado no debe quedarse en paredes gruesas ni en una
  // sola bolsa de sangre.
  const fraction = count.blood / (count.blood + count.muscle);
  expect(fraction).toBeGreaterThan(0.45);
  expect(fraction).toBeLessThan(0.8);
});

it('s0028: la cava llega a la aurícula derecha sin tapón: su eje es sangre hasta el final y acaba dentro de la cavidad', () => {
  const { scene } = person;
  for (const id of ['ivcInfra', 'ivcSupra'] as const) {
    const nodes = scene.vesselById.get(id)!.tube.nodes;
    for (let i = 0; i + 1 < nodes.length; i++)
      for (let k = 0; k <= 4; k++) {
        const p = nodes[i].p.map((v, j) => v + ((nodes[i + 1].p[j] - v) * k) / 4) as Vec3;
        if (p[2] < -40) continue;
        expect(scene.classify(p, BASELINE_CALIBER).tissue, `${id} ${p.map((v) => v.toFixed(0)).join(',')}`).toBe(Tissue.Blood);
      }
  }
  const end = scene.vesselById.get('ivcSupra')!.tube.nodes.at(-1)!.p;
  // El extremo del tubo está dentro de la cavidad de la AD (índice 2), y sobre él sigue habiendo sangre de la aurícula.
  expect(heartChambers(end, scene.person.cpu)[2]).toBeLessThan(0);
  expect(scene.classify([end[0] - 6, end[1] + 8, end[2] + 18], BASELINE_CALIBER)).toMatchObject({ tissue: Tissue.Blood, vessel: null });
  // La forma es la de esta persona, no la del esquema.
  expect(scene.person.cpu.heart).toBe(S0028_HEART);
});
