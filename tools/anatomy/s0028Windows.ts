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
  /**
   * Órgano que debe verse detrás de `through` (la hepatorrenal: el riñón tras el hígado). Con él, el hito no son puntos de un eje
   * sino las líneas del sector que cruzan al menos `BEHIND_MM` de `through` y llegan al órgano sin barrera delante, y el plano es
   * libre: la búsqueda gira la sonda sobre su eje en vez de alinear el plano con `long`.
   */
  behind?: ReadonlySet<Tissue>;
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
/** Espesor mínimo del tejido ventana delante del órgano (mm) y fracción de líneas que basta para darlo por visto entero. */
const BEHIND_MM = 12;
const BEHIND_LINES = 0.4;

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
    samples = 0,
    behind = 0,
    behindCentred = 0;
  for (let i = 0; i < LINES; i++) {
    const theta = -TR.halfSector + (2 * TR.halfSector * (i + 0.5)) / LINES;
    if (contactCoupling(contact, theta) < 0.5) continue;
    coupled++;
    let r = 3,
      windowMm = 0,
      reached = false;
    for (; r < t.depthMm; r += 4) {
      const tissue = tissueAt(theta, r);
      if (BLOCK.has(tissue)) break;
      samples++;
      if (tissue === t.through) {
        through++;
        windowMm += 4;
      }
      if (t.behind?.has(tissue) && !reached) {
        reached = true;
        if (windowMm >= BEHIND_MM) {
          behind++;
          behindCentred += 1 - Math.abs(theta) / TR.halfSector;
        }
      }
    }
    clear += Math.min(1, r / t.depthMm);
  }
  const q = {
    seen: t.behind ? Math.min(1, behind / (BEHIND_LINES * LINES)) : seen / t.points.length,
    centred: t.behind ? (behind ? behindCentred / behind : 0) : centred / t.points.length,
    coupled: coupled / LINES,
    clear: clear / LINES,
    through: samples ? through / samples : 0,
  };
  return {
    ...q,
    score: 4 * q.seen + q.centred + 1.5 * q.clear + q.coupled + (t.through === undefined ? 0 : q.through),
  };
}

/** σ elevacional del haz (mm) hacia los 10 cm de profundidad: 1,6 mm en el foco de la lente, a 8 cm. */
const SLICE_SIGMA_MM = 1.8;
const PORTAL = /^(pv|portal)/;

/**
 * Luz portal que una pose deja ver negra (decisión 381). Un vaso cortado de refilón no se ve: el haz tiene espesor y promedia la
 * luz con el hígado de al lado. Aquí un punto del plano es luz negra si hay sangre portal en él y a ±σ en elevación. Devuelve la
 * longitud (mayor distancia entre dos puntos, mm) y el área de la mayor componente conexa dentro de `roi` (ángulo en rad y
 * profundidad en mm), y cuántas componentes hay.
 */
export function portalDarkLumen(
  anatomy: AnatomyQuery,
  sample: PhysiologySample,
  pose: ProbePose,
  roi: { theta: [number, number]; r: [number, number] },
  stepMm = 1.5,
): { lengthMm: number; areaMm2: number; pieces: number } {
  const contact = probeContact(pose, TR, anatomy.scene.torso);
  anatomy.setProbeCompression(contact);
  const f = contact.frame,
    middle = TR.curvatureRadius + (roi.r[0] + roi.r[1]) / 2,
    cols = Math.ceil(((roi.theta[1] - roi.theta[0]) * middle) / stepMm) + 1,
    rows = Math.ceil((roi.r[1] - roi.r[0]) / stepMm) + 1;
  const thetaOf = (i: number) => roi.theta[0] + ((roi.theta[1] - roi.theta[0]) * i) / (cols - 1);
  const blood = (p: Vec3) => {
    const c = anatomy.classifyWorld(p, sample);
    return c.tissue === Tissue.Blood && c.vessel !== null && PORTAL.test(String(c.vessel));
  };
  const dark = new Uint8Array(cols * rows);
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const p = pointOnLine(f, TR, thetaOf(i), roi.r[0] + j * stepMm);
      const beside = (sign: number) => p.map((v, a) => v + sign * SLICE_SIGMA_MM * f.elevation[a]) as Vec3;
      if (blood(p) && blood(beside(1)) && blood(beside(-1))) dark[i * rows + j] = 1;
    }
  const seen = new Uint8Array(cols * rows);
  let best = { lengthMm: 0, areaMm2: 0 },
    pieces = 0;
  for (let start = 0; start < dark.length; start++) {
    if (!dark[start] || seen[start]) continue;
    pieces++;
    const stack = [start],
      points: [number, number][] = [];
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!,
        i = Math.floor(k / rows),
        j = k % rows,
        rho = TR.curvatureRadius + roi.r[0] + j * stepMm;
      points.push([rho * Math.sin(thetaOf(i)), rho * Math.cos(thetaOf(i))]);
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          const a = i + di,
            b = j + dj;
          if (a < 0 || a >= cols || b < 0 || b >= rows) continue;
          const n = a * rows + b;
          if (dark[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
    }
    let lengthMm = 0;
    for (const a of points) for (const b of points) lengthMm = Math.max(lengthMm, Math.hypot(a[0] - b[0], a[1] - b[1]));
    if (lengthMm > best.lengthMm) best = { lengthMm, areaMm2: points.length * stepMm * stepMm };
  }
  return { ...best, pieces };
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
    // Riñón a través del hígado, con el plano libre. En esta persona el ángulo hepático del colon queda delante del riñón por la
    // línea axilar anterior (con contenido, que un ecografista evita) y las costillas bajas cruzan un plano coronal: la sonda se
    // apoya entre la axilar media y la posterior y gira a lo largo del espacio intercostal.
    {
      id: 'hepatorenal',
      phi: [2.9, 3.5],
      z: [-130, -60],
      depthMm: 140,
      points: kidney,
      pivot: KIDNEY.center,
      long: KIDNEY.u,
      through: liver,
      behind: new Set([Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.RenalPelvis]),
      maxAngle: 0.7,
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
