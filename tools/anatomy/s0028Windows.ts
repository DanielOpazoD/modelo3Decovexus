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
  /** Peso de esa ventana en la puntuación (1 si no se indica): la hepatorrenal existe para ver el riñón a través del hígado. */
  throughWeight?: number;
  /** Balanceo y abanico máximos (rad); 0,6 si no se indica. La subcostal abanica más hacia la cabeza. */
  maxAngle?: number;
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
// Lo que un ecografista evita tener delante: hueso, cartílago, pulmón y gas digestivo (su sombra sucia tapa lo que hay detrás).
const BLOCK = new Set<Tissue>([Tissue.Bone, Tissue.Vertebra, Tissue.Lung, Tissue.Cartilage, Tissue.BowelGas, Tissue.ColonicContents]);
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
  return {
    ...q,
    score: 4 * q.seen + q.centred + 1.5 * q.clear + q.coupled + (t.through === undefined ? 0 : (t.throughWeight ?? 1) * q.through),
  };
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

/** Lo que debe mostrar cada ventana en esta persona: la porta de sus máscaras, su riñón y sus suprahepáticas (decisión 349). */
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
    hv = tube('hvRight'),
    // Confluencia: los últimos 40 mm de la derecha y de la media, que llegan a la cava por un lado y por otro.
    interlobar = scene.vesselById.get('interlobarVein2')!.tube.nodes.map((n) => n.p),
    // Cava en eje largo: su tramo intrahepático (z −125 a −30 mm), donde se mide en VExUS. Más arriba el pulmón de esta persona
    // queda pegado a su pared posterior y el tórax de s0028 aún no tiene aurícula: la vista hacia la cabeza no se parece a una real.
    cava = tube('ivcInfra').filter((p) => p[2] >= -125 && p[2] <= -30),
    rightEnd = hv.slice(-9),
    middleEnd = tube('hvMiddle').slice(-9);
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
      phi: [2.2, 3.6],
      z: [-130, 0],
      depthMm: 180,
      points: hv,
      pivot: mid(hv),
      long: sub(hv.at(-1)!, hv[0]),
      through: liver,
    },
    {
      id: 'subcostal',
      phi: [1.5, 2.5],
      z: [-140, -75],
      depthMm: 180,
      points: [...rightEnd, ...middleEnd],
      pivot: rightEnd.at(-1)!,
      long: sub(middleEnd[0], rightEnd[0]),
      through: liver,
      maxAngle: 1,
    },
    {
      id: 'subxiphoid',
      phi: [1.55, 2.0],
      z: [-130, -50],
      depthMm: 180,
      points: cava,
      pivot: mid(cava),
      long: sub(cava.at(-1)!, cava[0]),
      through: liver,
    },
    // Riñón a través del hígado. En esta persona el ángulo hepático del colon queda delante del riñón por la línea axilar anterior
    // (con contenido, que un ecografista evita): el apoyo se busca entre la axilar media y la posterior, por delante de la renal.
    {
      id: 'hepatorenal',
      phi: [2.9, 3.2],
      z: [-180, -80],
      depthMm: 140,
      points: kidney,
      pivot: KIDNEY.center,
      long: KIDNEY.u,
      through: liver,
      throughWeight: 4,
    },
    // Riñón en eje largo con la vena interlobar media en el plano: es la que se interroga en el Doppler renal de VExUS.
    {
      id: 'renal',
      phi: [3.0, 4.0],
      z: [-190, -90],
      depthMm: 140,
      points: [...interlobar, ...interlobar, ...[-30, -15, 15, 30].map((d) => interlobar[1].map((x, i) => x + d * KIDNEY.u[i]) as Vec3)],
      pivot: interlobar[1],
      long: KIDNEY.u,
    },
  ];
}
