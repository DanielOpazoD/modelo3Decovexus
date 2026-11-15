import type { MutantManifest } from '../manifest';

/** Casos del selector. */
export const cases: MutantManifest = {
  module: 'src/cases/index.ts',
  mutants: [
    {
      name: 'porta-invertida-sin-it-libre',
      origin: 'decisión 394',
      breaks: 'El caso de la porta invertida pierde la insuficiencia tricuspídea libre: la porta vuelve a ser pulsátil sin invertirse.',
      from: '  tricuspidRegurgitation: 1.0,\n  rapMeanMmHg: 22,',
      to: '  tricuspidRegurgitation: 0.7,\n  rapMeanMmHg: 22,',
      tests: ['src/validation/portalReversal.test.ts'],
    },
  ],
};

/** Nombre de los casos en pantalla. */
export const blindMode: MutantManifest = {
  module: 'src/app/blindMode.ts',
  mutants: [
    {
      name: 'nombres-ciegos-por-defecto',
      origin: 'decisión 393',
      breaks: 'Los casos vuelven a mostrarse como «Paciente A, B…» sin pedir el modo alumno.',
      from: "  return new URLSearchParams(search).has('alumno');",
      to: "  return !new URLSearchParams(search).has('docente');",
      tests: ['src/validation/blindMode.test.ts'],
    },
  ],
};
