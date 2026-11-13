/**
 * Filtro de `s0028-liver-border.py` (decisión 361): de los vóxeles que el cierre añadiría al hígado, acepta los que el clasificador
 * del simulador da como grasa, tejido sin rotular o la cáscara de músculo pegada al hígado, bajo la cara interna de la pared y sin otro dueño. Así el borde nuevo no
 * entra en la pared ni pisa otro órgano, hueso o vaso.
 *
 *   node --import tsx tools/anatomy/s0028-liver-border-filter.ts <candidatos.json> <aceptados.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Tissue } from '../../src/anatomy/tissues';
import { loadS0028 } from './s0028Windows';

const [source, target] = process.argv.slice(2);
const { index, points } = JSON.parse(readFileSync(source, 'utf8')) as { index: number[][]; points: [number, number, number][] };
const { scene, anatomy, sample } = loadS0028();
const caliber = anatomy.caliberFor(sample);
const SOFT = new Set([Tissue.Fat, Tissue.MesentericFat, Tissue.PerirenalFat, Tissue.UnsegmentedSoftTissue, Tissue.Muscle]);
const rejected: Record<string, number> = {};
const accepted = index.filter((_, i) => {
  const c = scene.classify(points[i], caliber);
  const inside = scene.person.cpu.regional!.s0028InsideWall(points[i]);
  const owners = c.solids?.owners ?? [];
  const reason = !SOFT.has(c.tissue)
    ? Tissue[c.tissue]
    : inside !== null && inside < 0
      ? 'pared'
      : owners.some((o) => o.id !== 'compatible_fat')
        ? 'otro dueño'
        : '';
  if (reason) rejected[reason] = (rejected[reason] ?? 0) + 1;
  return !reason;
});
writeFileSync(target, JSON.stringify({ index: accepted }));
console.log(`${accepted.length} de ${index.length} aceptados; rechazados:`, rejected);
