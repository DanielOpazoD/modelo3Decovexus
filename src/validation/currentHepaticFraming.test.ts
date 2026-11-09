import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { Tissue, TISSUES } from '../anatomy/tissues';
import { startPointsFor } from '../app/startPoints';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { contactCoupling, probeContact } from '../probe/contact';
import { CONVEX_C35, pointOnLine, type ProbePose } from '../probe/probe';
import { setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { setAbdominalBody } from './support/legacyPerson/referenceBody';
import { fixturePerson } from './support/legacyPerson/state';
import { AnatomyScene } from './support/legacyPerson/scene';
import { setThoracicAtlas } from './support/legacyPerson/thoracicAtlas';
beforeAll(() => {
  const load = (name: string) => {
    const b = gunzipSync(readFileSync(`src/anatomy/${name}-atlas.gzip.bin`));
    return new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  setAbdominalAtlas(load('abdominal'));
  setThoracicAtlas(load('thoracic'));
  const b = readFileSync('src/anatomy/abdominal-body.bin');
  setAbdominalBody(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
});
afterAll(() => {
  setAbdominalAtlas();
  setThoracicAtlas();
  setAbdominalBody();
});

// Referencia histórica de la decisión 335: geometría y pose anteriores fijas.
// La decisión 337 curva también el vaso visto desde la pose antigua; no mover el comparador.
const windows = [
  { id: 'intercostal', vessel: 'hvRight', old: { phi: 2.5, z: -35, yaw: -1.2, rock: 0.08958884100807597, tilt: 0.15439831127567974 } },
  {
    id: 'subcostal',
    vessel: 'hvMiddle',
    old: { phi: 2, z: -80, yaw: 0.6280025227578521, rock: 0.3259201915316282, tilt: -0.03886141881794285 },
  },
] as const;
for (const base of [NORMAL_ADULT, SEVERE_CONGESTION])
  for (const w of windows)
    it(`${base.id}/${w.id}: follows more hepatic-vein lumen without moving organs or losing the acoustic approach`, () => {
      const patient = { ...base, respiratoryPattern: 'apnea-expiratory' as const };
      const scene = new AnatomyScene(patient),
        query = new AnatomyQuery(scene),
        engine = new PhysiologyEngine(patient, scene.vesselAreas());
      while (engine.clock.t < 30) engine.step();
      const sample = engine.sample;
      const reference = new AnatomyScene(patient, undefined, {
        ...fixturePerson(),
        cpu: { ...fixturePerson().cpu, curveVessels: undefined },
      });
      const scan = (pose: ProbePose, target = scene, targetQuery = query) => {
        const k = probeContact(pose, CONVEX_C35, target.torso);
        targetQuery.setProbeCompression(k);
        let min = Infinity,
          max = -Infinity,
          area = 0,
          count = 0,
          visible = 0,
          coupling = 0,
          cos = 0;
        for (let u = 0; u < 65; u++) {
          const theta = (((u + 0.5) / 65) * 2 - 1) * CONVEX_C35.halfSector;
          let blocked = contactCoupling(k, theta) < 0.9;
          if (!blocked) coupling++;
          for (let r = 1; r < 180; r += 2) {
            const q = targetQuery.classifyWorld(pointOnLine(k.frame, CONVEX_C35, theta, r), sample);
            if (TISSUES[q.tissue].bone || TISSUES[q.tissue].gas) blocked = true;
            if (q.vessel !== w.vessel || q.tissue !== Tissue.Blood) continue;
            count++;
            if (blocked) continue;
            visible++;
            min = Math.min(min, q.vesselHit!.arc);
            max = Math.max(max, q.vesselHit!.arc);
            area += ((((CONVEX_C35.curvatureRadius + r) * 2 * CONVEX_C35.halfSector) / 65) * 2) / 100;
            const f = q.flowBasis;
            if (f && q.vesselHit!.rho < 0.75) {
              const beam = k.frame.axial.map((v, i) => v * Math.cos(theta) + k.frame.lateral[i] * Math.sin(theta));
              const len = Math.hypot(...f);
              if (len > 0) cos = Math.max(cos, Math.abs(f[0] * beam[0] + f[1] * beam[1] + f[2] * beam[2]) / len);
            }
          }
        }
        return { span: max - min, area, visibleFraction: visible / count, coupling: coupling / 65, cos };
      };
      const p = startPointsFor(scene.torso, { person: 'current' }).find((p) => p.id === w.id)!;
      const saved = { ...p, rock: p.rock ?? 0, tilt: p.tilt ?? 0, lift: 0 };
      const before = scan({ ...w.old, lift: 0 }, reference, new AnatomyQuery(reference));
      const accepted = (after: ReturnType<typeof scan>) =>
        after.span > before.span * (base.id === 'normal-adult' ? 1.5 : 1) &&
        after.area > before.area * 1.25 &&
        after.visibleFraction > 0.9 &&
        after.coupling >= before.coupling &&
        after.cos > 0.5;
      // La referencia conserva el contrato original y la escena actual debe superarlo también.
      for (const after of [scan(saved, reference, new AnatomyQuery(reference)), scan(saved)]) {
        // A congested vein already intersects more of the old plane. Require a genuine gain
        // in both cases, not the same relative elongation for different vessel calibers.
        expect(after.span).toBeGreaterThan(before.span);
        if (base.id === 'normal-adult') expect(after.span).toBeGreaterThan(before.span * 1.5);
        expect(after.area).toBeGreaterThan(before.area * 1.25);
        expect(after.visibleFraction).toBeGreaterThan(0.9);
        expect(after.coupling).toBeGreaterThanOrEqual(before.coupling);
        expect(after.cos).toBeGreaterThan(0.5);
        expect(accepted(after)).toBe(true);
      }
      // Contrafactual: volver a la pose antigua no cumple el contrato, incluso con el vaso curvo.
      expect(accepted(scan({ ...w.old, lift: 0 }))).toBe(false);
      expect(engine.sample).toBe(sample);
    });
