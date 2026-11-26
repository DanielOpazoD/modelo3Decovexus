/**
 * Cifras en base 62 (0–9, A–Z, a–z) de los datos generados de s0028. Solo cifras y letras: el build reserva como nombre GLSL cada
 * identificador de una cadena, y una cadena alfanumérica es uno solo. Las escribe `tools/anatomy/s0028Base62.ts`.
 */

/** Valor de la cifra `i` de `s`: en ASCII, '0' es 48; 'A', 65 (vale 10) y 'a', 97 (vale 36). */
export function base62Digit(s: string, i: number): number {
  const c = s.charCodeAt(i);
  return c - (c < 58 ? 48 : c < 91 ? 55 : 61);
}

/**
 * Nodos [x, y, z, r] de un vaso generado, en 1/`scale` mm: el primero con tres cifras por valor (más 62³/2) y cada uno de los demás
 * como su incremento sobre el anterior, con dos (más 62²/2). Viajan como enteros: divididos entre `scale` dan el mismo double que
 * el decimal de la tabla de la que salieron.
 */
export function s0028Nodes(s: string, scale: number): readonly (readonly number[])[] {
  if (s.length % 8 !== 4) throw new Error('Nodos s0028 truncados');
  const value = [0, 0, 0, 0],
    nodes: number[][] = [];
  for (let i = 0; i < s.length;) {
    const width = i ? 2 : 3;
    for (let k = 0; k < 4; k++) {
      let n = 0;
      for (let j = 0; j < width; j++) n = 62 * n + base62Digit(s, i++);
      value[k] += n - 62 ** width / 2;
    }
    nodes.push(value.map((n) => n / scale));
  }
  return nodes;
}
