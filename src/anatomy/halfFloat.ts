/** Decode the pinned half-float nodes once, shared by the anatomical readers. */
export const HALF = Float32Array.from({ length: 65536 }, (_, bits) => {
  const sign = bits & 0x8000 ? -1 : 1,
    exponent = (bits >>> 10) & 31,
    mantissa = bits & 1023;
  return (
    sign *
    (exponent === 0 ? mantissa * 2 ** -24 : exponent === 31 ? (mantissa ? NaN : Infinity) : (1 + mantissa / 1024) * 2 ** (exponent - 15))
  );
});

const F32 = new Float32Array(1),
  U32 = new Uint32Array(F32.buffer);
/** Codifica un número normal (ni NaN ni subnormal: las distancias en mm de las cartas) como half, redondeando al más cercano. */
export function toHalf(value: number): number {
  F32[0] = value;
  const bits = U32[0],
    exponent = ((bits >>> 23) & 0xff) - 112;
  if (exponent <= 0 || exponent >= 31) throw new Error('Valor fuera del rango half normal');
  const half = ((bits >>> 16) & 0x8000) | (exponent << 10) | ((bits >>> 13) & 0x3ff);
  return bits & 0x1000 ? half + 1 : half;
}
