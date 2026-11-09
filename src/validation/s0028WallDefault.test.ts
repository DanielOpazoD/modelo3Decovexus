import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { installDefaultCpu } from '../anatomy/people/default/cpu';
import { tubeQuery } from '../anatomy/primitives';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import baseline from './fixtures/s0028-wall-default.json';
import { AnatomyScene, BASELINE_CALIBER, vesselApScale, wallThicknessMm, type Classification } from './support/legacyPerson/scene';

it('conserva el hash histórico y limita los cambios actuales a la geometría vascular aprobada', () => {
  const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/${name}-atlas.gzip.bin`))).buffer;
  const person = installDefaultCpu({
    abdominal: new Uint16Array(raw('abdominal')),
    thoracic: new Uint16Array(raw('thoracic')),
    body: new Float32Array(new Uint8Array(readFileSync('src/anatomy/abdominal-body.bin')).buffer),
  });
  // Decisión 337: conservar el hash de referencia, no sustituirlo por el resultado nuevo.
  const reference = new AnatomyScene(NORMAL_ADULT, undefined, {
    ...person,
    cpu: { ...person.cpu, curveVessels: undefined },
  });
  const scene = new AnatomyScene(NORMAL_ADULT, undefined, person),
    hash = createHash('sha256');
  const changed = scene.vessels.filter((v) => !reference.vessels.some((old) => JSON.stringify(v) === JSON.stringify(old)));
  const previous = reference.vessels.filter((v) => !scene.vessels.some((now) => JSON.stringify(v) === JSON.stringify(now)));
  const allowed = [
    'hvCommonTrunk',
    'hvLeft',
    'hvLeftTributary',
    'hvMiddle',
    'hvMiddleTributary',
    'hvRight',
    'hvRightAnterior',
    'hvRightPosterior',
    'pvLeftLateral',
    'pvLeftMedial',
    'pvRightAnterior',
    'pvRightPosterior',
  ].sort();
  expect([...new Set([...changed, ...previous].map((v) => v.id))].sort()).toEqual(allowed);
  expect(scene.ducts).toEqual(reference.ducts);
  for (const [id, v] of scene.vesselById) {
    const { tube: _tube, ...properties } = v;
    const { tube: _oldTube, ...oldProperties } = reference.vesselById.get(id)!;
    expect(properties).toEqual(oldProperties);
  }
  // Las ramas procedurales se regeneran: pueden redistribuir plazas entre familias y no tienen
  // un índice o VesselId único persistente. Unir los dominios geométricos anterior/nuevo completos.
  const inChangedVessel = (p: Vec3) =>
    [...previous, ...changed].some((v) => {
      const h = tubeQuery(
        p,
        { ...v.tube, apScale: vesselApScale(v.id, v.tube.apScale, BASELINE_CALIBER) },
        BASELINE_CALIBER.radiusScale(v.id),
      );
      return h.d < wallThicknessMm(v, h.r);
    });
  const semantic = (p: Vec3, c: Classification) =>
    JSON.stringify([p, c.tissue, c.interface, c.vessel, c.vesselHit?.segment ?? null, c.flowFactor]);
  const permitted = (p: Vec3, a: Classification, b: Classification) => semantic(p, a) === semantic(p, b) || inChangedVessel(p);
  let differences = 0;
  let samples = 0;
  for (let z = -210; z <= 60; z += 7.5)
    for (let y = -130; y <= 160; y += 7.5)
      for (let x = -210; x <= 210; x += 7.5) {
        const p: Vec3 = [x, y, z];
        const c = reference.classify(p, BASELINE_CALIBER),
          current = scene.classify(p, BASELINE_CALIBER);
        if (semantic(p, c) !== semantic(p, current)) differences++;
        expect(permitted(p, c, current), p.join(',')).toBe(true);
        // El recibo externo compara además todos los valores Float64 y diez marcos exactamente.
        // La regresión portable fija categorías/topología, sin hashear redondeos de libm entre CPU.
        hash.update(JSON.stringify([p, c.tissue, c.interface, c.vessel, c.vesselHit?.segment ?? null, c.flowFactor]));
        samples++;
      }
  expect(samples).toBe(baseline.samples);
  expect(hash.digest('hex')).toBe(baseline.semanticSha256);
  expect(differences).toBeGreaterThan(0);
  // El dominio no puede justificar una mutación ajena (aire convertido en sangre).
  const exterior: Vec3 = [210, 160, 60],
    c = reference.classify(exterior, BASELINE_CALIBER);
  expect(c.tissue).not.toBe(Tissue.Blood);
  expect(inChangedVessel(exterior)).toBe(false);
  expect(permitted(exterior, c, { ...c, tissue: Tissue.Blood })).toBe(false);
});
