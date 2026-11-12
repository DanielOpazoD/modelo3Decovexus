import { expect, it } from 'vitest';
import { loadS0028 } from '../../tools/anatomy/s0028Windows';
import { lumenOverlaps } from './support/vesselOverlap';

it('s0028: ningún vaso atraviesa la luz de otro en el abdomen', () => {
  // Decisión 354: la mesentérica superior atravesaba la cava (11 mm de solape), la arteria renal derecha también (5 mm) y la
  // arteria y la vena mesentéricas se pisaban (6,5 mm). En una ecografía dos luces separadas no se funden en una.
  expect(lumenOverlaps(loadS0028().scene)).toEqual([]);
});
