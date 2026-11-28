/**
 * Red interlobar de s0028 (decisión 402): pares arteria-vena juntos que salen del seno por las columnas de corteza de su TAC,
 * alrededor de todo el seno y hacia los polos, y se doblan en arcuata en la unión corticomedular. Las tres madres conservan sus
 * nodos (la vena de la puerta del alumno no se mueve); su arteria pasa a ir pegada a ella y las dos siguen hasta la arcuata.
 * [EXTRAPOLACIÓN PROPIA: la disposición; el TAC sin contraste no muestra los vasos intrarrenales.]
 *
 *   node --import tsx tools/anatomy/s0028-renal-network.ts
 *   npx prettier --write src/anatomy/s0028RenalNetworkData.ts
 */
import { writeFileSync } from 'node:fs';
import { Tissue } from '../../src/anatomy/tissues';
import type { Vec3 } from '../../src/core/vec3';
import { encodeS0028Nodes } from './s0028Base62';

const DATA = 'src/anatomy/s0028RenalNetworkData.ts';
const write = (rows: string) =>
  writeFileSync(
    DATA,
    `// Generado por tools/anatomy/s0028-renal-network.ts (decisión 402). No editar a mano.
import { s0028Nodes } from './people/s0028/base62';

const hundredths = (s: string) => s0028Nodes(s, 100);
/**
 * Red interlobar del riñón derecho de s0028: [madre (1–3), es la madre (1) o una rama (0), arteria, vena], cada vaso como nodos
 * [x, y, z, r] en mm del mundo en el sentido del flujo (la arteria del seno a la arcuata; la vena, al revés), en centésimas de mm.
 * La vena de una madre conserva sus nodos originales al final, tal cual. [EXTRAPOLACIÓN PROPIA: la disposición.]
 */
export const S0028_RENAL_NETWORK: readonly (readonly [number, number, readonly (readonly number[])[], readonly (readonly number[])[]])[] = [
${rows}
];
`,
  );
// La red se diseña sobre la escena sin ella: se vacía antes de cargar la persona.
write('');
const { loadS0028 } = await import('./s0028Windows');
const { scene, anatomy, sample } = loadS0028();
anatomy.setProbeCompression(null);
const K = scene.kidneyRight;
const world = (q: Vec3): Vec3 => [0, 1, 2].map((j) => K.center[j] + q[0] * K.u[j] + q[1] * K.v[j] + q[2] * K.w[j]) as Vec3;
const local = (p: Vec3): Vec3 => {
  const d = p.map((x, j) => x - K.center[j]);
  return [K.u, K.v, K.w].map((a) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2]) as Vec3;
};
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const PAR = new Set([Tissue.RenalCortex, Tissue.RenalMedulla]);
// el clasificador ya dibuja los vasos de la red anterior: dentro del riñón cuentan como parénquima
const IN_KIDNEY = new Set([...PAR, Tissue.RenalSinus, Tissue.RenalPelvis, Tissue.Blood, Tissue.VesselWallThin, Tissue.ArteryWall]);
const tissue = (q: Vec3) => anatomy.classifyWorld(world(q), sample).tissue;
const VESSEL = new Set([Tissue.Blood, Tissue.VesselWallThin, Tissue.ArteryWall]);
/** Parénquima o un vaso dentro de él (la red anterior ya está dibujada). */
const parLike = (t: Tissue) => PAR.has(t) || VESSEL.has(t);

/** Corteza de la unión corticomedular a la cápsula (mm): la arcuata va bajo ella. */
const CORTEX_MM = 6.5;
/** Pared que comparten la arteria y su vena (mm): la separación entre ejes es la suma de los radios más una pared. */
const SHARED_WALL_MM = 0.4;
/** Radios (mm) del seno a la arcuata: arteria y vena de una rama (la vena se recorre al revés). */
const ARTERY_R = [1.1, 0.95, 0.8, 0.6, 0.45];
const VEIN_R = [1.8, 1.4, 0.95, 0.65, 0.5];
/**
 * Las madres: su vena sigue su trayecto, con el calibre de una interlobar (1,5 mm de radio junto al seno; antes 2,1, 4,2 mm de
 * diámetro, que alejaba su arteria fuera de la rebanada del haz), y la arcuata. Su `refRadius` (área y velocidad) no cambia.
 */
const MOTHER_ARTERY_R = [1.1, 1.0, 0.85, 0.7, 0.55, 0.45];
const MOTHER_VEIN_R = [1.5, 1.3, 0.9, 0.7, 0.55, 0.45];

interface Ray {
  origin: Vec3;
  dir: Vec3;
}
/** Tramo del rayo en el parénquima: entrada (rp), cápsula (rc) y fracción de médula hasta la unión. */
function scan(ray: Ray) {
  let rp = -1,
    rc = -1,
    out = 0;
  for (let r = 0; r <= 45; r += 0.5) {
    const t = tissue(add(ray.origin, ray.dir, r));
    if (rp < 0) {
      if (PAR.has(t)) {
        let ok = 0;
        for (let s = 0.5; s <= 4; s += 0.5) if (parLike(tissue(add(ray.origin, ray.dir, r + s)))) ok++;
        if (ok >= 6) rp = r;
      }
      continue;
    }
    if (PAR.has(t)) {
      rc = r;
      out = 0;
    } else if (VESSEL.has(t)) {
      out = 0;
    } else if (!IN_KIDNEY.has(t) && ++out >= 6) break;
  }
  if (rp < 0 || rc < 0) return null;
  const rj = rc - CORTEX_MM;
  if (rj - rp < 4) return null;
  let med = 0,
    n = 0;
  for (let r = rp; r <= rj; r += 0.5, n++) if (tissue(add(ray.origin, ray.dir, r)) === Tissue.RenalMedulla) med++;
  return { rp, rc, rj, medulla: med / n };
}

const X: Vec3 = [1, 0, 0];
/**
 * Hacia dónde va la arteria respecto de su vena: alrededor del seno, con un octavo a lo largo del riñón. En la ventana renal
 * (que corta el riñón a lo largo y ve venir los vasos hacia la sonda) quedan en la misma rebanada del haz (σ elevacional 1,6 mm
 * frente a 0,75 lateral a 85 mm): la puerta recoge las dos, y el color las enseña una junto a otra. La arcuata, que corre a lo
 * largo del riñón, lleva su pareja solo alrededor.
 */
function pairAxis(dir: Vec3): { e: Vec3; around: Vec3; along: Vec3 } {
  const along = norm(add(X, dir, -dot(X, dir)));
  const around = norm(cross(dir, along));
  return { e: norm(add(around, along, 0.12)), around, along };
}

type Node4 = [number, number, number, number];
/**
 * Pareja a lo largo de `path` (del seno a la punta de la arcuata, en el marco del riñón), con la arteria a +offset·share y la
 * vena a −offset·(1 − share), separadas por la suma de sus radios más una pared: `share` 0,5 la centra en la columna y 1 deja la
 * vena sobre el camino (las madres). Los dos últimos nodos son la arcuata.
 */
function pair(path: Vec3[], dir: Vec3, share: number, arteryR: number[], veinR: number[]) {
  const { e, around } = pairAxis(dir);
  const off = path.map((_, i) => (i >= path.length - 2 ? around : e));
  const sep = path.map((_, i) => arteryR[i] + veinR[i] + SHARED_WALL_MM);
  const artery = path.map((p, i): Node4 => [...world(add(p, off[i], share * sep[i])), arteryR[i]] as Node4);
  const vein = path.map((p, i): Node4 => [...world(add(p, off[i], -(1 - share) * sep[i])), veinR[i]] as Node4).reverse();
  return { artery, vein };
}
/** Camino de una rama: entrada en el seno, mitad, unión corticomedular y la arcuata doblada a lo largo del riñón, algo hacia fuera. */
function branchPath(ray: Ray, s: { rp: number; rj: number }, side: 1 | -1): Vec3[] {
  const { along } = pairAxis(ray.dir);
  const at = (r: number) => add(ray.origin, ray.dir, r);
  const j = at(s.rj);
  return [
    at(s.rp - 1.5),
    at((s.rp + s.rj) / 2),
    j,
    add(add(j, along, 4.5 * side), ray.dir, 0.8),
    add(add(j, along, 8.5 * side), ray.dir, 1.2),
  ];
}

// Madres: su vena se queda; la arteria va pegada a ella y las dos siguen hasta la arcuata
const mothers = [1, 2, 3].map((k) => {
  const vein = scene.vessels.find((v) => v.id === `interlobarVein${k}` && v.flowFactor === undefined)!;
  const inner = local(vein.tube.nodes[vein.tube.nodes.length - 1].p),
    outer = local(vein.tube.nodes[0].p);
  const dir = norm(add(outer, inner, -1));
  // origen sobre el eje, en el plano perpendicular al rayo que pasa por su extremo interno
  const ray: Ray = { origin: add(inner, dir, -Math.hypot(inner[1], inner[2])), dir };
  const s = scan(ray)!;
  return { k, ray, s, vein };
});

const chosen: { k: number; ray: Ray; s: { rp: number; rc: number; rj: number; medulla: number }; side: 1 | -1 }[] = [];
const hilum = scene.vessels.filter((v) => (v.id === 'renalVeinRight' || v.id === 'renalArteryRight') && v.flowFactor === undefined);
const segDist = (p: Vec3, a: Vec3, b: Vec3) => {
  const ab = add(b, a, -1),
    t = Math.max(0, Math.min(1, dot(add(p, a, -1), ab) / dot(ab, ab)));
  return Math.hypot(...add(p, add(a, ab, t), -1));
};
/** Puntos del tramo en el parénquima (desde 2 mm de la entrada): en el seno los vasos van juntos, como los segmentarios. */
const pathPoints = (ray: Ray, s: { rp: number; rj: number }) => {
  const pts: Vec3[] = [];
  for (let r = s.rp + 2; r <= s.rj + 1; r += 1) pts.push(add(ray.origin, ray.dir, r));
  return pts;
};
const taken: Vec3[][] = mothers.map((m) => pathPoints(m.ray, m.s));
const clear = (pts: Vec3[]) => {
  for (const other of taken) for (const p of pts) for (const q of other) if (Math.hypot(...add(p, q, -1)) < 7) return false;
  for (const v of hilum)
    for (const p of pts) {
      const w = world(p);
      for (let i = 0; i < v.tube.nodes.length - 1; i++)
        if (segDist(w, v.tube.nodes[i].p, v.tube.nodes[i + 1].p) < v.tube.nodes[i].r + 3) return false;
    }
  return true;
};

// Candidatos: rayos desde el eje cada 6 mm a lo largo del riñón y cada 30° alrededor; hacia los polos, oblicuos desde el extremo
// del seno. Se eligen de uno en uno, el que más lejos queda de los ya puestos (reparto parejo por todo el riñón), con la
// médula como desempate: una red que se ve en cualquier plano que corte el riñón.
const deg = Math.PI / 180;
/** Pares nuevos (dos tubos cada uno): la escena queda por debajo de `SCENE_TUBE_CAPACITY` con margen. */
const MAX_PAIRS = 14;
const candidates: { k: number; ray: Ray; s: NonNullable<ReturnType<typeof scan>>; side: 1 | -1; pts: Vec3[] }[] = [];
for (let u = -24; u <= 24; u += 6)
  for (let th = 0; th < 360; th += 30) {
    const tilt = Math.abs(u) >= 18 ? Math.sign(u) * 40 : 0;
    const radial: Vec3 = [0, Math.cos(th * deg), Math.sin(th * deg)];
    const dir = norm(add([Math.sin(tilt * deg), 0, 0], radial, Math.cos(tilt * deg)));
    const ray: Ray = { origin: [Math.sign(u) * Math.min(Math.abs(u), 18), 0, 0], dir };
    const s = scan(ray);
    if (!s || s.medulla > 0.5) continue;
    const pts = pathPoints(ray, s);
    if (!clear(pts)) continue;
    candidates.push({ k: u < -10 ? 1 : u > 10 ? 3 : 2, ray, s, side: (th / 30) % 2 ? 1 : -1, pts });
  }
const gap = (pts: Vec3[]) => {
  let g = Infinity;
  for (const other of taken) for (const p of pts) for (const q of other) g = Math.min(g, Math.hypot(...add(p, q, -1)));
  return g;
};
while (chosen.length < MAX_PAIRS) {
  let best: (typeof candidates)[number] | null = null,
    bestScore = -Infinity;
  for (const c of candidates) {
    const g = gap(c.pts);
    if (g < 7) continue;
    const score = Math.min(g, 20) - 10 * c.s.medulla;
    if (score > bestScore) [best, bestScore] = [c, score];
  }
  if (!best) break;
  taken.push(best.pts);
  chosen.push(best);
}

const round = (n: Node4) => n.map((x) => +x.toFixed(2));
const hundredths = (nodes: Node4[]) => `hundredths('${encodeS0028Nodes(nodes.map(round), 100)}')`;
const out: string[] = [];
for (const m of mothers) {
  // la vena madre: sus nodos (del borde al seno) quedan al final; delante, la unión y la arcuata
  const orig = m.vein.tube.nodes.map((n) => local(n.p)).reverse(); // del seno hacia fuera
  const tail = branchPath(m.ray, m.s, 1).slice(2);
  const path = [...orig, ...tail];
  const { artery, vein } = pair(path, m.ray.dir, 1, MOTHER_ARTERY_R, MOTHER_VEIN_R);
  // el tramo original de la vena, exacto: mismos nodos
  m.vein.tube.nodes.forEach((n, i) => (vein[3 + i] = [...n.p, vein[3 + i][3]] as Node4));
  out.push(
    `  [${m.k}, 1, ${hundredths(artery)}, [...${hundredths(vein.slice(0, 3))}, ${vein
      .slice(3)
      .map((n) => JSON.stringify(n))
      .join(', ')}]],`,
  );
  console.log(`madre ${m.k}: parénquima ${m.s.rp.toFixed(1)}–${m.s.rc.toFixed(1)} mm, médula ${(100 * m.s.medulla).toFixed(0)} %`);
}
for (const c of chosen) {
  const { artery, vein } = pair(branchPath(c.ray, c.s, c.side), c.ray.dir, 0.5, ARTERY_R, VEIN_R);
  out.push(`  [${c.k}, 0, ${hundredths(artery)}, ${hundredths(vein)}],`);
  console.log(
    `par ${c.k} dir ${c.ray.dir.map((x) => x.toFixed(2)).join(',')} parénquima ${c.s.rp.toFixed(1)}–${c.s.rc.toFixed(1)} mm, médula ${(100 * c.s.medulla).toFixed(0)} %`,
  );
}
console.log(`${mothers.length} madres y ${chosen.length} pares nuevos`);

write(out.join('\n'));
