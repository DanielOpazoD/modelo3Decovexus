/** Cifras en base 62, en el orden que lee `base62Digit` (`src/anatomy/people/s0028/base62.ts`). */
export const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** El entero `n` (0 ≤ n < 62^width) con `width` cifras en base 62. */
export function base62(n: number, width: number): string {
  if (!(Number.isInteger(n) && n >= 0 && n < 62 ** width)) throw new RangeError(`Fuera de ${width} cifras en base 62: ${n}`);
  let s = '';
  for (let k = 0; k < width; k++, n = Math.floor(n / 62)) s = BASE62[n % 62] + s;
  return s;
}

/**
 * Cadena de los nodos [x, y, z, r] de un vaso en el formato que lee `s0028Nodes`: en 1/`scale` mm, el primero con tres cifras por
 * valor y los demás como incrementos de dos. Lanza si un valor no cae exacto en esa rejilla o un incremento no cabe.
 */
export function encodeS0028Nodes(nodes: readonly (readonly number[])[], scale: number): string {
  let s = '',
    previous: number[] | null = null;
  for (const node of nodes) {
    if (node.length !== 4) throw new Error('Nodo de s0028 sin x, y, z y r');
    const value = node.map((v) => {
      const n = Math.round(v * scale);
      if (n / scale !== v) throw new Error(`Valor de nodo s0028 fuera de la rejilla de 1/${scale} mm: ${v}`);
      return n;
    });
    s += value.map((n, k) => (previous ? base62(n - previous[k] + 62 ** 2 / 2, 2) : base62(n + 62 ** 3 / 2, 3))).join('');
    previous = value;
  }
  return s;
}
