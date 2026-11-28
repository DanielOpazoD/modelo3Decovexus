import { describe, expect, it } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { AF_MODERATE_CONGESTION, NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { AORTA_MECHANICS, arterialCaliberAt } from '../physiology/arterialCaliber';
import { PhysiologyEngine, type PhysiologySample } from '../physiology/engine';
import type { VesselId } from '../physiology/vessels';
import { AnatomyScene } from './support/legacyPerson/scene';

/**
 * Velocidad en el eje de las arterias del adulto sano en apnea frente a publicaciones (decisión 297): media ± 1 DE, salvo donde se dice.
 * Gao et al. 2011 (10 sanos, ángulo corregido), Madubueze y Ugwa 2018 (150 controles), Baumgartner et al. 1999 (21 voluntarios, rango
 * observado; 102 ± 37 es ± 2 DE), EFSUMB Course Book (47 sanos, fuente secundaria). No es validación clínica.
 */
describe('arterias del adulto sano frente a valores publicados', () => {
  const patient = { ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' as const };
  const scene = new AnatomyScene(patient);
  const areas = scene.vesselAreas();
  const engine = new PhysiologyEngine(patient, areas);
  for (let i = 0; i < 2500; i++) engine.step();
  const ids: VesselId[] = [
    'interlobarArtery1',
    'renalArteryRight',
    'aorta',
    'commonHepaticArtery',
    'hepaticArtery',
    'celiacTrunk',
    'splenicArtery',
    'leftGastricArtery',
    'sma',
  ];
  const seen = new Map(ids.map((id) => [id, { max: -Infinity, min: Infinity, sum: 0 }]));
  let sumNetwork = 0;
  let sumShown = 0;
  const steps = 7500;
  for (let i = 0; i < steps; i++) {
    const s = engine.step();
    for (const id of ids) {
      const v = seen.get(id)!;
      const cms = s.velocities[id] / 10;
      v.max = Math.max(v.max, cms);
      v.min = Math.min(v.min, cms);
      // Caudal con el área del instante: la aorta ya no tiene calibre fijo (decisión 314).
      const areaScale = id === 'aorta' ? s.aortaRadiusScale ** 2 : 1;
      v.sum += (cms * areas[id] * areaScale) / 100;
    }
    sumNetwork += s.qRenalArtery / 2;
    sumShown += (s.velocities.renalArteryRight * areas.renalArteryRight) / 1000;
  }
  /** Máximo del perfil (n + 2)/n sobre la media de la sección. */
  const center = (id: VesselId) => {
    const def = scene.vesselById.get(id);
    return def ? (def.profileN + 2) / def.profileN : 1.5;
  };
  const psv = (id: VesselId) => seen.get(id)!.max * center(id);
  const low = (id: VesselId) => seen.get(id)!.min * center(id);
  const meanFlow = (id: VesselId) => seen.get(id)!.sum / steps;

  it('interlobar: sistólica, mínimo e IR en el intervalo de los controles', () => {
    expect(psv('interlobarArtery1')).toBeGreaterThan(30.11 - 5.18);
    expect(psv('interlobarArtery1')).toBeLessThan(30.11 + 5.18);
    expect(low('interlobarArtery1')).toBeGreaterThan(12.69 - 2.17);
    expect(low('interlobarArtery1')).toBeLessThan(12.69 + 2.17);
    const ri = 1 - low('interlobarArtery1') / psv('interlobarArtery1');
    expect(ri).toBeGreaterThan(0.55);
    expect(ri).toBeLessThan(0.63);
  });

  it('renal principal: sistólica y mínimo en el intervalo de los controles', () => {
    expect(psv('renalArteryRight')).toBeGreaterThan(79.07 - 8.22);
    expect(psv('renalArteryRight')).toBeLessThan(79.07 + 8.22);
    expect(low('renalArteryRight')).toBeGreaterThan(29.02 - 4.93);
    expect(low('renalArteryRight')).toBeLessThan(29.02 + 4.93);
  });

  it('el Doppler renal muestra otro pulso que la red, con el mismo caudal medio', () => {
    expect(sumShown / sumNetwork).toBeGreaterThan(0.99);
    expect(sumShown / sumNetwork).toBeLessThan(1.01);
  });

  it('aorta: sistólica en su intervalo y caudal entre el de sus ramas y el gasto', () => {
    expect(psv('aorta')).toBeGreaterThan(102 - 18.5);
    expect(psv('aorta')).toBeLessThan(102 + 18.5);
    const branches = 2 * meanFlow('renalArteryRight') + meanFlow('celiacTrunk') + meanFlow('sma');
    expect(meanFlow('aorta')).toBeGreaterThan(branches);
    expect(meanFlow('aorta')).toBeLessThan(83);
    // al final de la diástole sigue bajando lo que se llevan las ramas, sin detener toda la aorta
    expect(low('aorta')).toBeGreaterThan(5);
  });

  it('el celíaco reparte sus ramas y la hepática común alimenta a la propia, también tras un bolo', () => {
    expect(meanFlow('celiacTrunk')).toBeCloseTo(
      meanFlow('commonHepaticArtery') + meanFlow('splenicArtery') + meanFlow('leftGastricArtery'),
      6,
    );
    const e = new PhysiologyEngine(patient, areas);
    for (let i = 0; i < 500; i++) e.step();
    expect(e.intervene({ kind: 'bolus', volumeMl: 1500 })).not.toBeNull();
    for (let i = 0; i < 5000; i++) {
      const s = e.step();
      expect(s.velocities.commonHepaticArtery * areas.commonHepaticArtery).toBeGreaterThan(
        s.velocities.hepaticArtery * areas.hepaticArtery,
      );
    }
  });

  // con el pulso centrado en su media; antes, sin centrar, se separaba hasta un 1,5 % y la cota era ±2 %
  it.each([50, 120])('el Doppler renal conserva el caudal medio de la red a %i lpm, a ±0,5 %%', (heartRateBpm) => {
    const e = new PhysiologyEngine({ ...patient, heartRateBpm }, areas);
    for (let i = 0; i < 2500; i++) e.step();
    let network = 0;
    let shown = 0;
    for (let i = 0; i < 7500; i++) {
      const s = e.step();
      network += s.qRenalArtery / 2;
      shown += (s.velocities.renalArteryRight * areas.renalArteryRight) / 1000;
    }
    expect(shown / network).toBeGreaterThan(0.995);
    expect(shown / network).toBeLessThan(1.005);
  });

  it.each([
    ['50 lpm', { ...NORMAL_ADULT, heartRateBpm: 50 }],
    ['70 lpm', NORMAL_ADULT],
    ['120 lpm', { ...NORMAL_ADULT, heartRateBpm: 120 }],
    ['FA', AF_MODERATE_CONGESTION],
  ] as const)('%s: la media causal que acompaña al pulso es la suya sobre latidos enteros', (_, base) => {
    // antes, la media de cada latido sobre su RR, que exigía la R siguiente; ahora la media móvil causal del motor
    const e = new PhysiologyEngine(base, areas);
    const pulseMean = () => (e as unknown as { pulseMean: number }).pulseMean;
    let index = -1;
    let start = 0;
    let pending = 0;
    let pendingN = 0;
    let sum = 0;
    let n = 0;
    while (e.clock.t < 65) {
      const s = e.step();
      if (s.beatIndex !== index) {
        if (start > 5) {
          sum += pending;
          n += pendingN;
        }
        [index, start, pending, pendingN] = [s.beatIndex, s.t, 0, 0];
      }
      pending += arterialCaliberAt({ t: s.t, beats: e.rhythm.beatsAround(s.t), mechanics: AORTA_MECHANICS }).pulse - pulseMean();
      pendingN++;
    }
    // el pulso crudo no tiene media cero fuera de ≈ 75 lpm (−0,054 a 50 lpm, +0,080 a 120); lo que entra en la red es p − p̄
    expect(n).toBeGreaterThan(10000);
    expect(Math.abs(sum / n)).toBeLessThan(1e-3);
  });

  it('la FC sola no mueve los caudales medios de la red: el pulso entra en ella centrado en su media', () => {
    const run = (heartRateBpm: number) => {
      const e = new PhysiologyEngine({ ...patient, heartRateBpm, rrVariability: 0 }, areas, { historySeconds: 40 });
      while (e.clock.t < 40) e.step();
      const beats = e.rhythm.beatsBetween(10, 40);
      const t0 = beats[0].tR;
      const t1 = beats.at(-1)!.tR + beats.at(-1)!.rr;
      const w = e.samples.filter((s) => s.t >= t0 && s.t < t1);
      const mean = (get: (s: PhysiologySample) => number) => w.reduce((a, s) => a + get(s), 0) / w.length;
      return {
        hepaticArtery: mean((s) => s.qHepaticArtery),
        renalArtery: mean((s) => s.qRenalArtery),
        venousReturn: mean((s) => s.qHepaticVein + s.qIvcToRa) / e.circulation.state.cardiacOutputMlS,
      };
    };
    const ref = run(70);
    // antes: arteria hepática −5 % y +10 %, retorno venoso / gasto del lazo 0,999 y 1,054 frente a 1,017
    for (const bpm of [50, 120]) {
      const r = run(bpm);
      expect(Math.abs(r.hepaticArtery / ref.hepaticArtery - 1), `${bpm} lpm`).toBeLessThan(0.01);
      expect(Math.abs(r.renalArtery / ref.renalArtery - 1), `${bpm} lpm`).toBeLessThan(0.01);
      expect(Math.abs(r.venousReturn - ref.venousReturn), `${bpm} lpm`).toBeLessThan(0.01);
    }
  });

  it('FA: el pico sistólico de la hepática y de la renal no sigue a la pausa que viene', () => {
    const p = { ...AF_MODERATE_CONGESTION, respiratoryPattern: 'apnea-expiratory' as const };
    const e = new PhysiologyEngine(p, new AnatomyScene(p).vesselAreas());
    const beats = new Map<number, { rr: number; hepatic: number; renal: number }>();
    while (e.clock.t < 70) {
      const s = e.step();
      if (s.t < 10) continue;
      const b = beats.get(s.beatIndex) ?? { rr: s.rr, hepatic: -Infinity, renal: -Infinity };
      b.hepatic = Math.max(b.hepatic, s.velocities.hepaticArtery);
      b.renal = Math.max(b.renal, s.velocities.renalArteryRight);
      beats.set(s.beatIndex, b);
    }
    const rows = [...beats.values()].slice(1, -1);
    const corr = (x: number[], y: number[]) => {
      const mx = x.reduce((a, v) => a + v, 0) / x.length;
      const my = y.reduce((a, v) => a + v, 0) / y.length;
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      for (let i = 0; i < x.length; i++) {
        sxy += (x[i] - mx) * (y[i] - my);
        sxx += (x[i] - mx) ** 2;
        syy += (y[i] - my) ** 2;
      }
      return sxy / Math.sqrt(sxx * syy);
    };
    expect(rows.length).toBeGreaterThan(80);
    // con la media de cada latido sobre su RR, 0,87: el latido que precedía a una pausa larga daba un 25–35 % más
    expect(
      Math.abs(
        corr(
          rows.map((r) => r.hepatic),
          rows.map((r) => r.rr),
        ),
      ),
    ).toBeLessThan(0.3);
    expect(
      Math.abs(
        corr(
          rows.map((r) => r.renal),
          rows.map((r) => r.rr),
        ),
      ),
    ).toBeLessThan(0.3);
  });

  it.each([NORMAL_ADULT, SEVERE_CONGESTION])('$id: el campo de velocidades da a las arterias el máximo de su perfil en el eje', (base) => {
    const anatomyScene = new AnatomyScene(base);
    const anatomy = new AnatomyQuery(anatomyScene);
    const e = new PhysiologyEngine(base, anatomyScene.vesselAreas());
    const s = e.step();
    let measured = 0;
    for (const [id, axis] of [
      ['interlobarArtery1', 1.5],
      ['hepaticArtery', 1.5],
      ['renalArteryRight', 1.25],
    ] as const) {
      const nodes = anatomyScene.vesselById.get(id)!.tube.nodes;
      const q = anatomy.classifyMaterial(nodes[1].p, s);
      if (q.vessel !== id) continue;
      const speed = Math.hypot(...q.bloodVelocity!);
      expect(speed / Math.abs(s.velocities[id])).toBeCloseTo(axis, 3);
      measured++;
    }
    expect(measured).toBeGreaterThan(0);
  });

  it('hepáticas, celíaco y mesentérica: sistólica en el intervalo de la fuente secundaria', () => {
    for (const [id, mean, sd] of [
      ['commonHepaticArtery', 102, 46],
      ['hepaticArtery', 58, 34],
      ['celiacTrunk', 137, 45],
      ['sma', 145, 42],
    ] as const) {
      expect(psv(id), id).toBeGreaterThan(mean - sd);
      expect(psv(id), id).toBeLessThan(mean + sd);
    }
  });
});
