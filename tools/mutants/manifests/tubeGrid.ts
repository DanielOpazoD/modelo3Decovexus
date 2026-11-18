import type { MutantManifest } from '../manifest';

/** Rejilla de tubos de la GPU: la lista de «cercanos» de cada celda (decisión 418). */
export const tubeGrid: MutantManifest = {
  module: 'src/anatomy/gpu/tubeGrid.ts',
  mutants: [
    {
      name: 'rejilla-sin-cercanos',
      origin: 'decisión 418',
      breaks: 'La cuenta de la celda pierde sus tubos cercanos: la pasada B no ve el vaso que pasa junto a una celda sin tocarla.',
      from: '    data[i * 2 + 1] = count[i] + TUBE_GRID_NEAR_BASE * nearCount[i];',
      to: '    data[i * 2 + 1] = count[i];',
      tests: ['src/anatomy/gpu/tubeSegmentGrid.test.ts'],
    },
  ],
};
