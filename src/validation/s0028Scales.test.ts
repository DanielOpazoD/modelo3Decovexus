// @tier slow
import { beforeAll, describe, it } from 'vitest';
import { loadS0028 } from '../../tools/anatomy/s0028Windows';
import { CASES } from '../cases';
import { checkScales } from './support/s0028Scales';

/** Las escalas del equipo en s0028: los cuatro casos de referencia. En dos archivos para que la CI los reparta entre procesos (`support/s0028Scales.ts`). */
beforeAll(() => {
  loadS0028();
}, 60_000);

describe('s0028: escalas del equipo desde las ventanas del menú (decisión 94)', () => {
  for (const base of CASES.slice(0, 4))
    it(`${base.label}: porta, suprahepática e interlobar, ninguna captura aceptada falsa; en apnea a ±80, medibles`, () =>
      checkScales(base));
});
