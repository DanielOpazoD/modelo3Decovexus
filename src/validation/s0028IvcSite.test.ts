import { beforeAll, expect, it } from 'vitest';
import { loadS0028 } from '../../tools/anatomy/s0028Windows';
import { S0028_IVC_MEASUREMENT_Z } from '../anatomy/people/s0028/vessels';
import { AnatomyQuery } from '../anatomy/query';
import { Tissue } from '../anatomy/tissues';
import { CASES } from '../cases';
import type { Vec3 } from '../core/vec3';
import { PhysiologyEngine, type PhysiologySample } from '../physiology/engine';
import { AnatomyScene } from './support/legacyPerson/scene';

/**
 * La VCI de s0028 en la imagen mide lo que la fisiología donde la mide el alumno (decisión 396). El diámetro de la verdad es el
 * del radio de referencia (`ivcSupra.refRadius`, 10 mm); la VCI del TAC iba de 8,7 mm de radio tras el hígado a 12,5 a 2 cm de la
 * aurícula, y la imagen daba la verdad × radio local / 10: el sano (18,7 mm) medía 23,5 a 2 cm de la aurícula, por encima del corte
 * de 2 cm del VExUS. Se mide como el calibre del alumno: perpendicular al eje, en el plano sagital, solo la luz de la VCI (sin la
 * de las suprahepáticas que desembocan), en el máximo y el mínimo del ciclo con respiración tranquila.
 *
 * Sitios: 1–2 cm bajo la desembocadura de la suprahepática derecha (z −47 y −37; la guía) y de 2 a 1,25 cm de la aurícula (z −5,
 * 0 y 2,5). Entre las confluencias la luz se reparte con las suprahepáticas: ahí no se mide; en z 5 entra la luz de `ivcSupra`.
 * Medido el 15-11-2026: ≤ 3 % en la guía; a 2 cm de la aurícula, el sano 18,5 frente a 18,7, y en la congestión −9 a −10,5 % (la
 * boca del tronco común, dilatada, comparte la luz). Con la regularización antes del alisado del eje, el sano medía 20,5 en z 2,5.
 */
beforeAll(() => {
  loadS0028();
}, 60_000);

function diameter(scene: AnatomyScene, query: AnatomyQuery, s: PhysiologySample, z: number): number {
  const nodes = scene.vesselById.get('ivcInfra')!.tube.nodes;
  const k = nodes.findIndex((n, i) => i < nodes.length - 1 && (n.p[2] - z) * (nodes[i + 1].p[2] - z) <= 0);
  const [a, b] = [nodes[k].p, nodes[k + 1].p];
  const t = (z - a[2]) / (b[2] - a[2]);
  const c = a.map((x, i) => x + t * (b[i] - x)) as Vec3;
  const l = Math.hypot(b[1] - a[1], b[2] - a[2]);
  const perp = [0, (b[2] - a[2]) / l, -(b[1] - a[1]) / l];
  const cal = query.caliberFor(s);
  const ivc = (d: number) => {
    const q = scene.classify([c[0], c[1] + d * perp[1], c[2] + d * perp[2]], cal);
    return q.tissue === Tissue.Blood && String(q.vessel ?? '').startsWith('ivc');
  };
  let up = 0,
    down = 0;
  while (ivc(up + 0.25) && up < 40) up += 0.25;
  while (ivc(-down - 0.25) && down < 40) down += 0.25;
  return up + down;
}

it('s0028: en el sitio de medida, la VCI de la imagen es la de la fisiología y no cruza el corte de 2 cm al revés (decisión 396)', () => {
  for (const base of CASES) {
    const p = { ...base, respiratoryPattern: 'quiet' as const };
    const scene = new AnatomyScene(p);
    expect(scene.identity.person).toBe('s0028');
    const query = new AnatomyQuery(scene);
    const engine = new PhysiologyEngine(p, scene.vesselAreas(), { historySeconds: 2 });
    let hi = engine.step();
    let lo = hi;
    for (let i = 0; i < 2500; i++) {
      const s = engine.step();
      if (s.ivc.dApMm > hi.ivc.dApMm) hi = structuredClone(s);
      if (s.ivc.dApMm < lo.ivc.dApMm) lo = structuredClone(s);
    }
    for (const smp of [hi, lo])
      for (const [z, tolerance] of [
        [-47, 0.05],
        [-37, 0.05],
        // de 2 a 1,25 cm de la aurícula, en la congestión, la boca del tronco común suprahepático comparte la luz (medido: hasta −10,5 %)
        [-5, 0.12],
        [0, 0.12],
        [2.5, 0.12],
      ] as const) {
        const d = diameter(scene, query, smp, z);
        const tag = `${base.id} z ${z}: imagen ${d.toFixed(1)}, fisiología ${smp.ivc.dApMm.toFixed(1)}`;
        expect(Math.abs(d / smp.ivc.dApMm - 1), tag).toBeLessThan(tolerance);
        // lo que decide el grado: el corte de 2 cm, del mismo lado que la verdad
        expect(d > 20, tag).toBe(smp.ivc.dApMm > 20);
      }
  }
});

it('s0028: la VCI lleva el radio de referencia en todo el tramo de medida, hasta su nodo de z 5 (decisión 396)', () => {
  const scene = new AnatomyScene(CASES[0]);
  const [lo, hi] = S0028_IVC_MEASUREMENT_Z;
  const reference = scene.vesselById.get('ivcSupra')!.refRadius;
  const nodes = scene.vesselById.get('ivcInfra')!.tube.nodes;
  // el alisado del eje (`smoothS0028Vessels`) solo conserva los extremos: con la regularización antes, borraba el nodo de z 5
  expect(nodes.some((n) => Math.abs(n.p[2] - hi) < 1e-6)).toBe(true);
  for (const n of nodes.filter((n) => n.p[2] >= lo && n.p[2] <= hi)) expect(n.r, `z ${n.p[2].toFixed(1)}`).toBe(reference);
});
