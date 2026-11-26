import { describe, expect, it, vi } from 'vitest';
import { spectralBinAt } from '../ui/spectralAxis';
import { VENOUS_PW_PRESENTATION, presentationPower, spectralGrey, type SpectralPresentation } from '../ui/spectralPresentation';
import { drawVenousSpectrum } from '../ui/venousSpectralPlot';
import type { SpectralColumn } from '../doppler/spectral';

function paint(columns: readonly SpectralColumn[], invert: boolean, baselineShift = 0, presentation?: SpectralPresentation) {
  let bitmap: { data: Uint8ClampedArray; width: number; height: number };
  const ctx = {
    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
    putImageData: (image: typeof bitmap) => {
      bitmap = image;
    },
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 10 }),
    setLineDash: vi.fn(),
  };
  const canvas = { width: 90, height: 280, getContext: () => ctx } as unknown as HTMLCanvasElement;
  drawVenousSpectrum(canvas, columns, 0, 1, 50, [{ t: 0.5, vScreen: 25, label: 'S' }], null, 1, baselineShift, presentation, invert);
  return { bitmap: bitmap!, labels: ctx.fillText.mock.calls };
}

describe('INV del espectro PW: transformación de presentación', () => {
  it('refleja potencia y marcas respecto del cero, sin alterar columnas ni intensidades', () => {
    const columns: SpectralColumn[] = [{ t: 0.5, prfHz: 3200, powerDb: Float32Array.from({ length: 128 }, (_, k) => -65 + k / 2) }];
    const before = structuredClone(columns);
    const normal = paint(columns, false),
      inverted = paint(columns, true);
    const { width, height } = normal.bitmap;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4,
          mirror = ((height - 1 - y) * width + x) * 4;
        expect(inverted.bitmap.data[at]).toBe(normal.bitmap.data[mirror]);
      }
    const normalMark = normal.labels.find(([label]) => label === 'S')!;
    const invertedMark = inverted.labels.find(([label]) => label === 'S')!;
    expect(normalMark[1]).toBe(invertedMark[1]);
    expect(normalMark[2] + invertedMark[2]).toBe(height - 10);
    expect(columns).toEqual(before);
    expect(paint(columns, false).bitmap.data).toEqual(normal.bitmap.data);
  });

  it('las tablas fila→bin y gris por bin pintan los mismos bytes que calcular cada píxel', () => {
    // Referencia: bin y gris recalculados en cada píxel, como antes de las tablas.
    const reference = (columns: readonly SpectralColumn[], baselineShift: number, p: SpectralPresentation, invert: boolean) => {
      const plotW = 32,
        plotH = 256,
        data = new Uint8ClampedArray(plotW * plotH * 4);
      for (let i = 3; i < data.length; i += 4) data[i] = 255;
      for (let c = 0; c < columns.length; c++) {
        const col = columns[c];
        if (col.t < 0 || col.t > 1) continue;
        const hopS = 16 / col.prfHz,
          x0 = Math.max(0, Math.floor((col.t - hopS / 2) * plotW)),
          x1 = Math.min(plotW, Math.ceil((col.t + hopS / 2) * plotW));
        const power = presentationPower(columns, c);
        for (let y = 0; y < plotH; y++) {
          const value = spectralGrey(power[spectralBinAt((y + 0.5) / plotH, power.length, baselineShift, invert)], p);
          for (let x = x0; x < x1; x++) data.fill(value, (y * plotW + x) * 4, (y * plotW + x) * 4 + 3);
        }
      }
      return data;
    };
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 70 - 75;
    // Columnas contiguas (promedio de presentación), un cambio de tamaño FFT y una fuera de la ventana.
    const columns: SpectralColumn[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ t: 0.3 + i / 200, prfHz: 3200, powerDb: Float32Array.from({ length: 128 }, noise) })),
      ...Array.from({ length: 10 }, (_, i) => ({ t: 0.6 + i / 400, prfHz: 6400, powerDb: Float32Array.from({ length: 64 }, noise) })),
      { t: 1.2, prfHz: 3200, powerDb: Float32Array.from({ length: 128 }, noise) },
    ];
    for (const invert of [false, true])
      for (const baselineShift of [0, 0.1, -0.2]) {
        const { bitmap } = paint(columns, invert, baselineShift, VENOUS_PW_PRESENTATION[1]);
        expect(bitmap.data, `INV ${invert} · base ${baselineShift}`).toEqual(
          reference(columns, baselineShift, VENOUS_PW_PRESENTATION[1], invert),
        );
      }
  });
});
