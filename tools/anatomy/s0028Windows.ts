/**
 * Ventanas de inicio de s0028: los hitos de esta persona que cada ventana debe mostrar y la puntuación de una pose con lo que
 * vería un ecografista: el hito dentro del sector y sin hueso, pulmón ni cartílago delante; sector acoplado y limpio. La usan la
 * búsqueda (`find-s0028-poses.ts`) y la prueba (`s0028Windows.test.ts`): la misma medida decide la pose y la vigila.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { uncompress } from '../../src/anatomy/compression';
import { HEART_ATLAS_SHIFT } from '../../src/anatomy/organs/heart';
import { heartChamber } from '../../src/anatomy/organs/heartChamber';
import { S0028_HEART } from '../../src/anatomy/people/s0028/cpu';
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

/** Centro de la aurícula derecha de s0028 en el marco del modelo, leído en su TAC (decisión 356): (−24, 27, 32) mm. */
export const S0028_RA_CENTER = S0028_HEART.cavities.ra.c.map((x, i) => x + HEART_ATLAS_SHIFT[i]) as Vec3;

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
 * Luz portal (o de los vasos de `vessels`) que una pose deja ver negra (decisión 381). Un vaso cortado de refilón no se ve: el haz tiene espesor y promedia la
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
  vessels: RegExp = PORTAL,
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
    return c.tissue === Tissue.Blood && c.vessel !== null && vessels.test(String(c.vessel));
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

const KIDNEY_TISSUES = new Set<Tissue>([Tissue.RenalCortex, Tissue.RenalMedulla, Tissue.RenalSinus, Tissue.RenalPelvis]);
const SHADOWING = new Set<Tissue>([Tissue.Bone, Tissue.Vertebra, Tissue.Cartilage, Tissue.Lung, Tissue.BowelGas]);

/**
 * Lo que una pose deja ver del riñón (decisión 383): el largo de su sección en el plano (mayor distancia entre dos puntos de
 * riñón, mm), la fracción de líneas con hueso, pulmón o gas en los primeros 110 mm y la fracción del sector que ocupa la luz
 * del duodeno, del intestino delgado o de la vía biliar (se leían como un tubo sin sentido junto al riñón).
 */
export function renalSection(
  anatomy: AnatomyQuery,
  sample: PhysiologySample,
  pose: ProbePose,
  depthMm: number,
): { lengthMm: number; boneNear: number; bowelLumen: number } {
  const contact = probeContact(pose, TR, anatomy.scene.torso);
  anatomy.setProbeCompression(contact);
  const lines = 41,
    step = 3,
    points: [number, number][] = [];
  let bone = 0,
    lumen = 0,
    samples = 0;
  for (let i = 0; i < lines; i++) {
    const theta = -TR.halfSector + (2 * TR.halfSector * (i + 0.5)) / lines;
    let shadowed = false;
    for (let r = step; r < depthMm; r += step) {
      samples++;
      if (shadowed) continue;
      const tissue = anatomy.classifyWorld(pointOnLine(contact.frame, TR, theta, r), sample).tissue;
      if (SHADOWING.has(tissue)) {
        shadowed = true;
        if (r < 110) bone++;
      } else if (tissue === Tissue.Fluid || tissue === Tissue.GastricContents) lumen++;
      else if (KIDNEY_TISSUES.has(tissue)) {
        const rho = TR.curvatureRadius + r;
        points.push([rho * Math.sin(theta), rho * Math.cos(theta)]);
      }
    }
  }
  let lengthMm = 0;
  for (const a of points) for (const b of points) lengthMm = Math.max(lengthMm, Math.hypot(a[0] - b[0], a[1] - b[1]));
  return { lengthMm, boneNear: bone / lines, bowelLumen: lumen / samples };
}

/**
 * Fracción de la luz de los vasos dados, en el plano y dentro de `roi`, que tiene hueso, cartílago o pulmón por encima en su
 * misma línea de haz, o cae en una línea sin acoplar (decisión 388): la sombra costal que la tapa.
 */
export function shadowedLumen(
  anatomy: AnatomyQuery,
  sample: PhysiologySample,
  pose: ProbePose,
  roi: { theta: [number, number]; r: [number, number] },
  vessels: RegExp,
  stepMm = 1.5,
): { lumenMm2: number; shadowed: number } {
  const contact = probeContact(pose, TR, anatomy.scene.torso);
  anatomy.setProbeCompression(contact);
  const cols = Math.ceil(((roi.theta[1] - roi.theta[0]) * (TR.curvatureRadius + roi.r[1] / 2)) / stepMm);
  let lumen = 0,
    shadowed = 0;
  for (let i = 0; i <= cols; i++) {
    const theta = roi.theta[0] + ((roi.theta[1] - roi.theta[0]) * i) / cols;
    if (Math.abs(theta) > TR.halfSector) continue;
    let blocked = contactCoupling(contact, theta) < 0.5;
    for (let r = stepMm; r < roi.r[1]; r += stepMm) {
      const c = anatomy.classifyWorld(pointOnLine(contact.frame, TR, theta, r), sample);
      if (c.tissue !== Tissue.BowelGas && SHADOWING.has(c.tissue)) blocked = true;
      if (r >= roi.r[0] && c.tissue === Tissue.Blood && vessels.test(String(c.vessel))) {
        lumen++;
        if (blocked) shadowed++;
      }
    }
  }
  return { lumenMm2: lumen * stepMm * stepMm, shadowed: lumen ? shadowed / lumen : 1 };
}

/** Fracción del sector (41 líneas, de `r[0]` a `r[1]` mm cada 2 mm) que ocupan los tejidos dados. */
export function sectorFraction(
  anatomy: AnatomyQuery,
  sample: PhysiologySample,
  pose: ProbePose,
  tissues: ReadonlySet<Tissue>,
  r: [number, number],
): number {
  const contact = probeContact(pose, TR, anatomy.scene.torso);
  anatomy.setProbeCompression(contact);
  let hits = 0,
    samples = 0;
  for (let i = 0; i < 41; i++) {
    const theta = -TR.halfSector + (2 * TR.halfSector * (i + 0.5)) / 41;
    for (let depth = r[0]; depth < r[1]; depth += 2) {
      samples++;
      if (tissues.has(anatomy.classifyWorld(pointOnLine(contact.frame, TR, theta, depth), sample).tissue)) hits++;
    }
  }
  return hits / samples;
}

/**
 * Aurícula derecha de s0028 en una pose (decisión 391), con el contrato de la otra persona (`support/ivcAtriumWindow.ts`): 97
 * rayos cada 0,5 mm; un rayo es claro si está acoplado, a más de 5° del borde, cruza el diafragma o la pared del corazón antes
 * de la aurícula, recorre en ella al menos 8 mm sin nada delante que tape (hueso, cartílago, pulmón ni gas) y se aceptan cinco
 * rayos claros vecinos y 20 mm de anchura. Sin el «a través del hígado» de la otra persona: el lóbulo izquierdo de s0028 no llega
 * delante de su aurícula (grasa de 30–40 mm entre la pared y el diafragma), rasgo de esta persona.
 */
export function s0028AtriumWindow(anatomy: AnatomyQuery, sample: PhysiologySample, pose: ProbePose) {
  const contact = probeContact(pose, TR, anatomy.scene.torso);
  anatomy.setProbeCompression(contact);
  const cpu = anatomy.scene.person.cpu;
  const rays: { theta: number; clear: boolean; lateral: number[] }[] = [];
  for (let line = 0; line < 97; line++) {
    const theta = -TR.halfSector + (2 * TR.halfSector * line) / 96;
    let barrier = false,
      blocked = false,
      atriumMm = 0;
    const lateral: number[] = [];
    for (let r = 0; r <= 170 && !blocked; r += 0.5) {
      const world = pointOnLine(contact.frame, TR, theta, r);
      const tissue = anatomy.classifyWorld(world, sample).tissue;
      if (atriumMm === 0 && (tissue === Tissue.Diaphragm || tissue === Tissue.Myocardium)) barrier = true;
      const m = uncompress(world, contact);
      if (tissue === Tissue.Blood && cpu.regional!.s0028SourceValue(m, 'heart').d < 0 && heartChamber(m, -1e3, cpu) === 'ra') {
        atriumMm += 0.5;
        lateral.push(dot(sub(world, contact.frame.face), contact.frame.lateral));
      } else if (atriumMm === 0 && BLOCK.has(tissue)) blocked = true;
      else if (atriumMm > 0) break;
    }
    rays.push({
      theta,
      lateral,
      clear:
        contactCoupling(contact, theta) > 0.5 &&
        Math.abs(theta) < TR.halfSector - (5 * Math.PI) / 180 &&
        barrier &&
        !blocked &&
        atriumMm >= 8,
    });
  }
  let run = 0,
    longestRun = 0;
  const lateral: number[] = [];
  for (const ray of rays) {
    run = ray.clear ? run + 1 : 0;
    longestRun = Math.max(longestRun, run);
    if (ray.clear) lateral.push(...ray.lateral);
  }
  const widthMm = lateral.length ? Math.max(...lateral) - Math.min(...lateral) : 0;
  return { longestRun, widthMm, accepted: longestRun >= 5 && widthMm >= 20 };
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
    hv = tube('hvRight'),
    // Confluencia: los últimos 40 mm de la derecha y de la media, que llegan a la cava por un lado y por otro.
    // El tramo interlobar de la vena media: sus tres últimos nodos (desde la decisión 402 la madre empieza en su arcuata).
    interlobar = scene.vesselById
      .get('interlobarVein2')!
      .tube.nodes.slice(-3)
      .map((n) => n.p),
    // Cava en eje largo hasta su entrada en la aurícula derecha (decisión 391): VExUS la mide a 1–2 cm de esa entrada, junto a la
    // suprahepática. Hasta entonces el hito acababa en z −30 mm, cuando el tórax de s0028 aún no tenía aurícula (la tiene desde la
    // decisión 356), y la entrada quedaba en el borde del sector con la aurícula fuera.
    cava = tube('ivcInfra').filter((p) => p[2] >= -90),
    atrium = S0028_RA_CENTER,
    cavaAtJunction = tube('ivcInfra').reduce((best, p) => (Math.abs(p[2] - hv.at(-1)![2]) < Math.abs(best[2] - hv.at(-1)![2]) ? p : best)),
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
      // Decisión 386: la porta principal y su rama derecha en eje largo, donde VExUS la mide; antes, la bifurcación con la izquierda.
      id: 'portalSubcostal',
      phi: [1.5, 2.7],
      z: [-130, -50],
      depthMm: 150,
      points: [...trunk.slice(-6), ...right],
      pivot: trunk.at(-1)!,
      long: sub(right.at(-1)!, trunk.at(-6)!),
      through: liver,
    },
    {
      // Valoración del responsable (decisión 383): lo que debe verse claro es la unión de la vena con la cava. El hito es el tramo
      // final de la suprahepática derecha (unos 70 mm) y el centro de la cava a la altura de la unión, no la vena entera.
      id: 'intercostal',
      phi: [2.2, 3.6],
      z: [-130, 0],
      depthMm: 180,
      points: [...hv.slice(-15), cavaAtJunction],
      pivot: hv.at(-6)!,
      long: sub(hv.at(-1)!, hv.at(-15)!),
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
      // Bajo el xifoides (su punta, a z −32 mm) y junto a la línea media: con más margen la búsqueda acaba en una subcostal
      // derecha (φ 2, 5 cm a la derecha y 7 cm por debajo del xifoides), que ya no es esta ventana.
      phi: [1.55, 1.8],
      z: [-90, -40],
      depthMm: 180,
      // La cava y el camino de su extremo al centro de la aurícula: la entrada debe verse, no solo el tubo.
      points: [...cava, ...[0.25, 0.5, 0.75, 1].map((s) => cava.at(-1)!.map((x, i) => x + s * (atrium[i] - x)) as Vec3)],
      pivot: cavaAtJunction,
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
