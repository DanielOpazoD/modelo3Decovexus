import { expect, it } from 'vitest';
import { elevationShare, elevSigmaMm } from '../ultrasound/pleura';

/** Cola de una gaussiana de σ más allá de x, por integración numérica (oráculo independiente de `normalCdf`). */
function gaussianTail(x: number, sigma: number): number {
  const step = sigma / 2000;
  let sum = 0;
  for (let t = x + step / 2; t < x + 12 * sigma; t += step) sum += Math.exp((-t * t) / (2 * sigma * sigma)) * step;
  return sum / (sigma * Math.sqrt(2 * Math.PI));
}

it('reparto del haz en elevación junto a un borde: la cola del haz de dos vías más allá del borde, no un cuarto fijo (decisión 415)', () => {
  for (const se of [1.6, 1.9, 2.4]) {
    // El plano lateral está a `se` del central y a `bd` de su borde: el borde queda a se − bd, y el haz de dos vías tiene σ = se/√2.
    for (const bd of [0.05, 0.3, 0.9, 1.4, se]) {
      const share = elevationShare(bd, se);
      expect(share, `se ${se} bd ${bd}`).toBeCloseTo(gaussianTail(se - bd, se / Math.SQRT2), 5);
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThanOrEqual(0.5);
    }
    // Más cerca del borde por fuera, menos haz al otro lado; con el borde en el plano central, la mitad.
    expect(elevationShare(0.1, se)).toBeLessThan(elevationShare(1, se));
    expect(elevationShare(se, se)).toBeCloseTo(0.5, 6);
    expect(elevationShare(5 * se, se)).toBeCloseTo(0.5, 6);
    // Distancia desconocida (tejidos de máscara de vóxel, bd = 0): el cuarto de siempre.
    expect(elevationShare(0, se)).toBe(0.25);
  }
});

it('una luz de 4,4 mm centrada en el plano ya no pierde la mitad de su anchura por el reparto fijo (decisión 415)', () => {
  // Tubo de radio 2,2 mm con su eje en el plano de imagen, a 95 mm, con armónica (σ de una vía ≈ 1,9 mm). A una altura y sobre el
  // eje, la luz ocupa en elevación ±c con c = √(r² − y²); cada plano lateral está en la luz si c > se. Fracción de tejido en la
  // muestra: antes un cuarto por cada plano lateral fuera de la luz; ahora, la cola del haz más allá del borde.
  const r = 2.2,
    se = elevSigmaMm(95, 80, true);
  expect(se).toBeGreaterThan(1.8);
  expect(se).toBeLessThan(2.1);
  const tissue = (y: number, fixed: boolean): number => {
    const c = Math.sqrt(r * r - y * y);
    if (c > se) return 0;
    // distancia del plano lateral (a `se` del eje en elevación, y en altura) a la pared del tubo
    const bd = Math.hypot(se, y) - r;
    return 2 * (fixed ? 0.25 : elevationShare(bd, se));
  };
  // Anchura de la luz «oscura» (menos de un 25 % de tejido, −12 dB) a lo alto del tubo, con pasos de 0,05 mm.
  const darkWidth = (fixed: boolean): number => {
    let n = 0;
    for (let y = -r + 0.025; y < r; y += 0.05) if (tissue(y, fixed) < 0.25) n++;
    return n * 0.05;
  };
  // Medido el 17-11-2026 (σ 1,92 mm): 2,1 mm oscuros con el cuarto fijo (menos de la mitad del calibre) y 3,4 con el reparto
  // por distancia; a 1,5 mm del eje la muestra lleva un 21,5 % de tejido en lugar del 50 %.
  expect(darkWidth(true)).toBeLessThan(2.3);
  expect(darkWidth(false)).toBeGreaterThan(3.2);
  expect(tissue(1.5, true)).toBe(0.5);
  expect(tissue(1.5, false)).toBeLessThan(0.25);
});
