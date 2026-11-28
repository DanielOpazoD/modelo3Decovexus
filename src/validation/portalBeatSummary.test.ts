import { describe, expect, it } from 'vitest';
import { portalBeatSummary } from '../ui/portalBeatSummary';

describe('variabilidad de los latidos portales observados', () => {
  it('expresa rango muestral y umbrales cruzados sin inventar un intervalo de confianza', () => {
    const m = { beats: 4, pulsatilityFraction: 39, pulsatilityByBeat: [20, 38, 40, 55] };
    const before = structuredClone(m);
    expect(portalBeatSummary(m)).toBe('PF 39,0 % · rango entre 4 latidos 20,0–55,0 % · cruza 30/50 %: ampliar registro');
    expect(m).toEqual(before);
  });
  it('conserva PF superior a 100 y no advierte cuando no hay cruce', () => {
    expect(portalBeatSummary({ beats: 3, pulsatilityFraction: 124, pulsatilityByBeat: [120, 124, 128] })).toBe(
      'PF 124,0 % · rango entre 3 latidos 120,0–128,0 %',
    );
    expect(portalBeatSummary({ beats: 2, pulsatilityFraction: 40, pulsatilityByBeat: [30, 50] })).toContain('cruza 50 %');
  });
  // Decisión 272: el formato de la PF nunca cruza de categoría por redondeo, tampoco en el resumen de los latidos.
  it('la PF y su rango no se redondean a la categoría siguiente', () => {
    const justBelow = portalBeatSummary({ beats: 4, pulsatilityFraction: 49.96, pulsatilityByBeat: [49.9, 49.95, 49.97, 49.99] });
    expect(justBelow).toBe('PF menos de 50 % · rango entre 4 latidos 49,9–49,9 %');
    expect(portalBeatSummary({ beats: 4, pulsatilityFraction: 29.6, pulsatilityByBeat: [28, 29.5, 29.7, 29.9] })).toBe(
      'PF 29,6 % · rango entre 4 latidos 28,0–29,9 %',
    );
    expect(portalBeatSummary({ beats: 4, pulsatilityFraction: 49.7, pulsatilityByBeat: [47, 49.6, 49.8, 52] })).toBe(
      'PF 49,7 % · rango entre 4 latidos 47,0–52,0 % · cruza 50 %: ampliar registro',
    );
  });
  it('una PF medida con el valle en el filtro de pared se presenta como cota inferior', () => {
    expect(portalBeatSummary({ beats: 4, pulsatilityFraction: 88, pulsatilityByBeat: [85, 88, 88, 90], pulsatilityLowerBound: true })).toBe(
      'PF ≥ 88,0 % · rango entre 4 latidos 85,0–90,0 %',
    );
  });
  it('no informa rangos de datos incompletos o no finitos', () => {
    expect(portalBeatSummary({ beats: 4, pulsatilityFraction: 20 })).toBe('');
    for (const values of [[], [20], [20, NaN], [20, Infinity]])
      expect(portalBeatSummary({ beats: 2, pulsatilityFraction: 20, pulsatilityByBeat: values })).toBe('');
    expect(portalBeatSummary({ beats: 2, pulsatilityFraction: NaN, pulsatilityByBeat: [20, 20] })).toBe('');
  });
});
