import { describe, expect, it } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { VENOUS_HISTORY_S, VenousSpectralAcquisition, venousCatchUpBatch, venousMeasurementBeats } from '../app/venousSpectral';
import { NORMAL_ADULT } from '../cases';
import { captureProtocolVessel } from '../doppler/capture';
import { CAPTURE_BEATS } from '../doppler/measureQuality';
import { SPECTRAL_CAPTURE_SECONDS } from '../doppler/spectral';
import { PhysiologyEngine } from '../physiology/engine';
import { VENOUS_COMPARISON_CHANNELS } from '../physiology/venousComparison';
import { DEFAULT_BMODE } from '../ultrasound/renderer';
import { loadS0028Fixture } from './support/legacyPerson/loadS0028Fixture';

const patient = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
/** El visor envuelve su instantánea de latidos igual que aquí (`#drawSpectra`). */
const snapshotRhythm = (engine: PhysiologyEngine) => {
  const beats = venousMeasurementBeats(engine.rhythm, engine.clock.t);
  return { beatsBetween: (t0: number, t1: number) => beats.filter((b) => b.tR >= t0 && b.tR + b.rr <= t1) };
};

describe('visor venoso PW en un equipo lento', () => {
  it('la instantánea de latidos sirve a cualquier captura que termine dentro del historial, no solo en el reloj vivo', () => {
    const engine = new PhysiologyEngine(patient, loadS0028Fixture().scene.vesselAreas());
    for (let i = 0; i < 250 * 20; i++) engine.step();
    const rhythm = snapshotRhythm(engine);
    for (let lag = 0; lag <= VENOUS_HISTORY_S; lag += 0.5) {
      const tNow = engine.clock.t - lag;
      expect(rhythm.beatsBetween(tNow - SPECTRAL_CAPTURE_SECONDS, tNow), `atraso ${lag} s`).toEqual(
        engine.rhythm.beatsBetween(tNow - SPECTRAL_CAPTURE_SECONDS, tNow),
      );
    }
  });

  it('a 6 cuadros/s se pone al día sin reiniciar la IQ y la medición no culpa a los latidos', () => {
    const { scene } = loadS0028Fixture();
    const engine = new PhysiologyEngine(patient, scene.vesselAreas());
    for (let i = 0; i < 250 * 8; i++) engine.step();
    const history = () => engine.samples.filter((s) => s.t >= engine.clock.t - VENOUS_HISTORY_S);
    const acquisition = new VenousSpectralAcquisition(
      new AnatomyQuery(scene),
      history()[0],
      patient.seed,
      patient,
      DEFAULT_BMODE,
      'venous',
      'standard',
      0,
    );
    const fps = 6,
      perFrame = 1 / (fps * engine.clock.dt);
    let processedT = -Infinity,
      previousT = Infinity,
      pending = 0,
      revision = -1,
      realTimeFrame = -1;
    // Como al abrir el visor: seis segundos de atraso y ~42 muestras nuevas por cuadro (más que un trozo de 32).
    for (let frame = 0; frame < fps * 20; frame++) {
      pending += perFrame;
      for (; pending >= 1; pending--) engine.step();
      const samples = history();
      const batch = venousCatchUpBatch(engine.samples, samples[0].t, processedT, previousT);
      acquisition.push(batch, engine.clock.dt);
      if (batch.length) processedT = batch.at(-1)!.t;
      previousT = engine.clock.t;
      // Un hueco en las muestras reinicia la cadena y cambia su revisión.
      if (frame === 0) revision = acquisition.chains[0].revision;
      expect(acquisition.chains[0].revision, `cuadro ${frame}: la IQ se reinició`).toBe(revision);
      if (realTimeFrame < 0 && samples.at(-1)!.t - processedT <= 0.2) realTimeFrame = frame;
    }
    const end = history().at(-1)!.t;
    expect(end - processedT).toBeLessThan(0.3);
    expect(realTimeFrame).toBeGreaterThanOrEqual(0);
    expect(realTimeFrame).toBeLessThan(fps * 10);
    const m = captureProtocolVessel(
      VENOUS_COMPARISON_CHANNELS[0].id,
      acquisition.chains[0].readCapture(),
      snapshotRhythm(engine),
      Math.min(end, processedT),
      { angleCorrectionRad: 0, invert: false },
      acquisition.gateTracks[0],
    );
    expect(m?.quality.issue).toBeNull();
    expect(m!.measuredBeats).toHaveLength(CAPTURE_BEATS);
  });
});
