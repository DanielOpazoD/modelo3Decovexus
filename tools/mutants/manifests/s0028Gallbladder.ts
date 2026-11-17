import type { MutantManifest } from '../manifest';

/** Vesícula en ayunas de s0028 (decisión 413): los nodos de su pera. */
export const s0028Gallbladder: MutantManifest = {
  module: 'src/anatomy/people/s0028/gallbladder.ts',
  mutants: [
    {
      name: 'vesicula-otra-vez-contraida',
      origin: 'decisión 413',
      breaks: 'El cuerpo de la vesícula vuelve a un radio de vesícula contraída: menos de 18 ml de luz.',
      from: '    { p: [-70.9, 39.8, -93.8], r: 12 }, // cuerpo',
      to: '    { p: [-70.9, 39.8, -93.8], r: 6 }, // cuerpo',
      tests: ['src/validation/s0028Gallbladder.test.ts'],
    },
  ],
};
