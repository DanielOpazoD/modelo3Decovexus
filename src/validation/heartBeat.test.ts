import { beforeAll, expect, it } from 'vitest';
import { loadS0028 } from '../../tools/anatomy/s0028Windows';
import { HEART_AT_REST, HEART_ATLAS_SHIFT, heartBeatOf, heartChambers } from '../anatomy/organs/heart';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { PhysiologyEngine } from '../physiology/engine';
import { emptyingAt, ventricularEmptying } from '../physiology/ventricles';
import { BASELINE_CALIBER } from './support/legacyPerson/scene';

let person: ReturnType<typeof loadS0028>;
beforeAll(() => {
  person = loadS0028();
}, 60000);

it('el vaciado ventricular sigue el ciclo: lleno en la R, vacío al final de la eyección y lleno otra vez en la R siguiente', () => {
  for (const rr of [0.5, 0.857, 1.2]) {
    expect(emptyingAt(0, rr, 1)).toBe(0);
    expect(emptyingAt(Math.min(0.36, 0.05 + 0.3 * rr + 0.02), rr, 1)).toBe(1);
    expect(emptyingAt(rr, rr, 1)).toBeLessThan(0.01);
    // continuo: a 120 lpm la eyección dura 150 ms y avanza a lo sumo 0,105 en 10 ms; sin saltos de más de 0,15
    let last = 0;
    for (let tau = 0; tau <= rr; tau += 0.01) {
      const e = emptyingAt(tau, rr, 1);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
      expect(Math.abs(e - last), `rr ${rr} τ ${tau.toFixed(2)}`).toBeLessThan(0.15);
      last = e;
    }
  }
  // Sin onda a organizada (FA) no hay contracción auricular: a 80 ms de la R siguiente el ventrículo ya está lleno.
  expect(emptyingAt(0.857 - 0.08, 0.857, 1)).toBeGreaterThan(0.05);
  expect(emptyingAt(0.857 - 0.08, 0.857, 0)).toBeLessThan(0.02);
  // El VD se vacía según su función sistólica: con la de un VD que falla (0,3), un tercio del sano.
  const healthy = ventricularEmptying(0.3, 0.857, { rvFunction: 0.85, atrialFunction: 1 }),
    failing = ventricularEmptying(0.3, 0.857, { rvFunction: 0.3, atrialFunction: 1 });
  expect(failing.lv).toBe(healthy.lv);
  expect(failing.rv / healthy.rv).toBeCloseTo(0.3 / 0.85, 5);
});

it('la muestra fisiológica lleva el vaciado y el calibre de la anatomía, su latido (decisión 410)', () => {
  const engine = new PhysiologyEngine(NORMAL_ADULT, person.scene.vesselAreas());
  const seen = new Set<string>();
  for (let i = 0; i < Math.round(1 / engine.clock.dt); i++) {
    engine.step();
    const s = engine.sample;
    expect(s.ventricles).toBeDefined();
    seen.add(s.ventricles!.lv > 0.9 ? 'vacío' : s.ventricles!.lv < 0.05 ? 'lleno' : 'medio');
  }
  expect([...seen].sort()).toEqual(['lleno', 'medio', 'vacío']);
  expect(heartBeatOf(undefined)).toBe(HEART_AT_REST);
  // En la telediástole los ventrículos están llenos y la AD, recién contraída, en su menor tamaño; en la telesístole, al revés.
  expect(heartBeatOf({ lv: 0, rv: 0 })).toEqual([1, 1, 1, 1, 0.85]);
  expect(heartBeatOf({ lv: 1, rv: 1 })[4]).toBe(1);
  // Telesístole del sano: diámetro corto del VI 0,67 del telediastólico (fracción de acortamiento 33 %).
  const [lvLong, lvShort] = heartBeatOf({ lv: 1, rv: 1 });
  expect(lvShort).toBeCloseTo(0.67, 5);
  expect(lvLong * lvShort * lvShort).toBeLessThan(0.45);
});

it('s0028: la cava entra en la aurícula sin tapón en todo el latido; la AD baja su techo hacia el suelo', () => {
  const { scene } = person,
    end = scene.vesselById.get('ivcSupra')!.tube.nodes.at(-1)!.p;
  for (let lv = 0; lv <= 1; lv += 0.25) {
    const beat = heartBeatOf({ lv, rv: lv }),
      caliber = { ...BASELINE_CALIBER, heartBeat: beat };
    // el extremo de la cava sigue dentro de la cavidad de la AD que late, y encima hay sangre, no una pared
    expect(heartChambers(end, scene.person.cpu, beat)[2], `vaciado ${lv}`).toBeLessThan(0);
    expect(scene.classify([end[0] - 4, end[1] + 5.3, end[2] + 12], caliber).tissue, `vaciado ${lv}`).toBe(Tissue.Blood);
  }
  // Tras la contracción auricular la AD es más baja: un punto de su techo deja de ser sangre.
  const roof = scene.person.cpu.heart!.cavities.ra.c.map((v, j) => v + HEART_ATLAS_SHIFT[j] + [0, 0, 22][j]) as Vec3;
  expect(heartChambers(roof, scene.person.cpu)[2]).toBeLessThan(0);
  expect(heartChambers(roof, scene.person.cpu, heartBeatOf({ lv: 0, rv: 0 }))[2]).toBeGreaterThan(0);
});

it('s0028 en sístole: la cavidad del VI se encoge y su pared se engruesa; el contorno del corazón no se mueve', () => {
  const { scene } = person,
    heart = (p: Vec3) => scene.person.cpu.regional!.s0028SourceValue(p, 'heart').d;
  const systole = { ...BASELINE_CALIBER, heartBeat: heartBeatOf({ lv: 1, rv: 1 }) };
  let lvBlood = 0,
    lvBloodSystole = 0,
    rvBlood = 0,
    rvBloodSystole = 0,
    outline = 0;
  for (let z = -16; z <= 104; z += 3)
    for (let y = -32; y <= 73; y += 3)
      for (let x = -47; x <= 84; x += 3) {
        const p: Vec3 = [x + 0.3, y + 0.2, z + 0.1];
        if (scene.person.cpu.regional!.s0028SourceValue(p, 'lung').d < 0) continue;
        const rest = scene.classify(p, BASELINE_CALIBER),
          beat = scene.classify(p, systole);
        if (rest.vessel || beat.vessel) continue;
        // fuera de la máscara del corazón nada cambia con el latido
        if (heart(p) > 0) {
          if (rest.tissue !== beat.tissue) outline++;
          continue;
        }
        const d = heartChambers(p, scene.person.cpu),
          chamber = d.indexOf(Math.min(...d));
        if (chamber === 0 && rest.tissue === Tissue.Blood) lvBlood++;
        if (chamber === 0 && beat.tissue === Tissue.Blood) lvBloodSystole++;
        if (chamber === 1 && rest.tissue === Tissue.Blood) rvBlood++;
        if (chamber === 1 && beat.tissue === Tissue.Blood) rvBloodSystole++;
        // lo que en sístole es sangre ya lo era en diástole: las cavidades solo se encogen
        if (beat.tissue === Tissue.Blood) expect(rest.tissue, p.join(',')).toBe(Tissue.Blood);
        else if (rest.tissue === Tissue.Blood) expect(beat.tissue, p.join(',')).toBe(Tissue.Myocardium);
      }
  expect(outline).toBe(0);
  // El VI expulsa más de la mitad de su sangre (fracción de eyección del esquema ≈ 60 %); el VD, algo menos.
  expect(lvBloodSystole / lvBlood).toBeLessThan(0.5);
  expect(lvBloodSystole / lvBlood).toBeGreaterThan(0.25);
  expect(rvBloodSystole / rvBlood).toBeLessThan(0.8);
  expect(rvBloodSystole / rvBlood).toBeGreaterThan(lvBloodSystole / lvBlood);
});
