import { describe, expect, it } from 'vitest';
import { assessQuality, bloodInColumn, outerBandExcessDb, qualityText, wavesInconsistent } from '../doppler/measureQuality';
import type { SpectralColumn } from '../doppler/spectral';
import type { Beat } from '../physiology/rhythm';

/**
 * Control de calidad de la captura PW (base A.4: «no medible» nunca es normal), con espectros
 * sintéticos: suelo de ruido de −60 dB con moteado y, cuando hay sangre, una banda 30 dB por encima.
 */
const N = 128;
const PRF = 4000;
const DT = 0.006;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** `band(t)` devuelve los bins [k0, k1) con sangre en el instante t, o null. */
function columns(seconds: number, band: (t: number) => [number, number] | null, seed = 1): SpectralColumn[] {
  const r = rng(seed);
  const out: SpectralColumn[] = [];
  for (let t = 0; t < seconds; t += DT) {
    const p = new Float32Array(N);
    for (let k = 0; k < N; k++) p[k] = -60 + 6 * (r() - 0.5);
    const b = band(t);
    if (b) for (let k = b[0]; k < b[1]; k++) p[k] = -30 + 3 * (r() - 0.5);
    out.push({ t, prfHz: PRF, powerDb: p });
  }
  return out;
}

const beats: Beat[] = Array.from({ length: 5 }, (_, i) => ({ tR: 0.5 + i * 0.8, rr: 0.8 }) as Beat);
const venous: [number, number] = [N / 2 + 12, N / 2 + 20]; // ≈ 375–625 Hz, hacia la sonda

describe('Calidad de la captura PW', () => {
  it('una banda arterial opuesta sin plegado no demuestra aliasing en el lado venoso vacío', () => {
    // 1125–1500 Hz < Nyquist 2000 Hz, lejos de ambos bordes: sólo hay flujo positivo.
    const cols = columns(5, () => [100, 113]);
    const q = assessQuality(cols, beats, { wallFilterHz: 25, side: 'neg', receiverNoiseDb: -60 });
    expect(outerBandExcessDb(cols, -60)).toBeGreaterThan(3);
    expect(outerBandExcessDb(cols, -60, 'neg')).toBeLessThan(3);
    expect(q.edgeEnergyFraction).toBe(0);
    expect(q.wrappedBeats).toBe(0);
    expect(q.issue).toBe('no-signal');
    expect(assessQuality(cols, beats, { wallFilterHz: 25, side: 'neg' }).issue).toBe('no-signal');
  });

  it('conserva el detector de banda llena sobre ruido en cada lado y su valor original por defecto', () => {
    // Control del fallback calibrado: banda amplia sin contraste respecto de su propio suelo.
    const filled = columns(5, () => null).map((c) => ({ ...c, powerDb: new Float32Array(N).fill(-52) }));
    for (const side of ['both', 'pos', 'neg'] as const) {
      expect(outerBandExcessDb(filled, -60, side)).toBeCloseTo(8, 12);
      const q = assessQuality(filled, beats, { wallFilterHz: 25, side, receiverNoiseDb: -60 });
      expect(q.wrappedBeats).toBe(0);
      expect(q.issue).toBe('aliasing');
    }
    expect(outerBandExcessDb(filled, -60)).toBe(outerBandExcessDb(filled, -60, 'both'));
    const empty = columns(5, () => null);
    for (const side of ['both', 'pos', 'neg'] as const)
      expect(assessQuality(empty, beats, { wallFilterHz: 25, side, receiverNoiseDb: -60 }).issue).toBe('no-signal');
  });

  it('la envoltura que ocupa ambos bordes sigue detectable al medir un solo lado', () => {
    const wrapped = columns(5, () => [N - 4, N]).map((c) => {
      const powerDb = Float32Array.from(c.powerDb);
      powerDb.fill(-30, 0, 4);
      return { ...c, powerDb };
    });
    for (const side of ['pos', 'neg'] as const) {
      const q = assessQuality(wrapped, beats, { wallFilterHz: 25, side, receiverNoiseDb: -60 });
      expect(q.wrappedBeats).toBe(5);
      expect(q.issue).toBe('aliasing');
    }
  });

  it('flujo estable en todos los latidos: medible', () => {
    const q = assessQuality(
      columns(5, () => venous),
      beats,
      { wallFilterHz: 25 },
    );
    expect(q.issue).toBeNull();
    expect(q.validBeats).toBe(5);
  });

  it('solo ruido (puerta fuera del vaso o sin contacto): sin señal', () => {
    expect(
      assessQuality(
        columns(5, () => null),
        beats,
        { wallFilterHz: 25 },
      ).issue,
    ).toBe('no-signal');
  });

  it('el clutter residual junto a 0 Hz no es sangre', () => {
    const clutter: [number, number] = [N / 2 - 1, N / 2 + 2];
    expect(
      assessQuality(
        columns(5, () => clutter),
        beats,
        { wallFilterHz: 25 },
      ).issue,
    ).toBe('no-signal');
  });

  it('el vaso sale de la puerta en un latido (respiración): intermitente', () => {
    const q = assessQuality(
      columns(5, (t) => (t > 2.1 && t < 2.9 ? null : venous)),
      beats,
      { wallFilterHz: 25 },
    );
    expect(q.issue).toBe('intermittent');
    expect(q.validBeats).toBe(4);
  });

  it('sangre solo en parte de cada ciclo (el vaso cruza la puerta al respirar): intermitente, no sin señal', () => {
    // la vena pasa por la puerta un 30 % de cada latido: ningún latido vale, pero hay flujo
    const q = assessQuality(
      columns(5, (t) => ((((t - 0.5) % 0.8) + 0.8) % 0.8 < 0.24 ? venous : null)),
      beats,
      { wallFilterHz: 25 },
    );
    expect(q.validBeats).toBe(0);
    expect(q.bloodColumns).toBeGreaterThan(0.2);
    expect(q.issue).toBe('intermittent');
  });

  it('un pico que rebasa ±Nyquist reaparece por el otro lado: aliasing aunque la energía en los bordes sea poca', () => {
    // 60 ms de cada latido la sangre llena de +0 a +Nyquist y sigue desde −Nyquist (el pico S plegado)
    const sPeak = (t: number) => (((t - 0.5) % 0.8) + 0.8) % 0.8 < 0.06;
    const cols = columns(5, (t) => (sPeak(t) ? [N / 2 + 2, N] : venous)).map((c) => {
      if (!sPeak(c.t)) return c;
      const p = Float32Array.from(c.powerDb);
      for (let k = 0; k < 6; k++) p[k] = -30;
      return { ...c, powerDb: p };
    });
    const q = assessQuality(cols, beats, { wallFilterHz: 25 });
    expect(q.edgeEnergyFraction).toBeLessThan(0.25);
    expect(q.wrappedBeats).toBe(5);
    expect(q.issue).toBe('aliasing');
  });

  it('una onda que roza un solo borde (escala justa) no es aliasing', () => {
    const peak = (t: number) => (((t - 0.5) % 0.8) + 0.8) % 0.8 < 0.12;
    const q = assessQuality(
      columns(5, (t) => (peak(t) ? [N / 2 + 2, N] : venous)),
      beats,
      { wallFilterHz: 25 },
    );
    expect(q.wrappedBeats).toBe(0);
    expect(q.issue).toBeNull();
  });

  it('un latido sin espectro que lo cubra no cuenta: el PW recién encendido no es «intermitente»', () => {
    // el espectro empieza a los 2,5 s (se encendió el PW): los latidos anteriores no se juzgan
    const q = assessQuality(
      columns(5, () => venous).filter((c) => c.t >= 2.5),
      beats,
      { wallFilterHz: 25 },
    );
    expect(q.beats).toBe(2);
    expect(q.validBeats).toBe(2);
    expect(q.issue).toBe('few-beats');
  });

  it('con el filtro de pared alto el flujo por encima de su corte sigue contando', () => {
    // bins 76–86 ≈ 375–720 Hz a PRF 4000; filtro de pared a 300 Hz (antes se excluía hasta 750 Hz)
    const q = assessQuality(
      columns(5, () => [N / 2 + 10, N / 2 + 23]),
      beats,
      { wallFilterHz: 300 },
    );
    expect(q.issue).toBeNull();
  });

  it('la energía junto a ±Nyquist es aliasing', () => {
    const edge: [number, number] = [N - 8, N];
    expect(
      assessQuality(
        columns(5, () => edge),
        beats,
        { wallFilterHz: 25 },
      ).issue,
    ).toBe('aliasing');
  });

  it('en la interlobar se juzga el lado de la vena: la arteria del otro lado no cuenta', () => {
    const artery: [number, number] = [N / 2 - 30, N / 2 - 20];
    const cols = columns(5, () => artery);
    expect(assessQuality(cols, beats, { wallFilterHz: 25, side: 'neg' }).issue).toBeNull();
    expect(assessQuality(cols, beats, { wallFilterHz: 25, side: 'pos' }).issue).toBe('no-signal');
    expect(bloodInColumn(cols[0], { wallFilterHz: 25, side: 'pos' }).present).toBe(false);
  });

  it('menos de tres latidos: pocos latidos', () => {
    expect(
      assessQuality(
        columns(5, () => venous),
        beats.slice(0, 2),
        { wallFilterHz: 25 },
      ).issue,
    ).toBe('few-beats');
    // con el PW congelado no llegan más latidos: el texto dice cómo salir
    expect(qualityText({ issue: 'few-beats' })).toContain('si está congelada, reanude el PW');
  });

  // Picos por latido (cm/s, orientados) medidos en capturas reales de la cadena del alumno
  it('la S de la suprahepática cambia de dirección entre latidos: inconsistente', () => {
    // sano con respiración tranquila: la puerta fija mezcla la vena con otro vaso
    expect(wavesInconsistent([36, -13, -12], [20, 16, 6])).toBe(true);
    // FA con respiración tranquila: S pequeña pero anterógrada, y −4 en un latido contaminado
    expect(wavesInconsistent([12, -4, -4], [14, 12, 14])).toBe(true);
    // con sangre en todos los latidos (no es intermitente) la captura sigue sin valer
    const waves = { s: [36, -13, -12, 30, 33], d: [20, 16, 6, 18, 21] };
    expect(
      assessQuality(
        columns(5, () => venous),
        beats,
        { wallFilterHz: 25 },
        waves,
      ).issue,
    ).toBe('inconsistent');
  });

  it('una S invertida en todos los latidos (congestión grave) o casi nula no es inconsistente', () => {
    expect(wavesInconsistent([-10, -8, -11, -10], [28, 28, 26, 28])).toBe(false);
    expect(wavesInconsistent([11, 10, 8, 13], [15, 14, 13, 14])).toBe(false);
    // |S| < 25 % de D: el signo de una S casi nula no cuenta
    expect(wavesInconsistent([-2, 3, 1], [14, 15, 13])).toBe(false);
  });

  it('un latido con D invertida es otro vaso en la puerta: inconsistente aunque S no cambie', () => {
    // sano con respiración tranquila (puerta con ventana acústica): la mediana daba «grave»
    expect(wavesInconsistent([-36, -16, -9], [-7, 16, 12])).toBe(true);
  });

  // Hallazgo C10 de la revisión externa: una vena renal monofásica solo lleva flujo en diástole (la
  // mitad del ciclo o menos) y la regla «sangre en ≥ 60 % de las columnas del latido» la rechazaba
  // como intermitente aunque la puerta estuviera perfecta. Con la ventana de fase (la diastólica), el
  // latido vale si la sangre la cubre y se repite igual en todos; un latido distinto sigue siendo
  // intermitente.
  describe('hueco fisiológico que se repite en la misma fase (vena renal monofásica)', () => {
    const fullBeats = (rr: number, n: number): Beat[] =>
      Array.from({ length: n }, (_, i) => {
        const tR = 0.5 + i * rr;
        return {
          index: i,
          tR,
          rr,
          tP: tR - 0.15 * rr,
          tAtrialContraction: tR - 0.1 * rr,
          tX: tR + 0.225 * rr,
          tV: tR + 0.45 * rr,
          tY: tR + 0.625 * rr,
          tTend: tR + 0.45 * rr,
          systoleScale: Math.sqrt(rr / 0.8),
          atrialAmplitude: 1,
        };
      });
    const phase = (rr: number) => (t: number) => (((t - 0.5) % rr) + rr) % rr;
    // la ventana diastólica que usa la medición (`beatWindows`), con las fases de estos latidos
    const diastole = (b: Beat): [number, number] => {
      const s = b.systoleScale;
      return [b.tY - 0.07 * s, Math.min(b.tY + 0.22 * s, b.tR + b.rr - 0.02)];
    };
    for (const bpm of [75, 110]) {
      const rr = 60 / bpm;
      const beatsN = fullBeats(rr, 5);
      const seconds = 0.5 + 5 * rr + 0.1;
      // flujo solo en la segunda mitad de cada ciclo (diástole)
      const mono = columns(seconds, (t) => (phase(rr)(t) >= 0.5 * rr ? venous : null));
      it(`${bpm} lpm: flujo solo en diástole en todos los latidos es medible con la ventana de fase`, () => {
        expect(assessQuality(mono, beatsN, { wallFilterHz: 25, side: 'pos' }).issue).toBe('intermittent'); // sin ventana: la regla vieja
        const q = assessQuality(mono, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole });
        expect(q.issue).toBeNull();
        expect(q.validBeats).toBe(5);
      });
      it(`${bpm} lpm: un latido sin flujo en su diástole sigue siendo intermitente`, () => {
        const b2 = beatsN[2];
        const dropped = columns(seconds, (t) => (t >= b2.tR && t < b2.tR + rr ? null : phase(rr)(t) >= 0.5 * rr ? venous : null));
        expect(assessQuality(dropped, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole }).issue).toBe('intermittent');
      });
      it(`${bpm} lpm: la sangre solo en sístole no se acepta con la ventana diastólica`, () => {
        const sys = columns(seconds, (t) => (phase(rr)(t) < 0.3 * rr ? venous : null));
        expect(assessQuality(sys, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole }).issue).toBe('intermittent');
      });
    }
    it('con 4 latidos, la sístole perdida en 2 de ellos (reparto 2/2) no pasa: la mediana es la de los demás', () => {
      const rr = 60 / 70;
      const beats4 = fullBeats(rr, 4);
      // vena bifásica: S en su ventana sistólica y D en la diastólica; S desaparece en los latidos 0 y 2
      const sWin = (b: Beat): [number, number] => {
        const s = b.systoleScale;
        return [b.tX - 0.06 * s, b.tV - 0.02 * s];
      };
      const lostS = new Set([0, 2]);
      const cols = columns(0.5 + 4 * rr + 0.1, (t) => {
        const i = beats4.findIndex((b) => t >= b.tR && t < b.tR + b.rr);
        if (i < 0) return null;
        const b = beats4[i];
        const [s0, s1] = sWin(b);
        const [d0, d1] = diastole(b);
        if (t >= d0 - 0.03 && t <= d1) return venous;
        if (t >= s0 && t <= s1 && !lostS.has(i)) return venous;
        return null;
      });
      expect(assessQuality(cols, beats4, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole }).issue).toBe('intermittent');
    });

    it('sin sangre en la ventana por el plegado: aliasing antes que intermitente (con ventana de fase)', () => {
      const rr = 0.8;
      const beatsN = fullBeats(rr, 4);
      // como el grave a 2600 Hz: la vena cubre solo parte de su ventana diastólica y, en el pico de D,
      // 60 ms plegados (sangre en los dos bordes); ningún latido vale, pero la causa es el plegado
      const ph = phase(rr);
      const folded = (t: number) => ph(t) >= 0.55 && ph(t) < 0.61;
      const cols = columns(0.5 + 4 * rr + 0.1, (t) => (folded(t) ? [N / 2 + 2, N] : ph(t) >= 0.43 && ph(t) < 0.55 ? venous : null)).map(
        (c) => {
          if (!folded(c.t)) return c;
          const p = Float32Array.from(c.powerDb);
          for (let k = 0; k < 6; k++) p[k] = -30;
          return { ...c, powerDb: p };
        },
      );
      const q = assessQuality(cols, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole });
      expect(q.validBeats).toBe(0);
      expect(q.wrappedBeats).toBeGreaterThan(0);
      expect(q.issue).toBe('aliasing');
      // sin ventana de fase (suprahepática, porta) el orden no cambia
      expect(assessQuality(cols, beatsN, { wallFilterHz: 25, side: 'pos' }).issue).toBe('intermittent');
    });

    it('un latido con la mitad de flujo que los demás (la puerta pierde el vaso en parte): intermitente por no reproducirse', () => {
      const rr = 0.8;
      const beatsN = fullBeats(rr, 5);
      // flujo en la segunda mitad de cada ciclo; en el latido 1, además, en todo el ciclo (otro vaso entra)
      const odd = columns(4.7, (t) => (t >= beatsN[1].tR && t < beatsN[1].tR + rr ? venous : phase(rr)(t) >= 0.5 * rr ? venous : null));
      expect(assessQuality(odd, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole }).issue).toBe('intermittent');
    });

    // Decisión 446. Con la puerta quieta sobre la interlobar del grave en apnea, la presencia de la vena falta en su ventana
    // diastólica al principio (la onda D sube desde la banda del filtro de pared) y en desvanecimientos de 1–6 columnas
    // (moteado del espectro). La vena ocupa la puerta en todos los latidos, pero sumaban más del 20 % de la ventana en un
    // latido de cada 25–40 y la captura salía «intermitente» en el 10–16 % de las semillas. A 4000 Hz y 128 muestras, la
    // ventana de análisis dura 32 ms: un tramo más breve es una sola estimación del espectro que se desvanece, o el borde de
    // la onda que esa ventana no resuelve.
    it('un tramo sin sangre más breve que la ventana de análisis del espectro no hace intermitente la vena monofásica', () => {
      const rr = 0.8;
      const beatsN = fullBeats(rr, 5);
      const ph = phase(rr);
      // D desde 30 ms después del inicio de la ventana (0,43 s) en todos; en el latido 2, dos huecos de 24 ms en plena D
      const inBeat2 = (t: number) => t >= beatsN[2].tR && t < beatsN[2].tR + rr;
      const fade = (t: number) => inBeat2(t) && ((ph(t) >= 0.53 && ph(t) < 0.554) || (ph(t) >= 0.62 && ph(t) < 0.644));
      const cols = columns(0.5 + 5 * rr + 0.1, (t) => (ph(t) >= 0.46 && !fade(t) ? venous : null));
      const q = assessQuality(cols, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole });
      expect(q.issue).toBeNull();
      expect(q.validBeats).toBe(5);
    });

    it('un tramo sin sangre que dura más que la ventana de análisis en la diástole de un latido sigue siendo intermitente', () => {
      const rr = 0.8;
      const beatsN = fullBeats(rr, 5);
      const ph = phase(rr);
      // 66 ms (dos ventanas de análisis) sin la vena en plena D del latido 2: su fracción de sangre aún se repite
      const lost = (t: number) => t >= beatsN[2].tR && t < beatsN[2].tR + rr && ph(t) >= 0.55 && ph(t) < 0.616;
      const cols = columns(0.5 + 5 * rr + 0.1, (t) => (ph(t) >= 0.43 && !lost(t) ? venous : null));
      const q = assessQuality(cols, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole });
      expect(q.validBeats).toBe(4);
      expect(q.issue).toBe('intermittent');
    });

    // Decisión 446, tope del cierre: perdonar tramos breves vale para una vena que la estimación detecta casi siempre y se
    // desvanece a ratos. Una vena que solo aparece en 1 columna de cada 5 de su ventana diastólica (el 20 % de la ventana,
    // el 7,5 % del latido) no se desvanece a ratos: está en el umbral de detección, y cada hueco de 4 columnas (24 ms) es
    // más breve que la ventana de análisis (32 ms). Sin el tope se cerraban todos y la captura era medible con 5 latidos.
    it('una vena que parpadea en una columna de cada cinco de su diástole no es medible', () => {
      const rr = 0.8;
      const beatsN = fullBeats(rr, 5);
      const ph = phase(rr);
      const cols = columns(0.5 + 5 * rr + 0.1, (t) => (ph(t) >= 0.43 && ph(t) <= 0.72 && Math.round(t / DT) % 5 === 0 ? venous : null));
      const q = assessQuality(cols, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole });
      expect(q.bloodColumns).toBeLessThan(0.1);
      expect(q.validBeats).toBe(0);
      expect(q.issue).toBe('no-signal');
    });

    // …y la resolución excusa como mucho una ventana de análisis por latido. Como la interlobar del grave con el ruido del
    // receptor ×3 (la vena siempre en la puerta): en un latido la vena está en 3 columnas de cada 5 de su diástole y en los
    // demás en 2 de cada 5. Cerrar todos los huecos de 2 columnas de ese latido lo hacía válido y la captura pasaba de «no hay
    // señal» a «intermitente», el mensaje que manda a buscar una puerta que no se ha movido.
    it('un latido suelto que parpadea en más de la mitad de su diástole no convierte «sin señal» en intermitente', () => {
      const rr = 0.8;
      const beatsN = fullBeats(rr, 5);
      const ph = phase(rr);
      const inBeat2 = (t: number) => t >= beatsN[2].tR && t < beatsN[2].tR + rr;
      const cols = columns(0.5 + 5 * rr + 0.1, (t) =>
        ph(t) >= 0.43 && ph(t) <= 0.72 && Math.round(t / DT) % 5 < (inBeat2(t) ? 3 : 2) ? venous : null,
      );
      const q = assessQuality(cols, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole });
      expect(q.bloodColumns).toBeLessThan(0.2);
      expect(q.validBeats).toBe(0);
      expect(q.issue).toBe('no-signal');
    });

    // Una banda venosa estrecha que rebasa el Nyquist no deja sangre en los dos bordes de una misma columna: llega al borde de su
    // lado, desaparece de él y reaparece entera en el borde opuesto. Como la interlobar del grave a ±20 cm/s (D axial 23 cm/s):
    // el hueco del pico de D dura menos que la ventana de análisis (decisión 446) y la captura salía medible, con D recortada.
    describe('la onda entera plegada en su ventana de fase', () => {
      const rr = 0.8;
      const beatsN = fullBeats(rr, 5);
      const ph = phase(rr);
      const ownEdge: [number, number] = [N - 8, N]; // ≥ 0,44·PRF, hacia la sonda
      const oppositeEdge: [number, number] = [0, 8]; // el mismo lado exterior, al otro lado del Nyquist
      // `band(fase)`: los bins con sangre, 'none' sin ella o null para la vena de siempre (desde 0,43 del ciclo)
      const capture = (band: (p: number) => [number, number] | 'none' | null) =>
        columns(0.5 + 5 * rr + 0.1, (t) => {
          const b = band(ph(t));
          return b === 'none' ? null : (b ?? (ph(t) >= 0.43 ? venous : null));
        });
      const quality = (cols: SpectralColumn[]) => assessQuality(cols, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole });

      it('llega a su borde, desaparece de su lado y reaparece en el borde opuesto: aliasing, no medible', () => {
        const cols = capture((p) =>
          p >= 0.54 && p < 0.56 ? ownEdge : p >= 0.56 && p < 0.584 ? oppositeEdge : p >= 0.584 && p < 0.6 ? ownEdge : null,
        );
        expect(cols.some((c) => bloodInColumn(c, { wallFilterHz: 25 }).wrapped)).toBe(false);
        const q = quality(cols);
        expect(q.wrappedBeats).toBe(5);
        expect(q.issue).toBe('aliasing');
      });

      it('llega a su borde y vuelve por él sin sangre de su lado en medio: aliasing', () => {
        const cols = capture((p) =>
          p >= 0.54 && p < 0.56 ? ownEdge : p >= 0.56 && p < 0.584 ? 'none' : p >= 0.584 && p < 0.6 ? ownEdge : null,
        );
        expect(quality(cols).issue).toBe('aliasing');
      });

      it('en su borde con un desvanecimiento de una columna, o con la arteria de enfrente en su borde y la vena lejos del suyo: medible', () => {
        const fade = capture((p) =>
          p >= 0.54 && p < 0.56 ? ownEdge : p >= 0.56 && p < 0.566 ? 'none' : p >= 0.566 && p < 0.58 ? ownEdge : null,
        );
        expect(quality(fade).issue).toBeNull();
        const artery = capture((p) => (p >= 0.56 && p < 0.584 ? oppositeEdge : null));
        const q = quality(artery);
        expect(q.wrappedBeats).toBe(0);
        expect(q.issue).toBeNull();
      });
    });

    // A ±15 cm/s (PRF ≈ 974 Hz) la ventana de análisis dura 131 ms y la diástole apenas abarca dos: una ventana excusada es
    // casi la mitad de la de fase. Sin exigir la vena en al menos la mitad de su ventana, una vena que está en 2 columnas de
    // cada 5 llegaba al 80 % y la captura era medible (en la cadena, un latido con la vena fuera de la puerta, peso 0, valía).
    it('a escala baja, una vena que está en menos de la mitad de su diástole no es medible', () => {
      const rr = 0.8;
      const beatsN = fullBeats(rr, 5);
      const ph = phase(rr);
      const cols = columns(0.5 + 5 * rr + 0.1, (t) => (ph(t) >= 0.43 && ph(t) <= 0.72 && Math.round(t / DT) % 5 < 2 ? venous : null)).map(
        (c) => ({ ...c, prfHz: 974 }),
      );
      const q = assessQuality(cols, beatsN, { wallFilterHz: 25, side: 'pos', phaseWindow: diastole });
      expect(q.validBeats).toBe(0);
      expect(q.issue).toBe('no-signal');
    });
  });
});
