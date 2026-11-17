/**
 * Presentación de lo que las herramientas de ventana leen del plano (`window-parity.ts`, `tissue-map.ts`): un carácter y un
 * nombre por tejido, el mapa de una rejilla de tejidos y la tabla de pares CPU→GPU. Módulo puro, sin navegador.
 */
import { Tissue } from '../../src/anatomy/tissues';

/** Un carácter por índice de tejido: 0–9, a–z y A–Z. Los 36 primeros son los del mapa de siempre. */
const GLYPHS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Tejidos que caben en el mapa con un carácter cada uno. */
export const GLYPH_CAPACITY = GLYPHS.length;

export function tissueGlyph(tissue: number): string {
  return GLYPHS[tissue] ?? '?';
}

export function tissueName(tissue: number): string {
  return Tissue[tissue] ?? `tejido ${tissue}`;
}

/**
 * El mapa de una rejilla de tejidos (filas de arriba abajo, columnas de izquierda a derecha) y su leyenda: carácter, nombre y,
 * si las hay, las notas vistas en ese tejido (aproximación o capa de pared).
 */
export function renderTissueMap(grid: readonly (readonly number[])[], notes: Readonly<Record<number, readonly string[]>> = {}): string[] {
  const seen = [...new Set(grid.flat())].sort((a, b) => a - b);
  const legend = seen.map((t) => `${tissueGlyph(t)} ${tissueName(t)}${notes[t]?.length ? ` [${notes[t].join(', ')}]` : ''}`);
  return [...grid.map((row) => row.map(tissueGlyph).join('')), legend.join(' · ')];
}

/** Pares `«cpu>gpu»: cuenta` con los nombres de los tejidos, de más a menos frecuente. */
export function pairTable(pairs: Readonly<Record<string, number>>): { cpu: string; gpu: string; count: number }[] {
  return Object.entries(pairs)
    .map(([key, count]) => {
      const [cpu, gpu] = key.split('>').map(Number);
      return { cpu: tissueName(cpu), gpu: tissueName(gpu), count };
    })
    .sort((a, b) => b.count - a.count);
}
