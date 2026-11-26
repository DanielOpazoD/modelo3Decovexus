import { expect, it } from 'vitest';
import { AF_MODERATE_CONGESTION, NORMAL_ADULT } from '../cases';
import { PhysiologyEngine, type PhysiologySample } from '../physiology/engine';
import type { PatientState } from '../physiology/patientState';
import { AnatomyScene } from './support/legacyPerson/scene';

/**
 * Causalidad del latido (misión, objetivo 1): ninguna señal del motor depende de la pausa que viene. Dos motores iguales
 * salvo la pausa que sigue a un latido, 0,25 s más larga en uno, deben coincidir hasta que empieza el latido siguiente: su
 * P en sinusal y, en FA, su R, que nada anuncia. Las ondas gaussianas de ese latido empiezan a asomar antes de su R; 0,25 s
 * antes pesan menos de 1e-4 de cada señal. `rr` y `cardiacPhase` rotulan el intervalo del latido (contrato de `Beat`).
 */
const INDEX = 16;
const ONSET_TAILS_S = 0.25;

function run(base: PatientState, extra: number): PhysiologyEngine {
  const e = new PhysiologyEngine(base, new AnatomyScene(base).vesselAreas(), { historySeconds: 30 });
  // el latido INDEX aún no está programado: su sorteo es el único que cambia
  const rhythm = e.rhythm as unknown as { nextRR(s?: number): number; nextIndex: number };
  const draw = rhythm.nextRR.bind(rhythm);
  rhythm.nextRR = (s) => draw(s) + (rhythm.nextIndex === INDEX ? extra : 0);
  while (e.clock.t < 20) e.step();
  return e;
}

function signals(s: PhysiologySample): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (o: object, prefix: string) => {
    for (const [k, v] of Object.entries(o))
      if (typeof v === 'number') out.set(prefix + k, v);
      else if (v && typeof v === 'object') walk(v as object, `${prefix}${k}.`);
  };
  walk(s, '');
  out.delete('rr');
  out.delete('cardiacPhase');
  return out;
}

it.each([AF_MODERATE_CONGESTION, NORMAL_ADULT])(
  '$id: alargar la pausa que sigue a un latido no cambia ninguna señal antes del latido siguiente',
  (base) => {
    const a = run(base, 0);
    const b = run(base, 0.25);
    const beats = a.rhythm.beatsBetween(0, 20);
    const k = beats.find((x) => x.index === INDEX)!;
    const next = beats.find((x) => x.index === INDEX + 1)!;
    expect(k.tR).toBeGreaterThan(6);
    expect(b.rhythm.beatsBetween(0, 20).find((x) => x.index === INDEX)!.rr).toBeCloseTo(k.rr + 0.25, 12);
    const end = (Number.isFinite(next.tP) ? next.tP : next.tR) - ONSET_TAILS_S;
    expect(end - k.tR).toBeGreaterThan(0.15);
    const diverged = new Set<string>();
    let compared = 0;
    for (let i = 0; i < a.samples.length; i++) {
      const sa = a.samples[i];
      expect(b.samples[i].t).toBe(sa.t);
      if (sa.t < k.tR || sa.t >= end) continue;
      const vb = signals(b.samples[i]);
      for (const [key, v] of signals(sa)) if (!(Math.abs(vb.get(key)! - v) <= 1e-4 * (1 + Math.abs(v)))) diverged.add(key);
      compared++;
    }
    expect(compared).toBeGreaterThan(30);
    expect([...diverged]).toEqual([]);
    // y la pausa sí cambia el latido siguiente: la eyección que en un motor ya empezó, en el otro aún no
    const at = a.samples.findIndex((s) => s.t > next.tR + 0.12);
    expect(Math.abs(b.samples[at].velocities.aorta - a.samples[at].velocities.aorta)).toBeGreaterThan(100);
  },
);
