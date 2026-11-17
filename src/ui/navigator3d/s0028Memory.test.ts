import { Box3, BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { expect, it } from 'vitest';
import type { PersonSurfaces } from '../../anatomy/person';
import { NORMAL_ADULT } from '../../cases';
import { installAnatomyBundle, S0028_BUNDLE } from '../../validation/support/legacyPerson/anatomyBundle';
import { AnatomyScene } from '../../validation/support/legacyPerson/scene';
import { buildSkeleton } from './body';
import { CM } from './common';
import { buildOrgans } from './organs';
import { bindRespiratoryMotion } from './respiratoryMotion';

const s0028Surfaces: PersonSurfaces['indexed'] = ['liver', 'thoracicBone'].map((name) => ({
  name,
  asset: name === 'liver' ? 'abdominal' : 'thoracic',
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
}));

it('conserva los triángulos y su iluminación plana sin duplicarlos en normales CPU/GPU', () => {
  installAnatomyBundle(S0028_BUNDLE);
  const scene = new AnatomyScene(NORMAL_ADULT);
  const groups = [buildOrgans(scene, { indexed: s0028Surfaces }), buildSkeleton(scene, { indexed: s0028Surfaces })];
  for (const group of groups) {
    // La vesícula de s0028 es su pera en ayunas (decisión 413), generada de la misma distancia que la imagen: no es fuente.
    const source = group.children.filter((child) => child.name !== 'gallbladder');
    expect(source).toHaveLength(1);
    const mesh = source[0];
    expect(mesh).toBeInstanceOf(Mesh);
    if (!(mesh instanceof Mesh)) throw new Error('Falta la malla fuente');
    const geometry: unknown = mesh.geometry;
    if (!(geometry instanceof BufferGeometry)) throw new Error('Falta la geometría fuente');
    const surface = s0028Surfaces.find((f) => f.name === mesh.name);
    const position: unknown = geometry.getAttribute('position');
    if (!(position instanceof BufferAttribute)) throw new Error('Falta el atributo de posiciones');
    expect(position.array).toBe(surface?.positions);
    expect(geometry.index?.array).toBe(surface?.indices);
    expect(geometry.getAttribute('normal')).toBeUndefined();
    expect(mesh.material).toBeInstanceOf(MeshStandardMaterial);
    if (!(mesh.material instanceof MeshStandardMaterial)) throw new Error('Falta el material físico');
    expect(mesh.material.flatShading).toBe(true);
    geometry.dispose();
    mesh.material.dispose();
  }
});

it('el torso de s0028 dibuja la vesícula en ayunas de la imagen, no la superficie contraída de su TAC (decisión 413)', () => {
  installAnatomyBundle(S0028_BUNDLE);
  const scene = new AnatomyScene(NORMAL_ADULT);
  // Control: la superficie del TAC llega entre las indexadas, como en la aplicación; antes se dibujaba ella (4,7 ml).
  const ct = { ...s0028Surfaces[0], name: 'gallbladder', positions: s0028Surfaces[0].positions.slice() };
  const organs = buildOrgans(scene, { indexed: [...s0028Surfaces, ct] });
  const drawn = organs.children.filter((child) => child.name === 'gallbladder');
  expect(drawn).toHaveLength(1);
  const pear = drawn[0];
  if (!(pear instanceof Mesh)) throw new Error('Falta la malla de la vesícula');
  const geometry: unknown = pear.geometry;
  if (!(geometry instanceof BufferGeometry)) throw new Error('Falta la geometría de la vesícula');
  const position: unknown = geometry.getAttribute('position');
  if (!(position instanceof BufferAttribute)) throw new Error('Falta el atributo de posiciones');
  expect(position.array).not.toBe(ct.positions);
  // La malla envuelve el fondo y el cuello de la pera de la escena (mm → cm), con su radio.
  organs.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(pear);
  const nodes = scene.gallbladder.nodes;
  for (const node of [nodes[0], nodes[nodes.length - 1]]) {
    const centre = new Vector3(...node.p).multiplyScalar(CM);
    expect(box.containsPoint(centre), node.p.join(',')).toBe(true);
  }
  // Su tamaño es el de la pera (unos 6 cm de diagonal mayor), no el del triángulo de control.
  expect(box.getSize(new Vector3()).length() / CM).toBeGreaterThan(50);
  for (const child of organs.children)
    if (child instanceof Mesh) {
      (child.geometry as BufferGeometry).dispose();
      (child.material as MeshStandardMaterial).dispose();
    }
});

it('al cambiar de caso con respiración activa devuelve la fuente compartida a su reposo exacto', () => {
  installAnatomyBundle(S0028_BUNDLE);
  const scene = new AnatomyScene(NORMAL_ADULT);
  const source = s0028Surfaces.find((f) => f.name === 'liver')?.positions;
  if (!source) throw new Error('Falta la superficie hepática');
  const rest = source.slice();
  // Cada vuelta es un cambio de caso: el 3D nuevo reutiliza la misma fuente y no debe heredar
  // el desplazamiento de la respiración anterior (antes acumulaba 8 → 16 → 24 mm).
  for (let change = 0; change < 3; change++) {
    const organs = buildOrgans(scene, { indexed: s0028Surfaces });
    const breathing = bindRespiratoryMotion([organs], () => 1);
    breathing.apply(8);
    expect(source).not.toEqual(rest);
    breathing.release();
    expect(source).toEqual(rest);
    expect(() => breathing.apply(8)).toThrow();
    for (const mesh of organs.children)
      if (mesh instanceof Mesh) {
        const geometry: unknown = mesh.geometry;
        if (geometry instanceof BufferGeometry) geometry.dispose();
        if (mesh.material instanceof MeshStandardMaterial) mesh.material.dispose();
      }
  }
});
