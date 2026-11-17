import { S0028_RENAL_CODES } from '../../src/anatomy/people/s0028/solids';

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Tramo más largo que cabe en una cabeza con dos cifras de longitud: 71 + 62·61 + 61. */
const LONGEST = 3914;

/** El formato, para la cabecera del módulo generado `src/anatomy/s0028RenalInteriorRuns.ts`. */
export const S0028_RENAL_RUNS_FORMAT =
  'Tramos de cada caja (xyz, z rápida) en base 62 (0-9, A-Z, a-z): el resto de 6 de la primera cifra es la etiqueta (U, corteza, médula, seno graso, colector, seno sin subclasificar) y su cociente da la longitud (0-7: de 1 a 8 vóxeles; 8: 9 más la cifra siguiente; 9: 71 más las dos siguientes).';

/**
 * Tramos de una caja del interior renal de s0028 a partir de su código por vóxel (xyz, z rápida), en el formato que lee
 * `s0028RenalRunCodes`: una cifra en base 62 con la etiqueta y la longitud, y una o dos cifras más para los tramos de 9 vóxeles o
 * más. Un tramo de más de 3914 vóxeles se parte en varios de la misma etiqueta.
 */
export function encodeS0028RenalRuns(codes: ArrayLike<number>): string {
  let runs = '';
  for (let i = 0; i < codes.length;) {
    const label = S0028_RENAL_CODES.indexOf(codes[i]);
    if (label < 0) throw new Error('Código de interior renal inválido: ' + codes[i]);
    let left = 1;
    while (i + left < codes.length && codes[i + left] === codes[i]) left++;
    i += left;
    while (left > 0) {
      const n = Math.min(left, LONGEST);
      if (n < 9) runs += DIGITS[6 * (n - 1) + label];
      else if (n < 71) runs += DIGITS[48 + label] + DIGITS[n - 9];
      else runs += DIGITS[54 + label] + DIGITS[Math.floor((n - 71) / 62)] + DIGITS[(n - 71) % 62];
      left -= n;
    }
  }
  return runs;
}
