import type { MutantManifest } from '../manifest';

/**
 * Reparto del haz en elevación junto a un borde (decisión 415), la función que pesa el plano lateral que cae en otro tejido, y la
 * distancia al borde con el vaso vecino que decide si ese plano se clasifica (decisión 418).
 */
export const elevationShare: MutantManifest = {
  module: 'src/ultrasound/pleura.ts',
  mutants: [
    {
      name: 'reparto-otra-vez-un-cuarto',
      origin: 'decisión 415',
      breaks: 'El plano lateral que cae en otro tejido vuelve a pesar un cuarto fijo: una luz de 4,4 mm se ve oscura en 2,1 mm.',
      from: '  return 1 - normalCdf((Math.max(se - bd, 0) * Math.SQRT2) / se);',
      to: '  return 0.25;',
      tests: ['src/validation/elevationShare.test.ts'],
    },
    {
      name: 'reparto-con-el-haz-de-una-via',
      origin: 'decisión 415',
      breaks: 'La cola se calcula con la σ de una vía en vez de la del haz de dos vías (σ/√2): el borde rellena la luz de más.',
      from: '(Math.max(se - bd, 0) * Math.SQRT2) / se',
      to: 'Math.max(se - bd, 0) / se',
      tests: ['src/validation/elevationShare.test.ts'],
    },
    {
      name: 'reparto-sin-distancia-desconocida',
      origin: 'decisión 415',
      breaks: 'Un tejido de máscara de vóxel (bd = 0) deja de conservar el cuarto y pesa un 8 %: sus bordes se afinan sin medida.',
      from: '  if (bd <= 0) return 0.25;\n',
      to: '',
      tests: ['src/validation/elevationShare.test.ts'],
    },
    {
      name: 'borde-sin-contar-los-tubos',
      origin: 'decisión 418',
      breaks: 'La distancia al borde del plano central vuelve a ignorar el vaso vecino: sus planos laterales heredan el tejido central.',
      from: '  return g <= reach ? g : bd;',
      to: '  return bd;',
      tests: ['src/validation/s0028SidePlaneTubes.test.ts'],
    },
    {
      name: 'borde-con-tubos-solo-junto-al-plano',
      origin: 'decisión 418',
      breaks: 'El alcance con que se mira el vaso vecino se queda en medio grosor de haz: los planos laterales a σe quedan sin mirar.',
      from: '  const reach = Math.min(se + 0.5, TUBE_GAP_REACH_MM);',
      to: '  const reach = Math.min(0.5 * se, TUBE_GAP_REACH_MM);',
      tests: ['src/validation/s0028SidePlaneTubes.test.ts'],
    },
  ],
};
