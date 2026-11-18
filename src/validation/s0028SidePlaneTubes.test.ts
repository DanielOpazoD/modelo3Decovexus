import { beforeAll, expect, it } from 'vitest';
import { loadS0028 } from '../../tools/anatomy/s0028Windows';
import { TUBE_GAP_REACH_MM } from '../anatomy/gpu/tubeGrid';
import { Interface } from '../anatomy/interfaces';
import { S0028_BUNDLE } from '../anatomy/people/s0028/descriptor';
import { TUBE_NOISE_MAX, tubeQuery } from '../anatomy/primitives';
import { wallThicknessMm } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { startPointsFor } from '../app/startPoints';
import type { Vec3 } from '../core/vec3';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine } from '../probe/probe';
import { boundaryWithTubes, elevSigmaMm } from '../ultrasound/pleura';
import { tubeGap } from './support/tubeGap';

let person: ReturnType<typeof loadS0028>;
beforeAll(() => {
  person = loadS0028();
}, 60_000);

/** La clasificación sale de un tubo: la luz o la pared de un vaso (lleva su `vesselHit`) o de un conducto (su cara). */
const fromTube = (c: { vesselHit: unknown; interface: Interface }): boolean => c.vesselHit !== null || c.interface === Interface.DuctLumen;

it('la pasada B no hereda el tejido central con un vaso en un plano lateral: la distancia al borde cuenta el tubo vecino (decisión 418)', () => {
  const { scene, anatomy, sample } = person;
  const caliber = anatomy.caliberFor(sample);
  const tr = CONVEX_C35;
  const LINES = 48;
  let pixels = 0,
    looked = 0,
    changed = 0;
  /** Planos laterales dentro de un tubo que la regla dejaría sin clasificar. */
  const missed: string[] = [];
  /** Planos laterales de otro tejido vistos desde una luz lejos de su pared, donde la regla no pregunta por los tubos. */
  const fromLumen: string[] = [];
  const perWindow: Record<string, number> = {};
  for (const sp of startPointsFor(scene.torso, S0028_BUNDLE)) {
    const k = probeContact({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 }, tr, scene.torso);
    const e = k.frame.elevation;
    const saved = anatomy.probeCompression;
    anatomy.setProbeCompression(k);
    try {
      for (let u = 0; u < LINES; u++) {
        const theta = -tr.halfSector + (2 * tr.halfSector * (u + 0.5)) / LINES;
        for (let r = 3; r < 150; r += 1.5) {
          const p = pointOnLine(k.frame, tr, theta, r);
          const c = anatomy.classifyWorld(p, sample);
          if (c.tissue === Tissue.Air) continue;
          pixels++;
          // Cerca de una interfaz la pasada B ya clasificaba los dos planos laterales.
          const se = elevSigmaMm(r, tr.elevationFocusMm, true);
          if (c.boundaryDistance <= se + 0.5) continue;
          const border = boundaryWithTubes(c.boundaryDistance, c.tissue, se, () =>
            tubeGap(scene, anatomy.deformation.toMaterial(p, sample.resp), caliber),
          );
          const sides = [1, -1].map((sgn) =>
            anatomy.classifyWorld([p[0] + sgn * se * e[0], p[1] + sgn * se * e[1], p[2] + sgn * se * e[2]] as Vec3, sample),
          );
          const where = `${sp.id} línea ${u} a ${r} mm: ${Tissue[c.tissue]} con ${sides.map((s) => Tissue[s.tissue]).join(' y ')} a ±σe`;
          if (border > se + 0.5) {
            // Los planos laterales siguen heredando el tejido central: desde una luz deben seguir en ella; desde otro tejido,
            // ninguno puede estar en un tubo.
            if (c.tissue === Tissue.Blood || c.tissue === Tissue.Fluid) {
              if (sides.some((s) => s.tissue !== c.tissue)) fromLumen.push(where);
            } else if (sides.some(fromTube)) missed.push(where);
            continue;
          }
          looked++;
          if (sides.some((s) => s.tissue !== c.tissue)) {
            changed++;
            perWindow[sp.id] = (perWindow[sp.id] ?? 0) + 1;
          }
        }
      }
    } finally {
      anatomy.setProbeCompression(saved);
    }
  }
  const tag = JSON.stringify({ pixels, looked, changed, perWindow });
  expect(missed, tag).toEqual([]);
  // Desde una luz la regla no pregunta por los tubos: su distancia al borde ya es la de su pared. Medido: 4 de 56.429 píxeles,
  // todos en la subxifoidea (sangre de las cavidades y de la unión de la cava con la aurícula), tienen un plano lateral en el
  // miocardio o en la pared de otro vaso: ahí la distancia al borde de la sangre se queda larga. Es anterior a esta decisión y
  // queda declarado (`side-plane-skips-tubes`).
  expect(fromLumen.length, `${fromLumen.join('; ')} ${tag}`).toBeLessThanOrEqual(8);
  // La regla no es vacía. Medido el 17-11-2026 en las once ventanas: 1 de cada 100 píxeles tenía un plano lateral en un vaso que
  // la distancia al borde del plano central no veía, casi todos en el hígado.
  expect(changed, tag).toBeGreaterThan(pixels / 250);
  expect(Object.keys(perWindow).length, tag).toBeGreaterThanOrEqual(8);
  // Ni mira de más: clasificar un plano lateral que resulta ser del mismo tejido cuesta y no cambia la imagen. Medido: 3,7 %.
  expect(looked, tag).toBeLessThan(pixels * 0.08);
});

it('el hueco hasta el tubo vecino es una cota inferior de la distancia a su pared, negativo dentro y 1e3 lejos de todos', () => {
  const { scene, anatomy, sample } = person;
  const caliber = anatomy.caliberFor(sample);
  let outside = 0,
    inside = 0;
  for (const def of scene.vessels.filter((v) => v.flowFactor === undefined)) {
    for (let i = 0; i + 1 < def.tube.nodes.length; i++) {
      const a = def.tube.nodes[i].p,
        b = def.tube.nodes[i + 1].p;
      const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      // dentro de la luz, sobre el eje
      expect(tubeGap(scene, mid, caliber), `${def.id}, eje del tramo ${i}`).toBeLessThan(0);
      inside++;
      for (const offset of [1, 2.5, 4]) {
        for (const dir of [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ] as const) {
          const q: Vec3 = [mid[0] + dir[0] * offset * 3, mid[1] + dir[1] * offset * 3, mid[2] + dir[2] * offset * 3];
          const hit = tubeQuery(q, def.tube, caliber.radiusScale(def.id));
          const own = hit.d - wallThicknessMm(def, hit.r);
          if (def.tube.apScale !== 1 || own < 0 || own > TUBE_GAP_REACH_MM) continue;
          // otro tubo puede quedar más cerca, nunca más lejos; y la cota resta como mucho el ruido del radio
          const gap = tubeGap(scene, q, caliber);
          expect(gap, `${def.id}, tramo ${i}`).toBeLessThanOrEqual(own);
          expect(gap, `${def.id}, tramo ${i}`).toBeGreaterThan(-20);
          expect(own - TUBE_NOISE_MAX * hit.r, `${def.id}, tramo ${i}`).toBeGreaterThanOrEqual(gap - 1e-9);
          outside++;
        }
      }
    }
  }
  expect(inside).toBeGreaterThan(100);
  expect(outside).toBeGreaterThan(200);
  // en el aire, lejos del cuerpo, no hay tubo a su alcance
  expect(tubeGap(scene, [0, 600, 0], caliber)).toBe(1e3);
});
