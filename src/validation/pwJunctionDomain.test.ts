// @tier slow
import { beforeAll, describe, expect, it } from 'vitest';
import { loadS0028 } from '../../tools/anatomy/s0028Windows';
import type { AnatomyQuery } from '../anatomy/query';
import { tubeQuery, type Tube } from '../anatomy/primitives';
import { vesselApScale, type VesselCaliber } from '../anatomy/scene';
import { wallThicknessMm, type DuctDef, type VesselDef } from '../anatomy/vesselTree';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { prfFromNyquistCms } from '../core/units';
import type { Vec3 } from '../core/vec3';
import type { PhysiologySample } from '../physiology/engine';
import type { PatientState, RespiratoryPattern } from '../physiology/patientState';
import type { VesselId } from '../physiology/vessels';
import { CONVEX_C35 } from '../probe/probe';
import { acquire, openSession, placeGate, probeAt } from './support/studentChain';

/**
 * La consulta del dominio de una corriente en las uniones (`SampleVolumeIQ.domainArc`) con `tubeDistance` y la sección del socio
 * una vez por fisiología (decisión 416) da la misma señal que la de antes, que creaba el tubo del instante de cada socio y un
 * resultado de `tubeQuery` por consulta: el mismo arco en cada consulta y, con la misma semilla, las mismas muestras IQ, el mismo
 * espectro y la misma medida, bit a bit. La de antes queda aquí, tal cual, como referencia, y sustituye a la del producto en una
 * de las dos sesiones.
 *
 * Por la cadena del alumno (`support/studentChain.ts`), en las dos personas, en apnea y respirando, y con la puerta en la porta
 * subcostal de s0028, donde el tronco tiene ocho socios (la cava, con su semieje AP; la esplénica y la mesentérica, con forma y
 * ruido del radio; cinco arterias) y la consulta era el 35 % de `s0028ExamChain.test.ts`.
 */
interface Zone {
  duct: boolean;
  def: VesselDef | DuctDef;
  lo: Vec3;
  hi: Vec3;
}
interface StreamLike {
  def: VesselDef;
  seg: number;
  s: number;
  geom: { len: number[] };
}
interface Internals {
  junctions: Map<VesselDef, Zone[]>;
  anatomy: AnatomyQuery;
  phys: PhysiologySample;
  domainArc: (st: StreamLike, m: Vec3) => number;
}

const instantTube = (def: VesselDef, caliber: VesselCaliber): Tube => {
  const ap = vesselApScale(def.id, def.tube.apScale, caliber);
  return ap === def.tube.apScale ? def.tube : { ...def.tube, apScale: ap };
};
const inCap = (st: StreamLike): boolean => (st.seg === 0 && st.s < 0) || (st.seg === st.geom.len.length - 1 && st.s > 1);

/** `domainArc` hasta la decisión 416. */
function referenceDomainArc(volume: Internals, st: StreamLike, m: Vec3): number {
  const zones = volume.junctions.get(st.def);
  if (!zones) return Infinity;
  let caliber: VesselCaliber | null = null;
  let own = Number.NaN;
  let arc = Infinity;
  for (const z of zones) {
    const outside = Math.max(z.lo[0] - m[0], m[0] - z.hi[0], z.lo[1] - m[1], m[1] - z.hi[1], z.lo[2] - m[2], m[2] - z.hi[2]);
    if (outside > 0) {
      arc = Math.min(arc, outside);
      continue;
    }
    caliber ??= volume.anatomy.caliberFor(volume.phys);
    const tube = z.duct ? z.def.tube : instantTube(z.def as VesselDef, caliber);
    const hit = tubeQuery(m, tube, z.duct ? 1 : caliber.radiusScale(z.def.id as VesselId));
    const wall = z.duct ? (z.def as DuctDef).wallMm : wallThicknessMm(z.def as VesselDef, hit.r);
    const rate = 1 / Math.min(1, tube.apScale);
    if (!(hit.d < wall)) {
      arc = Math.min(arc, (hit.d - wall) / rate);
      continue;
    }
    if (Number.isNaN(own)) own = tubeQuery(m, instantTube(st.def, caliber), caliber.radiusScale(st.def.id)).d;
    if (hit.d < own) return -1;
    arc = Math.min(arc, (hit.d - own) / (rate + (inCap(st) ? 1 : 0)));
  }
  return 0.8 * arc;
}

interface Case {
  name: string;
  base: PatientState;
  resp: RespiratoryPattern;
  window: 'portalTrunk' | 'portalSubcostal' | 'renal';
  vessels: VesselId[];
  kind: 'portal' | 'renal';
}

const SECONDS = 1.2;

function signal(c: Case, reference: boolean) {
  const session = openSession(c.base, c.resp);
  const volume = session.chain.sampleVolume;
  const internals = volume as unknown as Internals;
  let queries = 0;
  let inZone = 0;
  let different = 0;
  expect(typeof internals.domainArc, 'SampleVolumeIQ.domainArc').toBe('function');
  const product = internals.domainArc.bind(internals);
  // la sesión de referencia corre con la consulta de antes y, en cada llamada, la compara con la de ahora
  if (reference)
    internals.domainArc = (st, m) => {
      queries++;
      const arc = referenceDomainArc(internals, st, m);
      if (arc < Infinity) inZone++;
      if (!Object.is(product(st, m), arc)) different++;
      return arc;
    };
  const generate = volume.generate.bind(volume);
  const iq: number[] = [];
  volume.generate = (phys, v, n, re, im, offset = 0, afterLast = 0) => {
    generate(phys, v, n, re, im, offset, afterLast);
    for (let k = offset; k < offset + n; k++) iq.push(re[k], im[k]);
  };
  // la puerta se pone al final de la espiración, cuando el vaso está en el plano (como `support/s0028Scales.ts`)
  for (let n = 0; !(session.engine.sample.resp.diaphragmCaudalMm < 0.3) && n < 3000; n++) session.engine.step();
  const contact = probeAt(session, c.window);
  const best = placeGate(session, contact, c.vessels, { acoustic: false, maxDepthMm: 170 });
  expect(best, `${c.name}: sin vaso en la ventana`).not.toBeNull();
  const prfHz = Math.min(
    c.kind === 'renal' ? 6000 : prfFromNyquistCms(40, CONVEX_C35.f0Doppler),
    Math.floor((0.9 * 1_540_000) / (2 * best!.r)),
  );
  const { captures } = acquire(session, contact, best!, c.kind, { prfHz, seconds: SECONDS, gateMm: Math.min(4, 2 * best!.bd) });
  const bytes = (a: Float32Array): string => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
  return {
    iq: bytes(Float32Array.from(iq)),
    samples: iq.length / 2,
    spectrum: session.chain.spectral.columns.map((col) => `${col.t} ${bytes(col.powerDb)}`),
    measure: JSON.stringify(captures.at(-1)?.m ?? null),
    composition: JSON.stringify(volume.lastComposition),
    queries,
    inZone,
    different,
  };
}

function check(c: Case): void {
  const now = signal(c, false);
  const before = signal(c, true);
  // la referencia de verdad sustituyó a la consulta, y la puerta está en una unión: hay socios que consultar
  expect(before.queries, `${c.name}: consultas`).toBeGreaterThan(10_000);
  expect(before.inZone, `${c.name}: consultas con un socio cerca`).toBeGreaterThan(1000);
  // cada consulta devuelve el mismo arco, bit a bit (la señal sola no lo garantiza: un arco algo distinto rara vez cambia de
  // tubo a un glóbulo en un segundo)
  expect(before.different, `${c.name}: consultas con otro arco`).toBe(0);
  expect(now.samples, c.name).toBeGreaterThan(2500);
  expect(now.spectrum.length, c.name).toBeGreaterThan(10);
  expect(now.iq === before.iq, `${c.name}: muestras IQ`).toBe(true);
  expect(now.spectrum, `${c.name}: espectro`).toEqual(before.spectrum);
  expect(now.measure, `${c.name}: medida`).toBe(before.measure);
  expect(now.composition, `${c.name}: composición de la puerta`).toBe(before.composition);
}

const REFERENCE_ADULT: Case[] = [
  {
    name: 'porta, congestión grave en apnea',
    base: SEVERE_CONGESTION,
    resp: 'apnea-expiratory',
    window: 'portalTrunk',
    vessels: ['pvTrunk'],
    kind: 'portal',
  },
  {
    name: 'porta, sano respirando',
    base: NORMAL_ADULT,
    resp: 'quiet',
    window: 'portalTrunk',
    vessels: ['pvTrunk'],
    kind: 'portal',
  },
];
const S0028: Case[] = [
  {
    name: 'porta subcostal, congestión grave en apnea',
    base: SEVERE_CONGESTION,
    resp: 'apnea-expiratory',
    window: 'portalSubcostal',
    vessels: ['pvTrunk'],
    kind: 'portal',
  },
  {
    name: 'porta subcostal, sano respirando',
    base: NORMAL_ADULT,
    resp: 'quiet',
    window: 'portalSubcostal',
    vessels: ['pvTrunk'],
    kind: 'portal',
  },
  {
    name: 'interlobar, congestión grave en apnea',
    base: SEVERE_CONGESTION,
    resp: 'apnea-expiratory',
    window: 'renal',
    vessels: ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'],
    kind: 'renal',
  },
];

describe('la consulta del dominio en las uniones da la misma señal que la de antes (decisión 416)', () => {
  describe('adulto de referencia', () => {
    for (const c of REFERENCE_ADULT) it(`${c.name}: mismas muestras IQ, espectro y medida`, () => check(c));
  });

  describe('s0028', () => {
    beforeAll(() => {
      loadS0028();
    }, 60_000);
    for (const c of S0028) it(`${c.name}: mismas muestras IQ, espectro y medida`, () => check(c));
  });
});
