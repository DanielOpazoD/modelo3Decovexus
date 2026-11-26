import { S0028_RENAL_CODES, S0028_RENAL_NEXT } from '../../src/anatomy/people/s0028/solids';
import { base62 } from './s0028Base62';

/** El formato, para la cabecera del módulo generado `src/anatomy/s0028RenalInteriorRuns.ts`. */
export const S0028_RENAL_RUNS_FORMAT =
  'Tramos de cada caja (xyz, z rápida) en base 62 (0-9, A-Z, a-z): la primera cifra da la etiqueta (U, corteza, médula, seno graso, colector, seno sin subclasificar) por su orden tras la del tramo anterior y la longitud, y una o tres cifras más los tramos largos (s0028RenalRunCodes).';

/**
 * Tramos de una caja del interior renal de s0028 a partir de su código por vóxel (xyz, z rápida), en el formato que lee
 * `s0028RenalRunCodes`: la etiqueta por su orden en `S0028_RENAL_NEXT` tras la anterior, y la longitud en la misma cifra o en una o
 * tres más.
 */
export function encodeS0028RenalRuns(codes: ArrayLike<number>): string {
  let runs = '',
    previous = 6;
  for (let i = 0; i < codes.length;) {
    const label = S0028_RENAL_CODES.indexOf(codes[i]);
    if (label < 0) throw new Error('Código de interior renal inválido: ' + codes[i]);
    let n = 1;
    while (i + n < codes.length && codes[i + n] === codes[i]) n++;
    i += n;
    const rank = S0028_RENAL_NEXT.slice(5 * previous, 5 * previous + 5).indexOf(String(label));
    if (rank < 0) throw new Error(`Etiqueta de interior renal ${label} sin código tras ${previous}`);
    const short = rank === 0 ? 41 : rank === 1 ? 11 : 0;
    if (n <= short) runs += base62(n - 1 + 41 * rank, 1);
    else if (n <= short + 62) runs += base62(52 + rank, 1) + base62(n - short - 1, 1);
    else runs += base62(57 + rank, 1) + base62(n - short - 63, 3);
    previous = label;
  }
  return runs;
}
