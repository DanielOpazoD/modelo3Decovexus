import * as THREE from 'three';
import type { Vec3 } from '../../core/vec3';
import { RespiratoryDeformation } from '../../anatomy/deformation';
import { CM } from './common';

/** Rest-space weights for the same respiratory field as anatomy. Roots use LAS centimetres.
 * Does not model probe compression. Construct lazily: OFF needs no vertex work or allocation.
 */
export function bindRespiratoryMotion(
  roots: THREE.Group[],
  weightAt: (m: Vec3) => number,
): { apply: (mm: number) => void; release: () => void } {
  const meshes: Array<{
    geometry: THREE.BufferGeometry;
    rest: Float32Array;
    normals: Float32Array | null;
    /** Normal sin normalizar de cada vértice, N₀ + mm·N₁ (la misma suma de `computeVertexNormals`, exacta en mm). */
    linear: { n0: Float64Array; n1: Float64Array } | null;
    weights: Float32Array;
    direction: THREE.Vector3;
    /** Envolventes de reposo y el mayor peso: con ellas, las del desplazamiento sin recorrer los vértices. */
    sphere: THREE.Sphere;
    box: THREE.Box3 | null;
    maxWeight: number;
  }> = [];
  const labels: Array<{ object: THREE.Sprite; rest: THREE.Vector3; direction: THREE.Vector3; weight: number }> = [];
  const seen = new Set<THREE.BufferGeometry>();
  const read = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
    const out = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) out.set([a.getX(i), a.getY(i), a.getZ(i)], i * 3);
    return out;
  };
  const direction = (toMaterial: THREE.Matrix4) =>
    new THREE.Vector3(...RespiratoryDeformation.direction)
      .multiplyScalar(CM)
      .applyMatrix3(new THREE.Matrix3().setFromMatrix4(toMaterial.clone().invert()));
  const checkedWeight = (p: THREE.Vector3) => {
    const w = weightAt([p.x / CM, p.y / CM, p.z / CM]);
    if (!Number.isFinite(w) || w < 0 || w > 1) throw new Error('Peso respiratorio 3D inválido');
    return w;
  };
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    const inverseRoot = root.matrixWorld.clone().invert();
    root.traverse((object) => {
      const toMaterial = inverseRoot.clone().multiply(object.matrixWorld);
      if (object instanceof THREE.Sprite) {
        const sprite = object as THREE.Sprite;
        const parentToMaterial = inverseRoot.clone().multiply(object.parent!.matrixWorld);
        labels.push({
          object: sprite,
          rest: sprite.position.clone(),
          direction: direction(parentToMaterial),
          weight: checkedWeight(new THREE.Vector3().setFromMatrixPosition(toMaterial)),
        });
      } else if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
        // Shared geometries may sit in different transforms and therefore need different weights.
        if (seen.has(mesh.geometry)) mesh.geometry = mesh.geometry.clone();
        seen.add(mesh.geometry);
        const geometry = mesh.geometry,
          position = geometry.getAttribute('position');
        if (!position) return;
        // Las escrituras por cuadro van directas al arreglo: un atributo entrelazado, normalizado o de otro tipo se copia antes a
        // Float32 plano de tres componentes (los mismos valores).
        for (const name of ['position', 'normal'] as const) {
          const a = geometry.getAttribute(name);
          if (a && !(a instanceof THREE.BufferAttribute && a.array instanceof Float32Array && a.itemSize === 3 && !a.normalized))
            geometry.setAttribute(name, new THREE.BufferAttribute(read(a), 3));
        }
        const rest = read(position),
          weights = new Float32Array(position.count),
          p = new THREE.Vector3();
        for (let i = 0; i < position.count; i++) weights[i] = checkedWeight(p.fromBufferAttribute(position, i).applyMatrix4(toMaterial));
        const normal = geometry.getAttribute('normal');
        const d = direction(toMaterial);
        geometry.computeBoundingSphere();
        meshes.push({
          geometry,
          rest,
          normals: normal ? read(normal) : null,
          linear: normal ? linearNormals(geometry.index, rest, weights, d) : null,
          weights,
          direction: d,
          sphere: geometry.boundingSphere!.clone(),
          box: geometry.boundingBox ? geometry.boundingBox.clone() : null,
          maxWeight: weights.reduce((a, b) => Math.max(a, b), 0),
        });
      }
    });
  }
  let lastMm = 0,
    released = false;
  const binding = {
    apply(mm: number) {
      if (released) throw new Error('Respiración 3D ya liberada');
      if (!Number.isFinite(mm)) throw new Error('Desplazamiento respiratorio 3D inválido');
      if (mm === lastMm) return;
      lastMm = mm;
      for (const { geometry, rest, normals, linear, weights, direction: d, sphere, box, maxWeight } of meshes) {
        // Escritura directa en los arreglos: posiciones y normales son Float32 sin normalizar, donde setXYZ escribe lo mismo; con
        // millones de vértices por cuadro, su paso por el atributo era la mitad del coste.
        const p = geometry.getAttribute('position') as THREE.BufferAttribute,
          pa = p.array as Float32Array;
        if (mm === 0) pa.set(rest);
        else
          for (let i = 0; i < p.count; i++) {
            const a = mm * weights[i];
            pa[3 * i] = rest[3 * i] + a * d.x;
            pa[3 * i + 1] = rest[3 * i + 1] + a * d.y;
            pa[3 * i + 2] = rest[3 * i + 2] + a * d.z;
          }
        p.needsUpdate = true;
        if (normals) {
          const normal = geometry.getAttribute('normal') as THREE.BufferAttribute,
            na = normal.array as Float32Array;
          if (mm === 0) na.set(normals);
          else {
            // lo que daría `computeVertexNormals` sobre la malla desplazada, sin recorrer sus triángulos en cada cuadro
            const { n0, n1 } = linear!;
            for (let i = 0; i < normal.count; i++) {
              const x = n0[3 * i] + mm * n1[3 * i],
                y = n0[3 * i + 1] + mm * n1[3 * i + 1],
                z = n0[3 * i + 2] + mm * n1[3 * i + 2],
                l = Math.sqrt(x * x + y * y + z * z) || 1;
              na[3 * i] = x / l;
              na[3 * i + 1] = y / l;
              na[3 * i + 2] = z / l;
            }
          }
          normal.needsUpdate = true;
        }
        // Envolventes que contienen la malla desplazada: cada vértice se mueve a lo sumo |mm|·peso máximo·|d|.
        const reach = Math.abs(mm) * maxWeight;
        geometry.boundingSphere = new THREE.Sphere(sphere.center.clone(), sphere.radius + reach * d.length());
        if (box) {
          const s = d.clone().multiplyScalar(mm * maxWeight);
          geometry.boundingBox = new THREE.Box3(
            box.min.clone().add(new THREE.Vector3(Math.min(0, s.x), Math.min(0, s.y), Math.min(0, s.z))),
            box.max.clone().add(new THREE.Vector3(Math.max(0, s.x), Math.max(0, s.y), Math.max(0, s.z))),
          );
        }
      }
      for (const label of labels) {
        label.object.position.copy(label.rest);
        if (mm !== 0) label.object.position.addScaledVector(label.direction, mm * label.weight);
      }
    },
    /** Vuelve al reposo exacto antes de soltar los buffers: las mallas s0028 comparten su
     * Float32Array con la fuente y el siguiente caso la reutiliza como reposo. */
    release() {
      if (released) return;
      binding.apply(0);
      released = true;
    },
  };
  return binding;
}

/**
 * La suma de `computeVertexNormals` (productos vectoriales de cada triángulo, sin normalizar) como función del desplazamiento
 * respiratorio mm, con las posiciones rest + mm·w·d. Los dos lados de un triángulo se desplazan a lo largo de la misma d, así que el
 * término en mm² del producto vectorial se anula: la suma es exactamente N₀ + mm·N₁.
 */
function linearNormals(
  index: THREE.BufferAttribute | null,
  rest: Float32Array,
  weights: Float32Array,
  d: THREE.Vector3,
): { n0: Float64Array; n1: Float64Array } {
  const count = rest.length / 3,
    n0 = new Float64Array(rest.length),
    n1 = new Float64Array(rest.length);
  const triangles = index ? index.count : count;
  for (let t = 0; t + 2 < triangles; t += 3) {
    const a = index ? index.getX(t) : t,
      b = index ? index.getX(t + 1) : t + 1,
      c = index ? index.getX(t + 2) : t + 2;
    // cb = C − B y ab = A − B en reposo (u, v) y sus derivadas en mm (du = (wC − wB)·d, dv = (wA − wB)·d)
    const ux = rest[3 * c] - rest[3 * b],
      uy = rest[3 * c + 1] - rest[3 * b + 1],
      uz = rest[3 * c + 2] - rest[3 * b + 2],
      vx = rest[3 * a] - rest[3 * b],
      vy = rest[3 * a + 1] - rest[3 * b + 1],
      vz = rest[3 * a + 2] - rest[3 * b + 2],
      fu = weights[c] - weights[b],
      fv = weights[a] - weights[b];
    // u×v y u×(fv·d) + (fu·d)×v
    const cx = uy * vz - uz * vy,
      cy = uz * vx - ux * vz,
      cz = ux * vy - uy * vx,
      ex = fv * (uy * d.z - uz * d.y) + fu * (d.y * vz - d.z * vy),
      ey = fv * (uz * d.x - ux * d.z) + fu * (d.z * vx - d.x * vz),
      ez = fv * (ux * d.y - uy * d.x) + fu * (d.x * vy - d.y * vx);
    for (const v of [a, b, c]) {
      n0[3 * v] += cx;
      n0[3 * v + 1] += cy;
      n0[3 * v + 2] += cz;
      n1[3 * v] += ex;
      n1[3 * v + 1] += ey;
      n1[3 * v + 2] += ez;
    }
  }
  return { n0, n1 };
}
