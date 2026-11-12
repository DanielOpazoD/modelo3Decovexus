/**
 * Ventanas de inicio de s0028: los hitos de esta persona que cada ventana debe mostrar y la puntuación de una pose con lo que
 * vería un ecografista: el hito dentro del sector y sin hueso, pulmón ni cartílago delante; sector acoplado y limpio. La usan la
 * búsqueda (`find-s0028-poses.ts`) y la prueba (`s0028Windows.test.ts`): la misma medida decide la pose y la vigila.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { AnatomyQuery } from '../../src/anatomy/query';
import { Tissue } from '../../src/anatomy/tissues';
import { NORMAL_ADULT } from '../../src/cases';
import { dot, length, sub, type Vec3 } from '../../src/core/vec3';
import { PhysiologyEngine, type PhysiologySample } from '../../src/physiology/engine';
import type { VesselId } from '../../src/physiology/vessels';
import { contactCoupling, probeContact } from '../../src/probe/contact';
import { CONVEX_C35 as TR, pointOnLine, type ProbePose } from '../../src/probe/probe';
import { setAbdominalAtlas } from '../../src/validation/support/legacyPerson/abdominalAtlas';
import { S0028_BUNDLE, installAnatomyBundle } from '../../src/validation/support/legacyPerson/anatomyBundle';
import { setAbdominalBody } from '../../src/validation/support/legacyPerson/referenceBody';
import { setS0028Solids } from '../../src/validation/support/legacyPerson/s0028Solids';
import { setS0028Wall } from '../../src/validation/support/legacyPerson/s0028Wall';
import { AnatomyScene } from '../../src/validation/support/legacyPerson/scene';
import { setThoracicAtlas } from '../../src/validation/support/legacyPerson/thoracicAtlas';

/** La persona s0028 completa en Node, con la fisiología del adulto sano en apnea espiratoria. */
export function loadS0028(): { scene: AnatomyScene; anatomy: AnatomyQuery; sample: PhysiologySample } {
  const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
  installAnatomyBundle(S0028_BUNDLE);
  setAbdominalAtlas(new Uint16Array(raw('abdominal-direct')));
  setThoracicAtlas(new Uint16Array(raw('thoracic-direct')));
  const capacity = raw('annotation-capacity');
  setS0028Wall(capacity, raw('skin-polar'));
  setS0028Solids(capacity);
  setAbdominalBody(new Float32Array(new Uint8Array(readFileSync('src/anatomy/abdominal-body.bin')).buffer));
  const scene = new AnatomyScene(NORMAL_ADULT);
  const engine = new PhysiologyEngine({ ...NORMAL_ADULT, respiratoryPattern: 'apnea-expiratory' }, scene.vesselAreas());
  for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
  return { scene, anatomy: new AnatomyQuery(scene), sample: engine.sample };
}

export interface WindowTarget {
  id: string;
  /** Región de la piel donde se busca el apoyo. */
  phi: [number, number];
  z: [number, number];
  depthMm: number;
  /** Puntos del hito que deben verse, su centro de mira y la dirección que debe contener el plano. */
  points: Vec3[];
  pivot: Vec3;
  long: Vec3;
  /** Tejido que debe ocupar el campo cercano y medio (el hígado como ventana). */
  through?: Tissue;
}
export interface WindowScore {
  /** Fracción de los puntos del hito dentro del sector y sin barrera delante, y cuán centrados quedan. */
  seen: number;
  centred: number;
  /** Fracción de líneas acopladas y fracción de su profundidad libre de barreras. */
  coupled: number;
  clear: number;
  through: number;
  score: number;
}
const BLOCK = new Set<Tissue>([Tissue.Bone, Tissue.Vertebra, Tissue.Lung, Tissue.Cartilage]);
const LINES = 25;

export function scoreWindow(anatomy: AnatomyQuery, sample: PhysiologySample, pose: ProbePose, t: WindowTarget): WindowScore {
  const contact = probeContact(pose, TR, anatomy.scene.torso);
  anatomy.setProbeCompression(contact);
  const f = contact.frame;
  const tissueAt = (theta: number, r: number) => anatomy.classifyWorld(pointOnLine(f, TR, theta, r), sample).tissue;
  let seen = 0,
    centred = 0;
  for (const p of t.points) {
    const d = sub(p, f.curvatureCenter),
      r = length(d) - TR.curvatureRadius,
      theta = Math.atan2(dot(d, f.lateral), dot(d, f.axial));
    if (r < 25 || r > t.depthMm - 15 || Math.abs(theta) > 0.85 * TR.halfSector || Math.abs(dot(d, f.elevation)) > 4) continue;
    let blocked = contactCoupling(contact, theta) < 0.5;
    for (let rr = 2; rr < r && !blocked; rr += 2) blocked = BLOCK.has(tissueAt(theta, rr));
    if (blocked) continue;
    seen++;
    centred += 1 - Math.abs(theta) / TR.halfSector;
  }
  let coupled = 0,
    clear = 0,
    through = 0,
    samples = 0;
  for (let i = 0; i < LINES; i++) {
    const theta = -TR.halfSector + (2 * TR.halfSector * (i + 0.5)) / LINES;
    if (contactCoupling(contact, theta) < 0.5) continue;
    coupled++;
    let r = 3;
    for (; r < t.depthMm; r += 4) {
      const tissue = tissueAt(theta, r);
      if (BLOCK.has(tissue)) break;
      samples++;
      if (tissue === t.through) through++;
    }
    clear += Math.min(1, r / t.depthMm);
  }
  const q = {
    seen: seen / t.points.length,
    centred: centred / t.points.length,
    coupled: coupled / LINES,
    clear: clear / LINES,
    through: samples ? through / samples : 0,
  };
  return { ...q, score: 4 * q.seen + q.centred + 1.5 * q.clear + q.coupled + (t.through === undefined ? 0 : q.through) };
}

/** Riñón derecho de s0028: centro y eje largo de su máscara (componentes principales), en mm LAS. */
const KIDNEY = { center: [-50.5, -27.7, -128.1] as Vec3, u: [0.274, -0.462, 0.844] as Vec3 };

function along(nodes: Vec3[], step = 5): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const n = Math.max(1, Math.round(length(sub(nodes[i + 1], nodes[i])) / step));
    for (let k = 0; k < n; k++) out.push(nodes[i].map((x, j) => x + ((nodes[i + 1][j] - x) * k) / n) as Vec3);
  }
  return [...out, nodes[nodes.length - 1]];
}

/** Lo que debe mostrar cada ventana en esta persona: la porta de sus máscaras, su riñón y, por ahora, la suprahepática estimada. */
export function s0028WindowTargets(scene: AnatomyScene): WindowTarget[] {
  const tube = (id: VesselId) => along(scene.vesselById.get(id)!.tube.nodes.map((n) => n.p));
  const mid = (p: Vec3[]): Vec3 => p[Math.floor(p.length / 2)];
  const kidney = [-35, -18, 0, 18, 35].map((d) => KIDNEY.center.map((x, i) => x + d * KIDNEY.u[i]) as Vec3);
  const trunk = tube('pvTrunk'),
    right = tube('pvRight'),
    left = along(
      scene.vesselById
        .get('pvLeft')!
        .tube.nodes.slice(0, 4)
        .map((n) => n.p),
    ),
    hv = tube('hvRight');
  const liver = Tissue.Liver;
  return [
    {
      id: 'portal',
      phi: [2.5, 3.6],
      z: [-120, -30],
      depthMm: 130,
      points: [...trunk.slice(-5), ...right],
      pivot: mid(right),
      long: sub(right.at(-1)!, trunk.at(-5)!),
      through: liver,
    },
    {
      id: 'portalTrunk',
      phi: [2.3, 3.6],
      z: [-140, -40],
      depthMm: 160,
      points: trunk,
      pivot: mid(trunk),
      long: sub(trunk.at(-1)!, trunk[0]),
      through: liver,
    },
    {
      id: 'portalSubcostal',
      phi: [1.5, 2.7],
      z: [-130, -50],
      depthMm: 150,
      points: [...left.slice().reverse(), ...right],
      pivot: right[0],
      long: sub(right.at(-1)!, left.at(-1)!),
      through: liver,
    },
    {
      id: 'intercostal',
      phi: [2.3, 3.4],
      z: [-90, 0],
      depthMm: 180,
      points: hv,
      pivot: mid(hv),
      long: sub(hv.at(-1)!, hv[0]),
      through: liver,
    },
    {
      id: 'hepatorenal',
      phi: [2.7, 3.5],
      z: [-180, -80],
      depthMm: 140,
      points: kidney,
      pivot: KIDNEY.center,
      long: KIDNEY.u,
      through: liver,
    },
    { id: 'renal', phi: [3.0, 4.0], z: [-190, -90], depthMm: 140, points: kidney, pivot: KIDNEY.center, long: KIDNEY.u },
  ];
}
