export type PersonSelection = 'current' | 'legacy' | 's0028';
/**
 * Selection contains no descriptors, assets or implementation imports. Corte (decisión 340): s0028 es la persona por defecto; la
 * otra se pide con `?abdomen=atlas` (o `default`) y la escena procedural con `?abdomen=legacy` hasta que se retiren.
 */
export function selectPerson(params: URLSearchParams): PersonSelection {
  const abdomen = params.get('abdomen');
  if (abdomen === 'legacy') return 'legacy';
  if (abdomen === 'atlas' || abdomen === 'default') return 'current';
  if (abdomen && abdomen !== 's0028') throw new Error('Persona desconocida');
  if (params.get('reference') === '1') throw new Error('reference=1 incompatible con s0028');
  return 's0028';
}
