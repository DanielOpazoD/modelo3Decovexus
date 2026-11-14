import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { personShader } from '../anatomy/gpu/personShader';
import { Interface, interfaceReflectivity } from '../anatomy/interfaces';
import { S0028_CAPSULE_FAT_TISSUES, S0028_LIVER_SEAM_MM, S0028_PREPERITONEAL_MM } from '../anatomy/people/s0028/solidsData';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { CAPSULE_OUTSIDE_MM, CAPSULE_PROJECTION_MAX_MM, capsuleExteriorGain, liverCapsuleSiteGain } from '../ultrasound/interfaceEcho';
import * as PASSES from '../ultrasound/shaders/passes.glsl';
import { setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { S0028_BUNDLE as B, installAnatomyBundle } from './support/legacyPerson/anatomyBundle';
import { setAbdominalBody } from './support/legacyPerson/referenceBody';
import { setS0028Solids } from './support/legacyPerson/s0028Solids';
import { s0028SourceValue } from './support/legacyPerson/s0028Source';
import { s0028InsideWall, setS0028Wall } from './support/legacyPerson/s0028Wall';
import { AnatomyScene, BASELINE_CALIBER } from './support/legacyPerson/scene';
import { setThoracicAtlas } from './support/legacyPerson/thoracicAtlas';

// Cápsula hepática de s0028 (decisión 378): la grasa perirrenal también sube su eco.
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
  // Descomprimir los dos atlas tarda 2–3 s; con la máquina cargada y otras pruebas a la vez pasa de los 10 s por defecto.
}, 60_000);

it('la lista de s0028 da a su grasa la ganancia de la mesentérica; sin lista, la tabla común no cambia', () => {
  const fat = capsuleExteriorGain(Tissue.MesentericFat);
  expect(fat).toBeGreaterThan(3);
  expect(interfaceReflectivity(Interface.LiverCapsule) * fat).toBeLessThan(1);
  expect([...S0028_CAPSULE_FAT_TISSUES]).toEqual([Tissue.PerirenalFat]);
  for (const t of S0028_CAPSULE_FAT_TISSUES) {
    expect(capsuleExteriorGain(t, S0028_CAPSULE_FAT_TISSUES)).toBe(fat);
    // Las demás personas: la grasa perirrenal y la de la pared siguen sin subir la cápsula.
    expect(capsuleExteriorGain(t)).toBe(1);
  }
  for (const t of [Tissue.Fat, Tissue.Muscle, Tissue.Blood, Tissue.Liver, Tissue.Diaphragm, Tissue.UnsegmentedSoftTissue])
    expect(capsuleExteriorGain(t, S0028_CAPSULE_FAT_TISSUES)).toBe(1);
});

it('en la escena, la cápsula sube donde al otro lado hay grasa perirrenal o mesentérica y no donde hay músculo, diafragma o grasa de pared', () => {
  expect(scene.person.cpu.capsuleFatTissues).toBe(S0028_CAPSULE_FAT_TISSUES);
  const fat = capsuleExteriorGain(Tissue.MesentericFat);
  const lit: Record<number, number> = {},
    dark: Record<number, number> = {};
  const liver = B.fields.find((f) => f.name === 'liver')!;
  for (let k = 0; k < liver.dimensions[2]; k += 2)
    for (let j = 0; j < liver.dimensions[1]; j += 2)
      for (let i = 0; i < liver.dimensions[0]; i += 2) {
        const p: Vec3 = [liver.originMm[0] + 1.5 * i, liver.originMm[1] + 1.5 * j, liver.originMm[2] + 1.5 * k];
        const c = scene.classify(p, BASELINE_CALIBER);
        if (c.interface !== Interface.LiverCapsule) continue;
        // Oráculo independiente del medio exterior: el mismo paso por la normal de la superficie hepática.
        const g = scene.faceGradient(p, BASELINE_CALIBER, 'liverSurface');
        if (!g || g.norm < 1e-6 || c.interfaceDistance / g.norm > CAPSULE_PROJECTION_MAX_MM) continue;
        const q = p.map((v, a) => v + g.normal[a] * (c.interfaceDistance / g.norm + CAPSULE_OUTSIDE_MM)) as Vec3;
        const exterior = scene.classify(q, BASELINE_CALIBER).tissue,
          gain = liverCapsuleSiteGain(p, scene, BASELINE_CALIBER);
        const isFat =
          exterior === Tissue.MesentericFat || exterior === Tissue.RetroperitonealFat || S0028_CAPSULE_FAT_TISSUES.includes(exterior);
        expect(gain, `${p.join(',')} ${Tissue[exterior]}`).toBe(isFat ? fat : 1);
        const bin = isFat ? lit : dark;
        bin[exterior] = (bin[exterior] ?? 0) + 1;
      }
  // Medido el 13-11-2026 en un nodo de cada dos: 66 puntos con grasa perirrenal al otro lado y 879 con mesentérica suben; 452 con
  // grasa de pared, 443 con músculo y 521 con diafragma, no.
  expect(lit[Tissue.PerirenalFat]).toBeGreaterThan(40);
  expect(lit[Tissue.MesentericFat]).toBeGreaterThan(600);
  expect(dark[Tissue.Fat]).toBeGreaterThan(300);
  expect(dark[Tissue.Muscle]).toBeGreaterThan(300);
  expect(dark[Tissue.Diaphragm]).toBeGreaterThan(300);
});

it('el programa de eco de s0028 amplía la condición de la cápsula y el común la conserva', () => {
  // La sentencia se reconoce por su forma, como en el propio shader: comparaciones de un mismo tejido y la ganancia con siete
  // decimales. En el programa común son dos tejidos; en el de s0028, uno más por cada tejido de su lista.
  const statement = (n: number) =>
    new RegExp(
      `if\\s*\\(\\s*(\\w+)\\s*==\\s*\\w+(?:\\s*\\|\\|\\s*\\1\\s*==\\s*\\w+){${n - 1}}\\s*\\)\\s*\\w+\\s*=\\s*\\d+\\.\\d{7}\\s*;`,
      'g',
    );
  const common = personShader(PASSES.FRAG_RAWFIELD, { person: 'current' }),
    own = personShader(PASSES.FRAG_RAWFIELD, { person: 's0028', bundle: B });
  expect(common.match(statement(2))).toHaveLength(1);
  expect(common.match(statement(3))).toBeNull();
  expect(own.match(statement(2))).toBeNull();
  expect(own.match(statement(2 + S0028_CAPSULE_FAT_TISSUES.length))).toHaveLength(1);
});

it('la grasa preperitoneal lleva el peritoneo sobre el hígado, a su distancia de él (decisión 379)', () => {
  // La grasa preperitoneal queda por fuera del peritoneo: su línea va en la superficie hepática también cuando entre la pared y el
  // hígado hay grasa del TAC. Oráculo propio: la carta de pared y la distancia al hígado, leídas aquí.
  let drawn = 0,
    far = 0,
    uncharted = 0;
  const liver = B.fields.find((f) => f.name === 'liver')!;
  for (let k = 0; k < liver.dimensions[2]; k += 2)
    for (let j = 0; j < liver.dimensions[1]; j += 2)
      for (let i = 0; i < liver.dimensions[0]; i += 2) {
        const p: Vec3 = [liver.originMm[0] + 1.5 * i, liver.originMm[1] + 1.5 * j, liver.originMm[2] + 1.5 * k];
        const c = scene.classify(p, BASELINE_CALIBER);
        if (c.tissue !== Tissue.Fat || c.solids?.owners[0]?.id !== 'compatible_fat') continue;
        // Junto al riñón manda su cara, que queda más cerca.
        if (c.interface === Interface.RenalCapsule) continue;
        const inside = s0028InsideWall(p),
          liverMm = s0028SourceValue(p, 'liver').d,
          tag = p.join(',');
        if (inside === null || !(inside < S0028_PREPERITONEAL_MM)) {
          // Sin carta de pared no hay cara de la que tomar la normal: ahí no se dibuja.
          if (liverMm < S0028_LIVER_SEAM_MM) uncharted++;
          expect(c.interface, tag).not.toBe(Interface.Peritoneum);
        } else if (liverMm < S0028_LIVER_SEAM_MM) {
          drawn++;
          expect(c.interface, tag).toBe(Interface.Peritoneum);
          expect(c.interfaceDistance, tag).toBeCloseTo(Math.max(liverMm, 0), 9);
        } else {
          far++;
          expect(c.interface, tag).not.toBe(Interface.Peritoneum);
        }
      }
  // Medido el 13-11-2026 en un nodo de cada dos: 1.752 con la línea, 8.225 lejos del hígado y 187 sin carta.
  expect(drawn).toBeGreaterThan(1200);
  expect(far).toBeGreaterThan(5000);
  expect(uncharted).toBeGreaterThan(100);
});
