import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it, vi } from 'vitest';
import { HALF } from '../anatomy/halfFloat';
import { Interface } from '../anatomy/interfaces';
import { torsoDepth } from '../anatomy/primitives';
import { AnatomyQuery } from '../anatomy/query';
import { S0028_RENAL_INTERIOR as R } from '../anatomy/s0028RenalInteriorData';
import { S0028_RENAL_INTERIOR_RUNS as RUNS } from '../anatomy/s0028RenalInteriorRuns';
import { STRUCTURE_LABELS, structureIdentity } from '../anatomy/structureIdentity';
import { Tissue } from '../anatomy/tissues';
import { startPointsFor } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { PhysiologyEngine } from '../physiology/engine';
import { CONVEX_C35, probeFrame } from '../probe/probe';
import { cutMapDirections, cutMapPoint } from '../ui/cutMapGeometry';
import type { CutMapInit, CutMapRequest, CutMapResponse } from '../ui/cutMapWorker';
import conflicts from './fixtures/s0028-conflict-witnesses.json';
import cysts from './fixtures/s0028-cyst-witnesses.json';
import fat from './fixtures/s0028-fat-r1.json';
import { abdominalAtlas, setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { S0028_BUNDLE as B, installAnatomyBundle } from './support/legacyPerson/anatomyBundle';
import { abdominalBody, setAbdominalBody } from './support/legacyPerson/referenceBody';
import { s0028CompatibleFat, s0028Owners, setS0028Solids } from './support/legacyPerson/s0028Solids';
import wideSamples from './fixtures/s0028-wide-fat.json';
import { s0028SourceValue } from './support/legacyPerson/s0028Source';
import { s0028WallAt, setS0028Wall } from './support/legacyPerson/s0028Wall';
import { AnatomyScene, BASELINE_CALIBER, type Classification } from './support/legacyPerson/scene';
import { setThoracicAtlas, thoracicAtlas } from './support/legacyPerson/thoracicAtlas';

const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
let scene: AnatomyScene, capacity: ArrayBuffer, skin: ArrayBuffer;
beforeAll(() => {
  installAnatomyBundle(B);
  setAbdominalAtlas(new Uint16Array(raw('abdominal-direct')));
  setThoracicAtlas(new Uint16Array(raw('thoracic-direct')));
  capacity = raw('annotation-capacity');
  skin = raw('skin-polar');
  setS0028Wall(capacity, skin);
  setS0028Solids(capacity);
  setAbdominalBody(new Float32Array(new Uint8Array(readFileSync('src/anatomy/abdominal-body.bin')).buffer));
  scene = new AnatomyScene(NORMAL_ADULT);
});
const at = (p: Vec3) => scene.classify(p, BASELINE_CALIBER);
const ids = (c: Classification) => c.solids?.owners.map((o) => o.id) ?? [];
/** Compartimentos que s0028 no identifica (decisión 321): los de la arquitectura analítica de la otra persona. */
const NEVER = [Tissue.RenalCapsule, Tissue.QuadratusLumborum, Tissue.RetroperitonealFat];
const FATS = [Tissue.Fat, Tissue.MesentericFat, Tissue.PerirenalFat];
/**
 * Cómo se ve la grasa del TAC (decisión 351), con un oráculo propio: la de dentro de la cavidad es ecogénica (perirrenal en las
 * cajas junto al riñón, visceral en el resto) y solo el panículo conserva el material hipoecoico de la pared. «Dentro»: pasada la
 * cara interna de la pared conocida o, donde la carta no la conoce, a más de 50 mm de la piel.
 */
function fatLook(p: Vec3): Tissue {
  // Donde la carta conoce la pared, la grasa con dueño propio ya está pasada su cara interna (dentro de la banda sería conflicto).
  const q = s0028WallAt(p);
  const visceral = q?.kind === 'known' || -torsoDepth(p, scene.torso) > 50;
  // Pegada por dentro a la cara interna de la pared (menos de 15 mm) es preperitoneal: se ve como el panículo (decisión 352).
  const preperitoneal = q?.kind === 'known' && q.depthMm - q.interfaceMm < 15;
  return !visceral ? Tissue.Fat : s0028CompatibleFat(p) !== null ? Tissue.PerirenalFat : preperitoneal ? Tissue.Fat : Tissue.MesentericFat;
}
/**
 * Oráculo del interior renal (decisión 341), independiente del lector de la aplicación: expande por su cuenta los tramos
 * del exportador offline. 0 U, 1 corteza, 2 médula, 3 seno graso, 4 colector, 5 seno sin subclasificar.
 */
const RENAL_LABELS = R.boxes.map((_, i) => {
  const out: number[] = [];
  for (const [, symbol, length] of RUNS[i].matchAll(/([A-Z])([0-9a-z]*)/gu))
    for (let n = length ? parseInt(length, 36) : 1; n > 0; n--) out.push('UCMFPS'.indexOf(symbol));
  return out;
});
function renalLabel(p: Vec3): number {
  const side = p[0] < 10 ? 0 : 1,
    b = R.boxes[side],
    q = p.map((x, k) => Math.round((x - b.originMm[k]) / 1.5));
  if (q.some((x, k) => !(x >= 0 && x < b.dimensions[k]))) return 0;
  return RENAL_LABELS[side][(q[0] * b.dimensions[1] + q[1]) * b.dimensions[2] + q[2]];
}
/** Oráculo de la grasa del abdomen a 3 mm: lee el bit de la celda directamente de la reserva, sin el lector de la aplicación. */
function wideFatOracle(p: Vec3): boolean {
  const F = B.wideFat,
    v = p.map((x, k) => Math.floor((x - F.originMm[k]) / 3));
  if (v.some((x, k) => !(x >= 0 && x < F.dimensions[k]))) return false;
  const bit = (v[0] * F.dimensions[1] + v[1]) * F.dimensions[2] + v[2];
  return ((HALF[new Uint16Array(capacity, 4096 + F.offsetBytes, F.byteCount)[bit >> 3]] >> (bit & 7)) & 1) === 1;
}
/** Corteza y médula sólo con dueño renal; seno y colector sólo sin él (hueco del hilio, fuera de la máscara). */
const PARENCHYMA: Record<number, Tissue> = { 1: Tissue.RenalCortex, 2: Tissue.RenalMedulla };
const SINUS: Record<number, Tissue> = { 3: Tissue.RenalSinus, 4: Tissue.RenalPelvis, 5: Tissue.RenalSinus };
const RENAL = [Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.RenalPelvis];
/** Máscaras fuente P1 que P3 evalúa como dueños; los vasos fuente son de P5. */
const SOURCES = B.fields.filter((f) => !['aorta', 'inferior_vena_cava', 'portal_vein_and_splenic_vein'].includes(f.name));
/** Vasos fuente: no son dueños (P5), pero la grasa D no puede reclamar su interior; las demás máscaras ya excluyen la grasa por dueño. */
const VESSELS = B.fields.filter((f) => ['aorta', 'inferior_vena_cava', 'portal_vein_and_splenic_vein'].includes(f.name));
function brick(name: string, step: number, visit: (p: Vec3, d: number) => void): void {
  const f = B.fields.find((x) => x.name === name)!;
  for (let k = 0; k < f.dimensions[2]; k += step)
    for (let j = 0; j < f.dimensions[1]; j += step)
      for (let i = 0; i < f.dimensions[0]; i += step) {
        const p: Vec3 = [f.originMm[0] + 1.5 * i, f.originMm[1] + 1.5 * j, f.originMm[2] + 1.5 * k];
        visit(p, s0028SourceValue(p, name).d);
      }
}

it('riñón s0028: dueño propio con borde D; corteza y médula sólo donde lo dice el rótulo del propio TAC, sin cápsula; dentro, sólo sus vasos renales', () => {
  // Contrato sustituido (decisión 341): antes todo el interior era U. Ahora manda el rótulo offline; sin rótulo sigue U.
  // Nodos más profundos de cada máscara.
  for (const [p, id] of [
    [[-66.48527431275116, -33.71478450019774, -130.48879268882285], 'kidney_right'],
    [[56.51472568724884, -36.71478450019774, -80.98879268882285], 'kidney_left'],
  ] as const) {
    const c = at([...p]);
    expect(c.tissue, id).toBe(PARENCHYMA[renalLabel([...p])] ?? Tissue.UnsegmentedSoftTissue);
    // A más de 1,2 mm de su borde O no dibuja la cara de la cápsula (r3: sólo el contorno acústico).
    expect(c.interface).toBe(Interface.None);
    expect(c.solids).toEqual({
      state: 'known',
      owners: [{ id, d: expect.any(Number) as number, certainty: 'U' }],
      kidneyMm: c.solids!.owners[0].d,
    });
  }
  for (const [name, id] of [
    ['kidneyRight', 'kidney_right'],
    ['kidneyLeft', 'kidney_left'],
  ] as const) {
    let inside = 0,
      shell = 0,
      cortex = 0,
      medulla = 0,
      vessels = 0;
    brick(name, 2, (p, d) => {
      if (d >= 12) return;
      const c = at(p),
        label = renalLabel(p);
      // Ni dentro ni en la corona de 12 mm: la máscara manda; el estiramiento W de la otra persona dibujaba corteza fuera.
      expect(NEVER, `${name} ${p.join(',')} d=${d}`).not.toContain(c.tissue);
      if (d < 0) {
        inside++;
        // Un dueño único toma el tejido de su rótulo (sin rótulo, U); en una lámina de dos máscaras, conflicto conservado.
        expect(ids(c), p.join(',')).toContain(id);
        // Decisión 350: dentro del riñón sólo existen sus vasos, en el marco de su máscara; ninguno de otro territorio.
        if (c.vesselHit) {
          vessels++;
          // En la pared del vaso no hay identificador de luz: basta con que sea pared vascular.
          if (c.vessel) expect(c.vessel, p.join(',')).toMatch(/^(interlobar|renal)(Vein|Artery)/);
          else expect([Tissue.VesselWallThin, Tissue.ArteryWall], `${p.join(',')} ${Tissue[c.tissue]}`).toContain(c.tissue);
          return;
        }
        expect(c.tissue, p.join(',')).toBe(
          c.solids?.state === 'conflict' ? Tissue.UnsegmentedSoftTissue : (PARENCHYMA[label] ?? Tissue.UnsegmentedSoftTissue),
        );
        if (c.tissue === Tissue.RenalCortex) cortex++;
        if (c.tissue === Tissue.RenalMedulla) medulla++;
      } else {
        shell++;
        // Fuera de la máscara no hay parénquima; seno y colector sólo donde lo dice el rótulo.
        expect([Tissue.RenalCortex, Tissue.RenalMedulla], p.join(',')).not.toContain(c.tissue);
        if (RENAL.includes(c.tissue)) expect(c.tissue, p.join(',')).toBe(SINUS[label]);
      }
    });
    expect(inside).toBeGreaterThan(3000);
    expect(shell).toBeGreaterThan(5000);
    // Las interlobares del modelo son del riñón derecho: ahí deben verse; el izquierdo sólo recibe su vena y su arteria.
    if (name === 'kidneyRight') expect(vessels).toBeGreaterThan(5);
    // Corteza 82 % y médula 17 % de la máscara en el exportador; uno de cada ocho nodos aquí.
    expect(cortex).toBeGreaterThan(2000);
    expect(medulla).toBeGreaterThan(300);
  }
});

it('hígado s0028: dueño O sin el ligamento venoso analítico de la otra persona', () => {
  for (const p of [
    [-25.98527431275116, 2.2852154998022627, -40.488792688822855],
    [-16.98527431275116, 5.285215499802263, -40.488792688822855],
    [-7.985274312751159, 8.285215499802263, -40.488792688822855],
  ] as Vec3[]) {
    const c = at(p);
    expect(c.tissue, p.join(',')).toBe(Tissue.Liver);
    expect(c.solids).toEqual({
      state: 'known',
      owners: [{ id: 'liver', d: expect.any(Number) as number, certainty: 'O' }],
      kidneyMm: expect.any(Number) as number,
    });
  }
});

it('conflicto: los vóxeles de hígado y bazo dentro de la banda P2 conservan los dos dueños y no eligen material', () => {
  for (const [p, organ] of [
    [[-100.98527431275116, -27.714784500197737, -113.98879268882285], 'liver'],
    [[-99.48527431275116, -27.714784500197737, -112.48879268882285], 'liver'],
    [[-102.48527431275116, -30.714784500197737, -109.48879268882285], 'liver'],
    [[-100.98527431275116, -30.714784500197737, -107.98879268882285], 'liver'],
    [[115.01472568724884, -29.214784500197737, -92.98879268882285], 'spleen'],
    [[118.01472568724884, -32.21478450019774, -89.98879268882285], 'spleen'],
  ] as const) {
    const c = at([...p]);
    expect(c.solids?.state, p.join(',')).toBe('conflict');
    expect(ids(c).sort()).toEqual([organ, 'wall']);
    expect(c.tissue).toBe(Tissue.UnsegmentedSoftTissue);
    expect(c.interface).toBe(Interface.None);
    expect(c.wall).toBeUndefined();
  }
});

it('testigos de conflicto de la e2e GPU (r3): la CPU da U con los dos dueños del par, en los nueve pares del censo', () => {
  expect(conflicts.pairs).toHaveLength(9);
  for (const [x, y, z, k] of conflicts.points) {
    const c = at([x, y, z]);
    expect(c.solids?.state, `${x},${y},${z}`).toBe('conflict');
    expect(ids(c).sort().join('+')).toBe(conflicts.pairs[k]);
    expect(c.tissue).toBe(Tissue.UnsegmentedSoftTissue);
  }
  // Revisión de #336 (I1): grasa D + banda en la sub-banda de grasa de la pared, donde la banda sola daría Fat.
  expect(conflicts.fatBand.length).toBeGreaterThan(20);
  for (const [x, y, z] of conflicts.fatBand) {
    const c = at([x, y, z]),
      q = s0028WallAt([x, y, z]);
    expect(c.solids?.state, `${x},${y},${z}`).toBe('conflict');
    expect(ids(c).sort().join('+')).toBe('compatible_fat+wall');
    expect(q?.kind === 'known' && q.outerMm - q.depthMm >= 0.5, `${x},${y},${z} sub-banda de grasa`).toBe(true);
    expect(c.tissue).toBe(Tissue.UnsegmentedSoftTissue);
  }
});

it('testigos del quiste de la e2e GPU (revisión de #336): dueño kidney_cyst_left, líquido E, a ≥ 0,3 mm de su borde', () => {
  expect(cysts.cyst.length).toBeGreaterThan(30);
  for (const [x, y, z] of cysts.cyst) {
    const c = at([x, y, z]);
    expect(c.solids?.state, `${x},${y},${z}`).toBe('known');
    expect(c.solids?.owners[0].id).toBe('kidney_cyst_left');
    expect(c.solids!.owners[0].d).toBeLessThan(-0.3);
    expect(c.tissue).toBe(Tissue.Fluid);
  }
});

it('hueso dentro de la banda P2: contenido del complejo de pared (O), no choque', () => {
  for (const p of [
    [125.51472568724884, -21.714784500197737, -115.48879268882285],
    [116.51472568724884, 59.28521549980226, -52.488792688822855],
    [85.01472568724884, 68.28521549980226, -7.488792688822855],
    [-112.98527431275116, 45.78521549980226, 19.511207311177145],
  ] as Vec3[]) {
    const q = s0028WallAt(p);
    expect(q?.kind === 'known' && q.depthMm > q.outerMm && q.depthMm < q.interfaceMm, p.join(',')).toBe(true);
    const c = at(p);
    expect(c.tissue).toBe(Tissue.Bone);
    expect(c.solids).toEqual({
      state: 'known',
      owners: [{ id: 'bone', d: expect.any(Number) as number, certainty: 'O' }],
      kidneyMm: expect.any(Number) as number,
    });
  }
});

it('lumbosacro y sacro solapados: un solo dueño óseo, nunca conflicto hueso/hueso (mutante hueso-duplicado)', () => {
  // Los únicos solapes entre campos óseos P1 son lumbosacro + sacro: 432 de 803.472 muestras óseas a 1,5 mm y media celda
  // (decisión 322, punto 8). Son el mismo material O: la deduplicación deja un dueño, con la etiqueta del primero.
  for (const p of [
    [-25.98527431275116, -75.71478450019774, -275.98879268882285],
    [-25.98527431275116, -74.21478450019774, -275.98879268882285],
    [-25.98527431275116, -77.21478450019774, -274.48879268882285],
  ] as Vec3[]) {
    expect([s0028SourceValue(p, 'lumbarSacralBone').d < 0, s0028SourceValue(p, 'sacrum').d < 0], p.join(',')).toEqual([true, true]);
    const o = s0028Owners(p, s0028WallAt(p));
    expect(
      o.owners.filter((x) => x.id === 'bone'),
      p.join(','),
    ).toHaveLength(1);
    expect(o.state, p.join(',')).toBe(o.owners.length > 1 ? 'conflict' : 'known');
    expect(
      o.owners.some((x) => x.id !== 'bone'),
      p.join(','),
    ).toBe(false);
  }
});

it('U nunca se clasifica como tejido conocido en el compartimento posterior y renal, salvo el rótulo renal del propio TAC', () => {
  // Oráculo independiente de la implementación: sin máscara fuente (SDF < 0), sin bit de grasa D y fuera de la banda P2
  // conocida el punto es U. Caja de ambos riñones con 40 mm de margen, a 3 mm: 270.000 puntos. Las condiciones se evalúan
  // en línea y los fallos se reúnen para una sola aserción: un `expect` por punto costaba 30 s de los 60 del plazo.
  let unknown = 0,
    known = 0,
    fatInBand = 0;
  const failures: string[] = [];
  for (let z = -225; z <= -35; z += 3)
    for (let y = -125; y <= 20; y += 3)
      for (let x = -130; x <= 130; x += 3) {
        const p: Vec3 = [x, y, z];
        if (torsoDepth(p, scene.torso) > -1.5) continue;
        const c = at(p),
          label = renalLabel(p),
          owners = ids(c),
          q = s0028WallAt(p);
        const fail = (what: string) => failures.length < 20 && failures.push(`${x},${y},${z}: ${what}`);
        if (NEVER.includes(c.tissue)) fail('compartimento de la otra persona ' + Tissue[c.tissue]);
        // El material de grasa perirrenal solo viste a la grasa del TAC: nunca a un punto sin ese dueño.
        if (c.tissue === Tissue.PerirenalFat && !owners.includes('compatible_fat')) fail('grasa perirrenal sin grasa del TAC');
        // Tejido renal sólo por rótulo: parénquima con dueño renal, seno sin él.
        if (RENAL.includes(c.tissue) && c.tissue !== (owners.some((id) => id.startsWith('kidney')) ? PARENCHYMA[label] : SINUS[label]))
          fail('tejido renal sin su rótulo');
        // La grasa D es el complemento de las máscaras: nunca comparte punto con un dueño fuente ni con un vaso fuente (P5),
        // tampoco en la lámina subvóxel; dentro de la banda P2 conocida es conflicto (dos dueños), nunca pared sin más.
        if (owners.includes('compatible_fat')) {
          if (owners.some((id) => id !== 'wall' && id !== 'compatible_fat')) fail('grasa D con otro dueño fuente');
          for (const f of VESSELS) if (!(s0028SourceValue(p, f.name).d >= 0)) fail('grasa D dentro de ' + f.name);
          if (owners.includes('wall')) {
            fatInBand++;
            if (c.solids?.state !== 'conflict' || c.tissue !== Tissue.UnsegmentedSoftTissue) fail('grasa D en la banda sin conflicto');
          }
        }
        // Certeza de la pared: D hasta la cara externa conocida, U de ahí a la interfaz (mutante D↔U).
        for (const o of c.solids?.owners ?? [])
          if (o.id === 'wall' && o.certainty !== (q?.kind === 'known' && q.depthMm < q.outerMm ? 'D' : 'U')) fail('certeza de la pared');
        const owned =
          s0028CompatibleFat(p) === true ||
          // Fuera de las cajas renales, la grasa D del abdomen a 3 mm (decisión 343), leída aquí por su cuenta.
          (s0028CompatibleFat(p) === null && wideFatOracle(p)) ||
          (q?.kind === 'known' && q.depthMm >= 1.5 && q.depthMm < q.interfaceMm) ||
          SOURCES.some((f) => s0028SourceValue(p, f.name).d < 0);
        if (owned) {
          known++;
          continue;
        }
        unknown++;
        if (!c.vesselHit && c.interface !== Interface.DuctLumen) {
          // Vasos y conductos procedurales E fuera de los sólidos: P5. El diafragma E bajo el pulmón va rotulado.
          if (
            c.tissue === Tissue.Diaphragm
              ? c.approximation !== 'diaphragm-lung-base'
              : c.tissue !== (SINUS[label] ?? Tissue.UnsegmentedSoftTissue)
          )
            fail('U clasificado como ' + Tissue[c.tissue]);
        }
        const solids = c.solids;
        if (
          !solids ||
          solids.state !== 'U' ||
          solids.owners.length ||
          typeof solids.kidneyMm !== 'number' ||
          Object.keys(solids).length !== 3
        )
          fail('U con dueños: ' + JSON.stringify(solids));
      }
  expect(failures).toEqual([]);
  expect(unknown).toBeGreaterThan(1000);
  expect(fatInBand).toBeGreaterThan(20);
  expect(known).toBeGreaterThan(10000);
});

it('grasa compatible D: vóxel con bit y sin máscara es grasa D; la envolvente renal sigue U salvo el seno rotulado', () => {
  let fatChecked = 0,
    hull = 0;
  for (const row of fat.rows) {
    const box = B.solids.boxes.find((b) => b.side === row.side)!;
    const p = box.originMm.map((o, k) => o + 1.5 * row.index[k]) as Vec3;
    const c = at(p),
      tube = c.vesselHit || c.interface === Interface.DuctLumen;
    // Un vóxel fuera de su máscara puede estar dentro del SDF lineal de otra (lámina subvóxel): ahí manda ese dueño.
    if (SOURCES.some((f) => s0028SourceValue(p, f.name).d < 0)) continue;
    if (row.fat) {
      expect(ids(c), JSON.stringify(row)).toContain('compatible_fat');
      if (c.solids?.state === 'known' && !tube) {
        expect(c.tissue).toBe(SINUS[renalLabel(p)] ?? fatLook(p));
        expect(c.solids.owners).toEqual([{ id: 'compatible_fat', d: 0, certainty: 'D' }]);
        fatChecked++;
      }
    } else if (row.kind === 'envelope') {
      // Envolvente convexa renal (seno e hilio sin máscara): U aunque la cruce un vaso procedural E.
      expect(c.solids, JSON.stringify(row)).toEqual({ state: 'U', owners: [], kidneyMm: expect.any(Number) as number });
      if (!tube) expect(c.tissue).toBe(SINUS[renalLabel(p)] ?? Tissue.UnsegmentedSoftTissue);
      hull++;
    }
  }
  expect(fatChecked).toBeGreaterThan(60);
  expect(hull).toBeGreaterThan(40);
  // Dentro de la celda nearest de un vóxel de grasa pero en el SDF lineal de una máscara: manda la máscara, sin grasa.
  let sliver = 0;
  for (const row of fat.rows.filter((r) => r.fat)) {
    const box = B.solids.boxes.find((b) => b.side === row.side)!;
    for (let k = 0; k < 27; k++) {
      const p = box.originMm.map((o, a) => o + 1.5 * row.index[a] + 0.7 * ((Math.floor(k / 3 ** a) % 3) - 1)) as Vec3;
      if (!SOURCES.some((f) => s0028SourceValue(p, f.name).d < 0) || s0028CompatibleFat(p) !== true) continue;
      sliver++;
      expect(ids(at(p)), p.join(',')).not.toContain('compatible_fat');
    }
  }
  expect(sliver).toBeGreaterThan(0);
});

it('vocabulario cerrado: ningún dueño es Gerota, cuadrado lumbar, diafragma posterior, interior renal ni compartimento', () => {
  const seen = new Set<string>();
  for (let z = -220; z <= 40; z += 6)
    for (let y = -125; y <= 120; y += 6) for (let x = -150; x <= 150; x += 6) for (const id of ids(at([x, y, z]))) seen.add(id);
  for (const id of seen) expect(id).not.toMatch(/gerota|quadratus|ql\b|diaphragm|interior|perirenal|pararenal|compartment/i);
  expect([...seen].sort()).toEqual(
    expect.arrayContaining(['liver', 'spleen', 'pancreas', 'kidney_right', 'kidney_left', 'iliopsoas_left', 'iliopsoas_right']),
  );
});

it('Worker real del corte: el riñón lleva su rótulo (corteza o médula, o «interior U») y el mapa coincide con la CPU bit a bit', async () => {
  const posted: unknown[] = [];
  vi.stubGlobal('self', { postMessage: (m: unknown) => posted.push(m) });
  await import('../ui/cutMapWorker');
  const handler = (globalThis as unknown as { self: { onmessage: (e: { data: unknown }) => Promise<void> } }).self.onmessage;
  const engine = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas());
  const sample = engine.sample;
  const init: CutMapInit = {
    type: 'init',
    identity: scene.person.identity,
    assetKey: scene.person.assetKey,
    epoch: 1,
    id: 1,
    patient: NORMAL_ADULT,
    referenceProfile: abdominalBody,
    buffers: { abdominal: abdominalAtlas, thoracic: thoracicAtlas, body: abdominalBody, capacity, skin },
  };
  // Mismo proceso: si el Worker no instalase su bloque P3, la grasa quedaría la vacía de esta reserva previa.
  const empty = capacity.slice(0);
  new Uint16Array(empty, 4096 + B.solids.offsetBytes, B.solids.byteCount).fill(0);
  setS0028Solids(empty);
  const fatPoint = B.solids.boxes[0].originMm.map((o, k) => o + 1.5 * fat.rows[0].index[k]) as Vec3;
  expect([fat.rows[0].kind, s0028CompatibleFat(fatPoint)]).toEqual(['fat', false]);
  await handler({ data: init });
  expect(s0028CompatibleFat(fatPoint)).toBe(false);
  expect(posted).toContainEqual(expect.objectContaining({ type: 'ready', epoch: 1, assetKey: scene.person.assetKey }));
  setS0028Solids(capacity);
  const pose = startPointsFor(scene.torso, B).find((p) => p.id === 'renal')!;
  const frame = probeFrame({ ...pose, rock: pose.rock ?? 0, tilt: pose.tilt ?? 0, lift: 0 }, scene.torso, CONVEX_C35);
  const req: CutMapRequest = {
    type: 'map',
    epoch: 1,
    assetKey: scene.person.assetKey,
    id: 2,
    frame,
    transducer: CONVEX_C35,
    compression: null,
    depthMm: 160,
    sample,
    width: 64,
    height: 96,
  };
  await handler({ data: req });
  vi.unstubAllGlobals();
  const map = posted.find((m): m is CutMapResponse => (m as CutMapResponse).type === 'map')!;
  expect(map, JSON.stringify(posted)).toBeDefined();
  const query = new AnatomyQuery(scene);
  const caliber = query.caliberFor(sample);
  const dirs = cutMapDirections(frame, CONVEX_C35, 64);
  let kidney = 0,
    labelled = 0;
  for (let v = 0; v < 96; v++)
    for (let u = 0; u < 64; u++) {
      const m = query.deformation.toMaterial(
        cutMapPoint(frame.curvatureCenter, dirs[u], CONVEX_C35.curvatureRadius + (160 * (v + 0.5)) / 96),
        sample.resp,
      );
      const c = scene.classify(m, caliber),
        i = v * 64 + u;
      expect([map.tissue[i], map.structure[i]], `${u},${v}`).toEqual([
        c.tissue,
        structureIdentity(m, c.tissue, c.interface, scene, c.solids),
      ]);
      // Oráculo fuente: dentro de la máscara renal derecha y de ninguna otra, el tejido de su rótulo con identidad de riñón.
      if (SOURCES.every((f) => s0028SourceValue(m, f.name).d < 0 === (f.name === 'kidneyRight'))) {
        kidney++;
        // Un vaso renal dentro del riñón (decisión 350) es sangre o pared con la región del riñón.
        if (c.vesselHit) {
          expect(STRUCTURE_LABELS[map.structure[i]], `${u},${v}`).toBe('Riñón derecho');
          expect([Tissue.Blood, Tissue.VesselWallThin, Tissue.ArteryWall], `${u},${v}`).toContain(map.tissue[i]);
          continue;
        }
        const tissue = PARENCHYMA[renalLabel(m)];
        if (tissue !== undefined) labelled++;
        expect([map.tissue[i], STRUCTURE_LABELS[map.structure[i]]], `${u},${v}`).toEqual([
          tissue ?? Tissue.UnsegmentedSoftTissue,
          tissue === undefined ? 'Riñón derecho · interior U' : 'Riñón derecho',
        ]);
      }
    }
  expect(kidney).toBeGreaterThan(100);
  expect(labelled).toBeGreaterThan(80);
});

it('grasa compatible D: nunca dentro de la lámina subvóxel de aorta, VCI o porta/esplénica (revisión r2)', () => {
  // Punto de la revisión: SDF de la VCI −0,096 mm con bit de grasa; antes salía Fat.
  const c = at([-16.56, 6.28, -184.82]);
  expect(ids(c)).not.toContain('compatible_fat');
  expect(FATS).not.toContain(c.tissue);
  let checked = 0;
  for (const name of ['aorta', 'inferior_vena_cava', 'portal_vein_and_splenic_vein'])
    brick(name, 1, (p, d) => {
      if (!(d < 0) || s0028CompatibleFat(p) !== true) return;
      // Nodo de la máscara del vaso con bit de grasa: la grasa no puede ser dueño; a 0,4 vóxel del nodo, tampoco si sigue dentro.
      for (const q of [p, [p[0] + 0.6, p[1], p[2]], [p[0], p[1] - 0.6, p[2] + 0.6]] as Vec3[]) {
        if (!(s0028SourceValue(q, name).d < 0)) continue;
        checked++;
        expect(ids(at(q)), `${name} ${q.join(',')}`).not.toContain('compatible_fat');
      }
    });
  expect(checked).toBeGreaterThanOrEqual(0);
});

it('quiste renal izquierdo: líquido con dueño E en todos sus nodos; identidades 17/18/19 por literal', () => {
  let nodes = 0;
  brick('renalCysts', 1, (p, d) => {
    if (!(d < 0)) return;
    nodes++;
    const c = at(p);
    expect(c.tissue, p.join(',')).toBe(Tissue.Fluid);
    expect(c.solids?.owners[0], p.join(',')).toEqual({ id: 'kidney_cyst_left', d, certainty: 'E' });
  });
  expect(nodes).toBeGreaterThan(20);
  // El Worker compara contra esta misma función: aquí los rótulos van contra literales.
  const liver = { id: 'liver', d: -1, certainty: 'O' } as const;
  const conflict = { state: 'conflict', owners: [liver, { id: 'wall', d: -1, certainty: 'D' } as const], kidneyMm: 16 } as const;
  const p: Vec3 = [0, 0, -100];
  expect(structureIdentity(p, Tissue.UnsegmentedSoftTissue, Interface.None, scene, conflict)).toBe(17);
  expect(STRUCTURE_LABELS[17]).toBe('Conflicto sin resolver · dos dueños');
  for (const [id, label] of [
    ['kidney_right', 18],
    ['kidney_left', 19],
    ['kidney_cyst_left', 19],
  ] as const)
    expect(
      structureIdentity(p, Tissue.UnsegmentedSoftTissue, Interface.None, scene, {
        state: 'known',
        owners: [{ id, d: -1, certainty: 'U' }],
        kidneyMm: -1,
      }),
    ).toBe(label);
  expect(structureIdentity(p, Tissue.Liver, Interface.None, scene, { state: 'known', owners: [liver], kidneyMm: 16 })).toBe(1);
});

it('grasa compatible D: vóxel nearest (redondeo), con las dos cajas en OR donde se solapan', () => {
  const S = B.solids;
  const words = new Uint16Array(capacity, 4096 + S.offsetBytes, S.encodedBytes / 2);
  const bitOf = (b: (typeof S.boxes)[number], i: number, j: number, k: number) => {
    const bit = (i * b.dimensions[1] + j) * b.dimensions[2] + k;
    return (HALF[words[b.byteOffset + (bit >> 3)]] >> (bit & 7)) & 1;
  };
  const atCell = (b: (typeof S.boxes)[number], i: number, j: number, k: number): Vec3 => [
    b.originMm[0] + 1.5 * i,
    b.originMm[1] + 1.5 * j,
    b.originMm[2] + 1.5 * k,
  ];
  let edges = 0;
  for (const b of S.boxes)
    for (let k = 0; k < b.dimensions[2]; k += 3)
      for (let j = 0; j < b.dimensions[1]; j += 3)
        for (let i = 0; i + 1 < b.dimensions[0]; i += 2) {
          const a = bitOf(b, i, j, k),
            c = bitOf(b, i + 1, j, k);
          if (a === c) continue;
          const p = atCell(b, i, j, k);
          // ¿Cubre también la otra caja? Entonces el bit es el OR de ambas.
          const other = S.boxes.find((o) => o !== b);
          const inOther = (q: Vec3) => {
            const x = (q[0] - other!.originMm[0]) / 1.5,
              y = (q[1] - other!.originMm[1]) / 1.5,
              z = (q[2] - other!.originMm[2]) / 1.5;
            if (!(
              x >= 0 &&
              y >= 0 &&
              z >= 0 &&
              x <= other!.dimensions[0] - 1 &&
              y <= other!.dimensions[1] - 1 &&
              z <= other!.dimensions[2] - 1
            ))
              return 0;
            return bitOf(other!, Math.round(x), Math.round(y), Math.round(z));
          };
          const near: Vec3 = [p[0] + 0.6, p[1], p[2]],
            far: Vec3 = [p[0] + 0.9, p[1], p[2]];
          edges++;
          expect(s0028CompatibleFat(near), `${near.join(',')}`).toBe(Boolean(a | inOther(near)));
          expect(s0028CompatibleFat(far), `${far.join(',')}`).toBe(Boolean(c | inOther(far)));
        }
  expect(edges).toBeGreaterThan(500);
});

it('contorno acústico renal (r3): el borde O de la máscara es la cara de la cápsula a ambos lados, con la normal media a 3 mm', () => {
  const off: Vec3 = [0.37, 0.41, 0.29];
  for (const name of ['kidneyRight', 'kidneyLeft']) {
    let inside = 0,
      outside = 0,
      deep = 0,
      smoothed = 0,
      kept = 0;
    brick(name, 1, (node) => {
      const p: Vec3 = [node[0] + off[0], node[1] + off[1], node[2] + off[2]];
      const d = s0028SourceValue(p, name).d;
      if (d > 1.3 || (d < -1.3 && Math.round(node[0] + node[1] + node[2]) % 7)) return;
      const c = at(p),
        own = c.solids?.owners.map((o) => o.id) ?? [];
      if (c.solids?.state === 'conflict' || c.vesselHit || c.interface === Interface.DuctLumen) return;
      if (d < -1.2) {
        // Interior U lejos del borde: sin cara inventada.
        expect(c.interface, p.join(',')).toBe(Interface.None);
        deep++;
        return;
      }
      if (Math.abs(d) >= 1.2) return;
      if (d < 0) inside++;
      else if (own.length && !['compatible_fat', 'kidney_cyst_left'].includes(own[0])) return;
      else outside++;
      // Una cara más cercana (la cortical costal, por ejemplo) conserva la muestra.
      if (c.interface !== Interface.RenalCapsule) {
        expect(c.interfaceDistance, `${p.join(',')} d=${d} cara ${c.interface}`).toBeLessThan(Math.abs(d));
        return;
      }
      expect(c.interfaceDistance, `${p.join(',')} d=${d}`).toBe(Math.abs(d));
      expect(c.solids?.kidneyMm, p.join(',')).toBe(d);
      expect(scene.faceSdf(p, BASELINE_CALIBER, 'kidneyOuter')).toBe(d);
      // Normal de la cara (decisión 352): la media del contorno a 3 mm, cuatro lecturas en tetraedro, para que la cápsula no siga
      // el escalón del vóxel, mezclada de forma continua con el gradiente local de la trilineal (diferencias centrales dentro de
      // la misma celda), que manda junto al borde de la caja y donde la media se anula o se da la vuelta.
      const g = scene.faceGradient(p, BASELINE_CALIBER)!;
      const h = 0.01,
        local = [0, 1, 2].map((k) => {
          const a: Vec3 = [...p],
            b: Vec3 = [...p];
          a[k] += h;
          b[k] -= h;
          return (s0028SourceValue(a, name).d - s0028SourceValue(b, name).d) / (2 * h);
        }),
        corners = [
          [3, -3, -3],
          [-3, -3, 3],
          [-3, 3, -3],
          [3, 3, 3],
        ],
        taps = corners.map((k) => s0028SourceValue([p[0] + k[0], p[1] + k[1], p[2] + k[2]], name).d),
        mean = [0, 1, 2].map((i) => corners.reduce((sum, k, j) => sum + (k[i] * taps[j]) / 36, 0)),
        lm = Math.hypot(...mean),
        ll = Math.hypot(...local),
        cosine =
          (mean[0] * local[0] + mean[1] * local[1] + mean[2] * local[2]) / Math.max(lm * Math.max(ll, 0.25), 1e-6) +
          1 -
          Math.min(1, ll / 0.25),
        step = (a: number, b: number, x: number) => {
          const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
          return t * t * (3 - 2 * t);
        },
        // A menos de 3 mm del borde de la caja alguna lectura cae fuera: ahí la media no entra (de 3 a 4,5 mm, gradual).
        box = B.fields.find((x) => x.name === name)!,
        edge = Math.min(...p.map((v, k) => Math.min(v - box.originMm[k], box.originMm[k] + 1.5 * (box.dimensions[k] - 1) - v))),
        w = step(3, 4.5, edge) * step(0.3, 0.7, lm) * step(0, 0.5, cosine),
        fd = local.map((v, i) => v + (mean[i] - v) * w),
        n = Math.hypot(...fd);
      if (w > 0.99) smoothed++;
      else kept++;
      expect(Math.abs(g.norm - n), p.join(',')).toBeLessThan(1e-6);
      for (let k = 0; k < 3; k++) expect(Math.abs(g.normal[k] - fd[k] / n), p.join(',')).toBeLessThan(1e-6);
    });
    // La media manda en casi todo el contorno; la reserva local es la excepción.
    expect(smoothed, name).toBeGreaterThan(5 * Math.max(1, kept));
    expect(inside, name).toBeGreaterThan(800);
    expect(outside, name).toBeGreaterThan(800);
    expect(deep, name).toBeGreaterThan(300);
  }
});

it('grasa del abdomen a 3 mm (decisión 343): reproduce los testigos del TAC y sólo da grasa donde no hay otro dueño', () => {
  // Testigos independientes: celdas elegidas por `s0028-wide-fat.py` con el valor que calculó desde el TAC.
  expect(wideSamples.sha256).toBe(B.wideFat.sha256);
  let fatRows = 0,
    classifiedFat = 0;
  for (const row of wideSamples.rows) {
    const p = row.pointLASmm as Vec3;
    expect(wideFatOracle(p), JSON.stringify(row.cell)).toBe(row.fat);
    const c = at(p);
    if (torsoDepth(p, scene.torso) > -1.5) continue;
    const owners = ids(c);
    if (!row.fat) {
      // Sin bit, la grasa amplia nunca crea un dueño; dentro de una caja renal manda la grasa P3 de 1,5 mm.
      if (s0028CompatibleFat(p) === null) expect(owners, JSON.stringify(row.cell)).not.toContain('compatible_fat');
      continue;
    }
    fatRows++;
    if (owners.join() !== 'compatible_fat' || s0028CompatibleFat(p) !== null) continue;
    // Único dueño y fuera de las cajas renales: grasa D, salvo que un vaso o conducto procedural E pase por ahí.
    expect(c.solids).toEqual({
      state: 'known',
      owners: [{ id: 'compatible_fat', d: 0, certainty: 'D' }],
      kidneyMm: expect.any(Number) as number,
    });
    for (const f of [...SOURCES, ...VESSELS]) expect(s0028SourceValue(p, f.name).d >= 0, `${row.cell.join(',')} ${f.name}`).toBe(true);
    if (!c.vesselHit && c.interface !== Interface.DuctLumen) {
      expect(c.tissue, JSON.stringify(row.cell)).toBe(fatLook(p));
      classifiedFat++;
    }
  }
  // 36,5 % de las celdas de la caja son grasa; buena parte es panículo, que ya dibuja la pared.
  expect(fatRows).toBeGreaterThan(150);
  expect(classifiedFat).toBeGreaterThan(40);
});
