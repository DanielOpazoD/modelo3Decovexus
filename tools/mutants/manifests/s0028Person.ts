import type { MutantManifest } from '../manifest';

/** Vasos y vía biliar de s0028 (decisiones 384, 385 y 389). */
export const s0028Vessels: MutantManifest = {
  module: 'src/anatomy/people/s0028/vessels.ts',
  mutants: [
    {
      name: 'coledoco-dentro-del-duodeno',
      origin: 'decisión 384',
      breaks: 'El colédoco de s0028 vuelve a recorrer la luz del duodeno: un anillo de pared gruesa sin sentido junto al riñón.',
      from: "  if (inside(cbd[0].p, 'digestiveTract'))",
      to: '  if (cbd.length < 0)',
      tests: ['src/validation/s0028Vessels.test.ts'],
    },
    {
      name: 'porta-derecha-con-gancho',
      origin: 'decisión 385',
      breaks: 'La porta derecha vuelve a sobrepasar el origen de su rama anterior: gancho en la ventana intrahepática.',
      from: '  continuePortalBranches(vessels);',
      to: '',
      tests: ['src/validation/s0028Vessels.test.ts'],
    },
    {
      name: 'vena-renal-en-cuna-dentro-del-seno',
      origin: 'decisión 389',
      breaks: 'La vena renal vuelve a nacer 15 mm dentro del seno, afilada: una cuña negra que se lee como pelvis dilatada.',
      from: '  startRenalVeinsAtHilum(vessels);',
      to: '',
      tests: ['src/validation/s0028Vessels.test.ts'],
    },
  ],
};

/** Datos de construcción de la persona s0028. */
export const s0028Cpu: MutantManifest = {
  module: 'src/anatomy/people/s0028/cpu.ts',
  mutants: [
    {
      name: 'intestino-delgado-con-liquido',
      origin: 'decisión 384',
      breaks: 'El duodeno y el intestino delgado de s0028 vuelven a dibujarse llenos de líquido anecoico.',
      from: '    smallBowelContents: Tissue.GastricContents,',
      to: '    smallBowelContents: undefined,',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
  ],
};

/** Aspecto de las caras de s0028 en la imagen. */
export const s0028Look: MutantManifest = {
  module: 'src/anatomy/people/s0028/gpu.ts',
  mutants: [
    {
      name: 'scarpa-tan-brillante-como-las-demas',
      origin: 'decisión 390',
      breaks: 'La fascia de Scarpa vuelve a brillar como la fascia profunda: las caras de la pared parecen todas iguales.',
      from: '  [Interface.Scarpa]: { gain: 0.35 },',
      to: '',
      tests: ['src/validation/s0028TissueLook.test.ts'],
    },
  ],
};
