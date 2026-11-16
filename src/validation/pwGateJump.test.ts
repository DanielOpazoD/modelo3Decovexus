import { expect, it } from 'vitest';
import { pwGate } from '../app/pwGate';
import { SEVERE_CONGESTION } from '../cases';
import { PwDopplerChain } from '../doppler/pwChain';
import { openSession, placeGate, probeAt, PROFILE } from './support/studentChain';

/**
 * Colocar o mover la puerta resiembra la población del volumen de muestra (decisión 404). Antes la saliente desaparecía de un
 * pulso al siguiente: el eco del tejido (40 dB sobre la sangre) daba un escalón que el filtro de pared dejaba pasar como una banda
 * de +20 a +41 dB en todo el espectro durante ~45 ms (la línea blanca al colocar la puerta). Con el relevo en fundido no hay banda.
 */
it('mover la puerta del parénquima a la porta no deja una banda de banda ancha en el espectro', () => {
  const s = openSession(SEVERE_CONGESTION, 'apnea-expiratory');
  const contact = probeAt(s, 'portalTrunk');
  const best = placeGate(s, contact, ['pvTrunk'])!;
  expect(best).not.toBeNull();
  const chain = new PwDopplerChain(s.anatomy, 7);
  const dt = s.engine.clock.dt;
  let t = 0;
  const run = (cursor: { theta: number; depthMm: number }, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      const sample = s.engine.step();
      chain.begin(2597, PROFILE.dopplerEffectiveMHz * 1e6, 0, 20, sample.t);
      chain.setGate(pwGate(s.anatomy, contact.frame, contact, PROFILE, 90, { ...cursor, gateMm: 4 }, sample).gate, sample);
      chain.step(sample, [0, 0, 0], dt);
      chain.flush();
      t = sample.t;
    }
  };
  run({ theta: best.theta + 0.15, depthMm: best.r - 25 }, 0.8);
  const jump = t;
  run({ theta: best.theta, depthMm: best.r }, 0.8);
  // potencia lejos del flujo (|f| > 0,375·PRF) por columna, frente a su mediana tras el relevo
  const far = chain.spectral.columns.map((c) => {
    const N = c.powerDb.length;
    let sum = 0,
      n = 0;
    for (let k = 0; k < N; k++)
      if (Math.abs(k - N / 2) > 0.375 * N) {
        sum += 10 ** (c.powerDb[k] / 10);
        n++;
      }
    return { t: c.t, db: 10 * Math.log10(sum / n) };
  });
  const after = far
    .filter((c) => c.t > jump + 0.3)
    .map((c) => c.db)
    .sort((a, b) => a - b);
  const median = after[after.length >> 1];
  const around = far.filter((c) => Math.abs(c.t - jump) < 0.08);
  expect(around.length).toBeGreaterThan(10);
  // Medido el 16-11-2026 en s0028: +4 dB como máximo (antes, +41).
  expect(Math.max(...around.map((c) => c.db)) - median).toBeLessThan(10);
});
