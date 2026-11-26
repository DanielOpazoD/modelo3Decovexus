import { describe, expect, it } from 'vitest';
import {
  hepaticPeaksText,
  ivcDiameterText,
  patternText,
  portalPulsatilityText,
  pulsatilityValueText,
  velocityText,
} from '../ui/panel/vexusText';
import { hepaticPatternFromPeaks } from '../vexus/classification';

/** Un ayudante por magnitud clínica: el redondeo de presentación no cruza un umbral del grado ni muestra «NaN» (decisión 272). */
describe('Formato de las magnitudes del grado', () => {
  it('diámetro de la VCI: nada menor que 20 mm se presenta como 20', () => {
    for (const [mm, text] of [
      [19.94, '19.9'],
      [19.95, '19.9'],
      [19.97, '19.9'],
      [19.999, '19.9'],
      [20, '20.0'],
      [20.04, '20.0'],
      [25, '25.0'],
    ] as const)
      expect(ivcDiameterText(mm), String(mm)).toBe(text);
    expect(ivcDiameterText(19.97, ',')).toBe('19,9');
    expect(ivcDiameterText(Number.NaN)).toBe('—');
  });

  it('PF sin unidad (latidos, rangos): el redondeo no cruza 30 ni 50 %', () => {
    for (const [pf, text] of [
      [29.95, '29,9'],
      [29.999, '29,9'],
      [30, '30,0'],
      [49.96, '49,9'],
      [50, '50,0'],
      [124, '124,0'],
    ] as const)
      expect(pulsatilityValueText(pf), String(pf)).toBe(text);
    expect(pulsatilityValueText(Number.NaN)).toBe('—');
  });

  it('PF del grado: «menos de» junto al umbral y «≥» cuando la medida es una cota inferior', () => {
    expect(portalPulsatilityText(49.96)).toBe('menos de 50 %');
    expect(portalPulsatilityText(49.7)).toBe('49,7 %');
    expect(portalPulsatilityText(88, true)).toBe('≥ 88,0 %');
    expect(portalPulsatilityText(Number.NaN)).toBe('n/a');
  });

  it('velocidad: «—» si no es finita; el signo físico no se pierde al redondear y el de pantalla no fabrica «-0.0»', () => {
    for (const v of [Number.NaN, Infinity, -Infinity]) expect(velocityText(v)).toBe('—');
    expect(velocityText(-5.04)).toBe('-5.0');
    // S < 0 es «grave (S invertida)» (decisión 272): una S de −0,04 no se escribe «0.0» junto a esa categoría
    expect(velocityText(-0.04)).toBe('-0.0');
    expect(velocityText(-0.04, true)).toBe('0.0');
    expect(velocityText(12.34)).toBe('12.3');
    expect(velocityText(5, true)).toBe('+5.0');
    expect(velocityText(-5, true)).toBe('-5.0');
    expect(velocityText(0.01, true)).toBe('0.0');
  });

  it('el rótulo del patrón suprahepático dice la regla que lo clasifica: S = D es leve, «S≤D»', () => {
    expect(patternText(hepaticPatternFromPeaks(20, 20))).toBe('leve (S≤D)');
    expect(patternText(hepaticPatternFromPeaks(15, 24))).toBe('leve (S≤D)');
    expect(patternText(hepaticPatternFromPeaks(28, 18))).toBe('normal (S>D)');
  });

  it('S y D de la VSH: si la décima las iguala y el patrón compara S con D, las cifras que hagan falta para ver el orden', () => {
    // «S 25.0 · D 25.0 → normal (S>D)» contradiría la categoría
    expect(hepaticPeaksText(25.04, 25)).toEqual(['25.04', '25.00']);
    expect(hepaticPeaksText(24.96, 25.04)).toEqual(['24.96', '25.04']);
    expect(hepaticPeaksText(25.004, 25)).toEqual(['25.004', '25.000']);
    // sin empate, o si el patrón no compara S con D (S invertida o nula, D no positiva, S = D), la décima
    expect(hepaticPeaksText(30, 25)).toEqual(['30.0', '25.0']);
    expect(hepaticPeaksText(-0.04, 0.04)).toEqual(['-0.0', '0.0']);
    expect(hepaticPeaksText(25.04, -0.01)).toEqual(['25.0', '-0.0']);
    expect(hepaticPeaksText(25, 25)).toEqual(['25.0', '25.0']);
    expect(hepaticPeaksText(Number.NaN, 25)).toEqual(['—', '25.0']);
  });
});
