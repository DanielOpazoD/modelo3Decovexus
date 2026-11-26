import * as THREE from 'three';
import { expect, it } from 'vitest';
import type { Vec3 } from '../../core/vec3';
import { CONVEX_C35, type ProbeFrame } from '../../probe/probe';
import { CM } from './common';
import { buildFan, updateFan } from './probe';

const tr = CONVEX_C35;
/** Marco con los ejes axial y lateral girados `deg` grados alrededor de y y la cara en `face` (mm). */
function frame(deg: number, face: Vec3): ProbeFrame {
  const a = (deg * Math.PI) / 180;
  const axial: Vec3 = [Math.sin(a), 0, Math.cos(a)],
    lateral: Vec3 = [Math.cos(a), 0, -Math.sin(a)];
  const curvatureCenter = face.map((v, i) => v - axial[i] * tr.curvatureRadius) as Vec3;
  return { face, axial, lateral, elevation: [0, 1, 0], curvatureCenter, skinNormal: [0, 0, -1], skinPoint: face };
}

it('el abanico se escribe en sus buffers fijos, con los vértices de la imagen y una esfera que los contiene', () => {
  const { fan, edges } = buildFan();
  updateFan(fan, edges, frame(0, [0, 0, 0]), tr, 160);
  const geometries = [fan.geometry, edges.geometry];
  const attributes = geometries.map((g) => g.getAttribute('position'));
  const versions = attributes.map((a) => (a as THREE.BufferAttribute).version);
  const f = frame(30, [12, -40, 85]),
    depth = 120;
  updateFan(fan, edges, f, tr, depth);
  // Sin geometrías nuevas: tampoco buffers ni VAO nuevos en la GPU.
  expect(fan.geometry).toBe(geometries[0]);
  expect(edges.geometry).toBe(geometries[1]);
  const fp = fan.geometry.getAttribute('position') as THREE.BufferAttribute,
    ep = edges.geometry.getAttribute('position') as THREE.BufferAttribute;
  expect(fp).toBe(attributes[0]);
  expect(ep).toBe(attributes[1]);
  expect(fp.version).toBeGreaterThan(versions[0]);
  expect(ep.version).toBeGreaterThan(versions[1]);
  expect([fp.count, ep.count]).toEqual([120, 44]);
  // Los vértices que compara la e2e probeFreeNavigation: centro + (R + r)·(axial·cos θ + lateral·sen θ), en cm.
  const h = tr.halfSector;
  const at = (theta: number, r: number) =>
    f.curvatureCenter.map((v, i) => (v + (tr.curvatureRadius + r) * (f.axial[i] * Math.cos(theta) + f.lateral[i] * Math.sin(theta))) * CM);
  const check = (attr: THREE.BufferAttribute, vertex: number, theta: number, r: number) =>
    at(theta, r).forEach((v, i) => expect(attr.getComponent(vertex, i), `vértice ${vertex}`).toBeCloseTo(v, 5));
  for (const [vertex, theta, r] of [
    [0, -h, 0],
    [1, -h, depth],
    [116, h, 0],
    [119, h, depth],
    [61, 0, depth],
  ])
    check(fp, vertex, theta, r);
  for (const [vertex, theta, r] of [
    [0, -h, depth],
    [39, h, depth],
    [40, -h, 0],
    [41, -h, depth],
    [42, h, 0],
    [43, h, depth],
  ])
    check(ep, vertex, theta, r);
  // Coordenadas del mundo con el objeto quieto: la esfera de recorte debe seguir a la pose nueva.
  for (const g of [fan.geometry, edges.geometry]) {
    const sphere = g.boundingSphere!,
      p = g.getAttribute('position') as THREE.BufferAttribute;
    expect(sphere).not.toBeNull();
    for (let i = 0; i < p.count; i++)
      expect(sphere.center.distanceTo(new THREE.Vector3().fromBufferAttribute(p, i))).toBeLessThanOrEqual(sphere.radius + 1e-6);
  }
});
