// @tier slow
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bestGateOnVessel } from '../app/gatePlacement';
import { acousticWindowWeight } from '../app/gateTransmission';
import { VenousSpectralAcquisition } from '../app/venousSpectral';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { prfFromNyquistCms } from '../core/units';
import { DEFAULT_BMODE } from '../ultrasound/renderer';
import { measurePhysiologyTruth } from '../vexus/measurements';
import { setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { setAbdominalBody } from './support/legacyPerson/referenceBody';
import { setThoracicAtlas } from './support/legacyPerson/thoracicAtlas';
import { acquire, openSession, placeGate, probeAt, TR } from './support/studentChain';

const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
const profile = readFileSync('src/anatomy/abdominal-body.bin');
const thoracic = gunzipSync(readFileSync('src/anatomy/thoracic-atlas.gzip.bin'));
beforeEach(() => {
  setAbdominalAtlas(new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  setAbdominalBody(new Float32Array(profile.buffer.slice(profile.byteOffset, profile.byteOffset + profile.byteLength)));
  setThoracicAtlas(new Uint16Array(thoracic.buffer.slice(thoracic.byteOffset, thoracic.byteOffset + thoracic.byteLength)));
});
afterEach(() => {
  setAbdominalAtlas();
  setAbdominalBody();
  setThoracicAtlas();
});

describe('VExUS through the actual abdominal atlas', () => {
  for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION])
    it(`${patient.id}: el mismo plano renal permite puerta venosa medible y arteria acompañante`, () => {
      const s = openSession(patient, 'apnea-expiratory');
      while (s.engine.clock.t < 30) s.engine.step();
      const contact = probeAt(s, 'renal');
      const vein = placeGate(s, contact, ['interlobarVein1', 'interlobarVein2', 'interlobarVein3']);
      const weight = acousticWindowWeight(s.anatomy, contact.frame, TR, contact, s.engine.sample, 160, 2.5);
      const artery = bestGateOnVessel(
        s.anatomy,
        contact.frame,
        TR,
        s.engine.sample,
        ['interlobarArtery1', 'interlobarArtery2', 'interlobarArtery3'],
        145,
        0.2,
        weight,
      );
      expect(vein).not.toBeNull();
      expect(artery).not.toBeNull();
      const severe = patient.id === 'severe-congestion';
      const result = acquire(s, contact, vein!, 'renal', {
        prfHz: prfFromNyquistCms(severe ? 50 : 15, TR.f0Doppler),
        wallFilterHz: 20,
        focusMm: 90,
        seconds: 8,
      }).captures.at(-1)!.m;
      expect(result).not.toBeNull();
      expect(result!.quality.issue).toBeNull();
      expect(result!.pattern).toBe(severe ? 'monophasic' : 'continuous');
      // La puerta arterial es distinta; no convertir su energía en continuidad venosa.
      expect(Math.hypot(vein!.r - artery!.r, (vein!.theta - artery!.theta) * 130)).toBeGreaterThan(4);
    });
  // Decisión 447. La interlobar monofásica del grave (verdad S/D 0,22) a ±50 y a ±40, la escala del preajuste: la S medida es la
  // lectura del suelo de la banda o un bin más (3,1 cm/s) y, con D de 9,7–10,3 cm/s, S/D 0,30–0,32. Con estas semillas salía
  // «bifásica» con la calidad aprobada (28 de 98 aceptadas a ±50 y 12 de 37 a ±40) y el grado bajaba de 3 a 2.
  it('severe-congestion: a ±50 y ±40 una S en el suelo de la banda no hace bifásica la vena monofásica', () => {
    const rows: string[] = [];
    const patterns: Array<{ scale: number; pattern: string; issue: string | null }> = [];
    for (const [scale, seed] of [
      [50, 4],
      [50, 5],
      [50, 8],
      [40, 8],
      [40, 10],
      [40, 11],
    ] as const) {
      const s = openSession(SEVERE_CONGESTION, 'apnea-expiratory', seed);
      while (s.engine.clock.t < 30) s.engine.step();
      const contact = probeAt(s, 'renal');
      const vein = placeGate(s, contact, ['interlobarVein1', 'interlobarVein2', 'interlobarVein3']);
      expect(vein, `semilla ${seed}`).not.toBeNull();
      const m = acquire(s, contact, vein!, 'renal', {
        prfHz: prfFromNyquistCms(scale, TR.f0Doppler),
        wallFilterHz: 20,
        focusMm: 90,
        seconds: 8,
      }).captures.at(-1)!.m!;
      patterns.push({ scale, pattern: m.pattern, issue: m.quality.issue });
      rows.push(`±${scale} s${seed}: S ${m.sPeak.toFixed(2)} D ${m.dPeak.toFixed(2)} ${m.pattern} ${m.quality.issue}`);
    }
    const tag = rows.join('; ');
    expect(
      patterns.every((p) => p.issue === null),
      tag,
    ).toBe(true);
    expect(
      patterns.filter((p) => p.pattern === 'biphasic'),
      tag,
    ).toEqual([]);
    // a ±50 la S no sube del suelo: monofásica; a ±40 sube un bin, y el patrón se decide o queda sin resolver
    expect(
      patterns.filter((p) => p.scale === 50).every((p) => p.pattern === 'monophasic'),
      tag,
    ).toBe(true);
    expect(
      patterns.every((p) => ['monophasic', 'indeterminate'].includes(p.pattern)),
      tag,
    ).toBe(true);
  });
  // Decisión 447. Tras un diurético la interlobar del grave es bifásica (verdad S/D 0,36 y 0,31), pero a ±80 (bin 1,25 cm/s, suelo
  // 2,5) la S se lee en el suelo + 1 bin, 3,75 cm/s, con D 10: la misma lectura que la monofásica del grave (semilla 53, 0,22). Con
  // el intervalo de la S hasta el suelo (0,3·D = 3 > 2,5) las tres salían «monophasic»; hasta el suelo + ½ bin (3,125), sin resolver.
  it('severe-congestion tras un diurético: a ±80 la bifásica con la S en el suelo + 1 bin no sale monofásica', () => {
    for (const [ml, seed] of [
      [300, 0],
      [200, 14],
    ] as const) {
      const s = openSession(SEVERE_CONGESTION, 'apnea-expiratory', seed);
      s.engine.intervene({ kind: 'diuresis', volumeMl: ml });
      while (s.engine.clock.t < 30) s.engine.step();
      const contact = probeAt(s, 'renal');
      const vein = placeGate(s, contact, ['interlobarVein1', 'interlobarVein2', 'interlobarVein3']);
      expect(vein, `semilla ${seed}`).not.toBeNull();
      const m = acquire(s, contact, vein!, 'renal', {
        prfHz: prfFromNyquistCms(80, TR.f0Doppler),
        wallFilterHz: 20,
        focusMm: 90,
        seconds: 8,
      }).captures.at(-1)!.m!;
      const tNow = s.engine.clock.t;
      const truth = measurePhysiologyTruth(s.engine, { fromT: tNow - 7, toT: tNow });
      const tag = `${ml} mL, semilla ${seed}: S ${m.sPeak} D ${m.dPeak} ${m.pattern} ${m.quality.issue}; verdad ${truth.renalPattern} ${(truth.rvS / truth.rvD).toFixed(3)}`;
      expect(truth.renalPattern, tag).toBe('biphasic');
      expect(m.quality.issue, tag).toBeNull();
      expect(m.pattern, tag).not.toBe('monophasic');
      expect(['biphasic', 'indeterminate'], tag).toContain(m.pattern);
    }
  });
  for (const patient of [NORMAL_ADULT, SEVERE_CONGESTION])
    it(`${patient.id}: real hepatic, main portal and interlobar venous acoustic gates`, () => {
      const s = openSession(patient, 'apnea-expiratory');
      const a = new VenousSpectralAcquisition(s.anatomy, s.engine.sample, patient.seed, s.patient, DEFAULT_BMODE);
      const paired = new VenousSpectralAcquisition(
        s.anatomy,
        s.engine.sample,
        patient.seed,
        s.patient,
        DEFAULT_BMODE,
        'paired',
        'standard',
        2,
      );
      // Tras corregir el apoyo parietal, ambas adquisiciones deben conservar
      // una trayectoria acústica útil. 0,01 evita aceptar una puerta en sombra
      // (cota instrumental del simulador, no umbral clínico).
      expect(a.gateInfo[2].transmission).toBeGreaterThan(0.01);
      expect(paired.gateInfo[0].transmission).toBeGreaterThan(0.01);
      const depths = a.gateDepthsMm;
      expect(depths).toHaveLength(3);
      for (const d of depths) {
        expect(d).toBeGreaterThan(20);
        expect(d).toBeLessThan(175);
      }
      const history = Array.from({ length: 75 }, () => s.engine.step());
      const before = JSON.stringify(history);
      a.push(history, s.engine.clock.dt);
      paired.push(history, s.engine.clock.dt);
      expect(JSON.stringify(history)).toBe(before);
      for (const chain of a.chains) {
        expect(chain.sampleVolume.lastComposition.bloodFraction).toBeGreaterThan(0);
        expect(chain.spectral.columns.length).toBeGreaterThan(0);
      }
      expect(
        Object.keys(paired.chains[0].sampleVolume.lastComposition.vessels).some((id) =>
          ['interlobarArtery1', 'interlobarArtery2', 'interlobarArtery3'].includes(id),
        ),
      ).toBe(true);
      for (const [i, ids] of [['hvRight'], ['pvTrunk'], ['interlobarVein1', 'interlobarVein2', 'interlobarVein3']].entries()) {
        expect(Object.keys(a.chains[i].sampleVolume.lastComposition.vessels).some((id) => ids.includes(id))).toBe(true);
      }
    });
});
