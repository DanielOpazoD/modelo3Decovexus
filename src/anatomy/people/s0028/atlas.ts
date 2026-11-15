import type { Vec3 } from '../../../core/vec3';
import type { PersonAssets } from '../../personAssets';
import { sourceDistance, sourceDistanceReader, sourceLabel } from '../../sourceVolume';
import { S0028_BUNDLE as B } from './descriptor';
export function createSourceQueries(assets: PersonAssets) {
  const abdominalAtlas = assets.buffers.abdominal,
    thoracicAtlas = assets.buffers.thoracic;
  // La EDT común (rejilla de 3 mm) con sus constantes resueltas una vez: el contacto la lee ~80 000 veces por pose.
  const [o0, o1, o2] = B.depth.originMm,
    [n0, n1, n2] = B.depth.dimensions;
  const depthField = abdominalAtlas ? sourceDistanceReader(abdominalAtlas, B.depth, B.abdominal.textureDimensions) : null;
  /**
   * La EDT común en (x, y, z), sin reservar memoria: la consultan el 3D por vértice y la pared por punto. La proyección a la caja
   * y la lectura en el punto proyectado, con las mismas operaciones y en el mismo orden que antes (`s0028Depth.test.ts`).
   */
  function s0028DepthXyz(x: number, y: number, z: number): number | undefined {
    if (!depthField) return undefined;
    // proyección a la caja de la EDT; lo que sale se suma como distancia euclídea a ella
    const q0 = (x - o0) / 3,
      a0 = Math.max(0, Math.min(n0 - 1, q0)),
      q1 = (y - o1) / 3,
      a1 = Math.max(0, Math.min(n1 - 1, q1)),
      q2 = (z - o2) / 3,
      a2 = Math.max(0, Math.min(n2 - 1, q2));
    const outside = 0 + (q0 - a0) ** 2 + (q1 - a1) ** 2 + (q2 - a2) ** 2;
    return depthField(o0 + a0 * 3, o1 + a1 * 3, o2 + a2 * 3) + Math.sqrt(outside) * 3;
  }
  /** Profundidad bajo la piel s0028 en p (la GPU la lee con `torsoDepth` especializada en `personShader`). @twin s0028-lector */
  function s0028Depth(p: Vec3): number | undefined {
    return s0028DepthXyz(p[0], p[1], p[2]);
  }
  function s0028DepthGradient(p: Vec3): Vec3 | undefined {
    if (!abdominalAtlas) return undefined;
    const [x, y, z] = p;
    return [
      (s0028DepthXyz(x + 1.5, y, z)! - s0028DepthXyz(x - 1.5, y, z)!) / 3,
      (s0028DepthXyz(x, y + 1.5, z)! - s0028DepthXyz(x, y - 1.5, z)!) / 3,
      (s0028DepthXyz(x, y, z + 1.5)! - s0028DepthXyz(x, y, z - 1.5)!) / 3,
    ];
  }

  /**
   * Gas digestivo del TAC, salvo el del estómago (rótulo 1): el modelo idealizado no lleva burbuja gástrica, que en esta persona
   * queda delante de la cava infrahepática y la tapaba en su eje largo (decisión 363). @twin s0028-lector
   */
  function sourceGas(p: Vec3): boolean {
    if (!abdominalAtlas) return false;
    const f = B.fields.find((f) => f.name === 'digestiveTract')!;
    const label = sourceLabel(abdominalAtlas, p, f, B.abdominal.textureDimensions);
    return label >= 128 && label % 128 !== 1;
  }

  /** Consulta CPU de los campos P1 separados; cartílago y pulmón no son una cola ósea. @twin s0028-lector */
  function s0028SourceValue(p: Vec3, name: string): { d: number; label: number } {
    const f = B.fields.find((f) => f.name === name);
    if (!f) throw new Error('Campo s0028 desconocido: ' + name);
    const data = f.asset === 'abdominal' ? abdominalAtlas : thoracicAtlas;
    if (!data) return { d: 16, label: 0 };
    const dimensions = B[f.asset].textureDimensions;
    return { d: sourceDistance(data, p, f, dimensions), label: sourceLabel(data, p, f, dimensions) };
  }

  return { s0028DepthXyz, s0028Depth, s0028DepthGradient, sourceGas, s0028SourceValue };
}
