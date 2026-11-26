import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ProbeFrame, Transducer } from '../../probe/probe';
import { CM } from './common';

/** Sonda convexa procedural (lente, cabezal, mango, marcador) y abanico del plano de imagen. */
export function buildProbe(tr: Transducer): { probe: THREE.Group; marker: THREE.Group } {
  const probe = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0xd7dbe0, roughness: 0.5, metalness: 0.05 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x23282e, roughness: 0.25, side: THREE.DoubleSide });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.8 });
  const collar = new THREE.MeshStandardMaterial({ color: 0x8b939c, roughness: 0.55, metalness: 0.1 });
  const R = tr.curvatureRadius * CM;
  const half = (tr.footprintMm / 2) * CM;
  const el = (tr.elevationMm / 2) * CM;
  const halfAng = Math.asin(Math.min(1, half / R));
  // Lente: arco de cilindro de radio R (eje = elevación) centrado en z = −R, abierto hacia +z
  const lensGeo = new THREE.CylinderGeometry(R, R, el * 2, 40, 1, true, -halfAng, 2 * halfAng);
  const lensMesh = new THREE.Mesh(lensGeo, lens);
  lensMesh.position.z = -R;
  const sag = R - Math.sqrt(R * R - half * half);
  const head = new THREE.Mesh(new RoundedBoxGeometry(half * 2 + 0.3, el * 2 + 0.4, 2.0, 4, 0.3), shell);
  head.position.z = -sag - 1.1;
  const shoulder = new THREE.Mesh(
    new THREE.LatheGeometry(
      [new THREE.Vector2(2.4, 0), new THREE.Vector2(2.3, 0.4), new THREE.Vector2(1.7, 1.0), new THREE.Vector2(1.2, 1.6)],
      28,
    ),
    shell,
  );
  shoulder.rotation.x = -Math.PI / 2;
  shoulder.scale.set(1, 1, 0.7);
  shoulder.position.z = -sag - 2.1;
  const rs = [1.2, 1.25, 1.2, 1.1, 1.0, 1.0, 1.08, 1.12, 1.06, 0.9];
  const profile = rs.map((r, i) => new THREE.Vector2(r, (i / (rs.length - 1)) * 7.4));
  profile.push(new THREE.Vector2(0.6, 7.5), new THREE.Vector2(0, 7.56));
  const handle = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), shell);
  handle.rotation.x = -Math.PI / 2;
  handle.scale.set(1, 1, 0.74);
  handle.position.z = -sag - 3.6;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.9, 0.32, 24), collar);
  band.rotation.x = Math.PI / 2;
  band.position.z = -sag - 11.0;
  const relief = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.7, 1.4, 20), rubber);
  relief.rotation.x = -Math.PI / 2;
  relief.position.z = -sag - 11.9;
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, -sag - 12.5),
        new THREE.Vector3(0.2, 0.6, -sag - 14.5),
        new THREE.Vector3(0.8, 2.4, -sag - 16.8),
      ]),
      14,
      0.3,
      10,
      false,
    ),
    rubber,
  );
  const marker = new THREE.Group();
  const ridge = new THREE.Mesh(
    new RoundedBoxGeometry(0.3, 0.7, 1.2, 2, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2f7fd0, roughness: 0.45 }),
  );
  ridge.position.set(half + 0.3, 0, -sag - 1.3);
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x5cb0ee, emissive: 0x123c5e, roughness: 0.35 }),
  );
  dot.position.set(half + 0.15, 0, -sag - 2.9);
  // Same marked end, also visible on the outward housing face toward the operator.
  // Rigid local geometry: never billboard it or change the acoustic frame.
  const topMark = new THREE.Mesh(
    new RoundedBoxGeometry(0.65, 0.9, 0.16, 2, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x5cb0ee, emissive: 0x123c5e, roughness: 0.35 }),
  );
  topMark.position.set(half * 0.78, 0, -sag - 2.18);
  marker.add(ridge, dot, topMark);
  probe.add(lensMesh, head, shoulder, handle, band, relief, cable, marker);
  return { probe, marker };
}

/** Segmentos del arco del abanico: 6 vértices cada uno (dos triángulos) y 2 de borde distal, más los dos radios. */
const FAN_SEGMENTS = 20;
const positions = (vertices: number): THREE.BufferGeometry =>
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));

export function buildFan(): { fan: THREE.Mesh; edges: THREE.LineSegments } {
  const fan = new THREE.Mesh(
    positions(FAN_SEGMENTS * 6),
    new THREE.MeshBasicMaterial({ color: 0x3fb6a8, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  fan.renderOrder = 4;
  const edges = new THREE.LineSegments(
    positions(FAN_SEGMENTS * 2 + 4),
    new THREE.LineBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.7 }),
  );
  edges.renderOrder = 5;
  return { fan, edges };
}

/** Escribe el abanico en sus buffers fijos: sin geometrías, buffers ni VAO nuevos en cada redibujo. */
export function updateFan(fan: THREE.Mesh, edges: THREE.LineSegments, fr: ProbeFrame, tr: Transducer, depthMm: number): void {
  const n = FAN_SEGMENTS,
    h = tr.halfSector;
  const fp = fan.geometry.getAttribute('position') as THREE.BufferAttribute;
  const ep = edges.geometry.getAttribute('position') as THREE.BufferAttribute;
  const [cx, cy, cz] = fr.curvatureCenter,
    a = fr.axial,
    l = fr.lateral;
  const put = (attr: THREE.BufferAttribute, vertex: number, theta: number, r: number): void => {
    const c = Math.cos(theta),
      s = Math.sin(theta),
      k = (tr.curvatureRadius + r) * CM;
    attr.setXYZ(vertex, cx * CM + (a[0] * c + l[0] * s) * k, cy * CM + (a[1] * c + l[1] * s) * k, cz * CM + (a[2] * c + l[2] * s) * k);
  };
  for (let i = 0; i < n; i++) {
    const t0 = -h + (2 * h * i) / n,
      t1 = -h + (2 * h * (i + 1)) / n,
      v = 6 * i;
    put(fp, v, t0, 0);
    put(fp, v + 1, t0, depthMm);
    put(fp, v + 2, t1, 0);
    put(fp, v + 3, t1, 0);
    put(fp, v + 4, t0, depthMm);
    put(fp, v + 5, t1, depthMm);
    put(ep, 2 * i, t0, depthMm);
    put(ep, 2 * i + 1, t1, depthMm);
  }
  put(ep, 2 * n, -h, 0);
  put(ep, 2 * n + 1, -h, depthMm);
  put(ep, 2 * n + 2, h, 0);
  put(ep, 2 * n + 3, h, depthMm);
  fp.needsUpdate = ep.needsUpdate = true;
  // Vértices en coordenadas del mundo: sin recalcular la esfera, el recorte por frustum usaría la de la pose anterior.
  fan.geometry.computeBoundingSphere();
  edges.geometry.computeBoundingSphere();
}
