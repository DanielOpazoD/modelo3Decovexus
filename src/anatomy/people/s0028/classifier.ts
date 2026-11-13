/** @twin clasificacion */
import { type Vec3 } from '../../../core/vec3';
import { EMPTY_ATLAS } from '../../emptyAtlas';
import { Interface } from '../../interfaces';
import { abdomenQuery } from '../../organs/abdomen';
import { gallbladderSdf } from '../../organs/gallbladder';
import { heartFloor, ivcAtrium, thorax } from '../../organs/heart';
import type { S0028Ownership } from '../../people/s0028/solids';
import {
  S0028_HEART_WALL_MM,
  S0028_LIVER_GAP_KIDNEY_MM,
  S0028_LIVER_GAP_MM,
  S0028_LIVER_SEAM_MM,
  S0028_PREPERITONEAL_MM,
  S0028_RENAL_FACE_MM,
  S0028_DIAPHRAGM_DEEP_MM,
  S0028_SUBCUTANEOUS_REACH_MM,
} from '../../people/s0028/solidsData';
import type { AnatomyScene, Classification, VesselCaliber } from '../../scene';
import { NONE } from '../../scene';
import { DIAPHRAGM_THICKNESS_MM, Tissue } from '../../tissues';
export function classifyWall(
  scene: AnatomyScene,
  m: Vec3,
  d: number,
): { final: true; cls: Classification } | { final: false; wallMm: number; solids?: S0028Ownership } {
  if (d < 1.5)
    return {
      final: true,
      cls: {
        ...NONE,
        tissue: Tissue.Skin,
        boundaryDistance: Math.min(d, 1.5 - d),
        interface: Interface.SkinFat,
        interfaceDistance: 1.5 - d,
        wall: 'skin-E',
      },
    };
  const regional = scene.person.cpu.regional!,
    q = regional.s0028WallAt(m);
  let solids = regional.s0028Owners(m, q);
  // La grasa del abdomen a 3 mm no pisa el diafragma: junto a la base del pulmón, un vóxel «graso» es volumen parcial de aire y
  // músculo. Ahí el punto queda sin dueño y lo dibuja el diafragma.
  if (solids.owners[0]?.id === 'compatible_fat' && regional.s0028CompatibleFat(m) === null && s0028Diaphragm(regional, m, d) !== null)
    solids = { state: 'U', owners: [], kidneyMm: solids.kidneyMm };
  const owner = solids.owners[0]?.id;
  // P3: dos o más dueños independientes son conflicto: se conservan todos y no se elige material (U).
  if (solids.state === 'conflict')
    return { final: true, cls: { ...NONE, tissue: Tissue.UnsegmentedSoftTissue, boundaryDistance: 0, solids } };
  for (const name of owner === 'bone' || owner === 'cartilage' ? ['thoracicBone', 'lumbarSacralBone', 'sacrum', 'cartilage'] : []) {
    const source = scene.person.cpu.regional!.s0028SourceValue(m, name);
    if (source.d < 0)
      return {
        final: true,
        cls: {
          solids,
          ...NONE,
          tissue:
            name === 'cartilage'
              ? Tissue.Cartilage
              : (name === 'lumbarSacralBone' && source.label <= 5) ||
                  (name === 'thoracicBone' && (scene.person?.cpu.atlas ?? EMPTY_ATLAS).thoracicMaterial(source.label) === 'vertebra')
                ? Tissue.Vertebra
                : Tissue.Bone,
          boundaryDistance: -source.d,
          ...(name === 'cartilage' ? { interface: Interface.Perichondrium, interfaceDistance: -source.d } : {}),
        },
      };
  }
  if (q?.kind !== 'known' || q.depthMm >= q.interfaceMm)
    return { final: false, wallMm: d - (q?.kind === 'known' ? q.depthMm - q.interfaceMm : 1e3), solids };
  // Capas de la pared de esta persona (decisión 352): la grasa y la banda vienen de su TAC; la fascia superficial es estimada. La
  // vaina anterior se ve desde la grasa y desde el músculo: una cara que solo se dibujaba por un lado quedaba a medio trazo.
  const fat = q.depthMm < q.outerMm;
  let face = Interface.SkinFat,
    faceMm = q.depthMm - 1.5;
  if (fat) {
    const scarpa = Math.abs(q.depthMm - q.superficialFasciaMm),
      fascia = q.outerMm - q.depthMm;
    if (scarpa < faceMm) [face, faceMm] = [Interface.Scarpa, scarpa];
    if (fascia < faceMm) [face, faceMm] = [Interface.DeepFascia, fascia];
  } else {
    const anterior = q.depthMm - q.outerMm,
      posterior = q.innerMm - q.depthMm;
    [face, faceMm] = anterior < posterior ? [Interface.DeepFascia, Math.abs(anterior)] : [Interface.Peritoneum, Math.abs(posterior)];
  }
  // Pegada al hígado, la línea del peritoneo va en la superficie hepática, sobre su cápsula: una sola línea, no dos (decisión 361).
  if (face === Interface.Peritoneum) {
    const liverMm = regional.s0028SourceValue(m, 'liver').d;
    if (liverMm < S0028_LIVER_SEAM_MM) faceMm = Math.max(liverMm, 0);
  }
  return {
    final: true,
    cls: {
      ...NONE,
      tissue: fat ? Tissue.Fat : Tissue.Muscle,
      boundaryDistance: Math.max(
        0,
        fat ? Math.min(q.depthMm - 1.5, q.outerMm - q.depthMm) : Math.min(q.depthMm - q.outerMm, q.innerMm - q.depthMm),
      ),
      interface: face,
      interfaceDistance: faceMm,
      wall: fat ? 'fat-D/E' : 'band-D/E',
      solids,
    },
  };
}
/**
 * Diafragma de s0028 (decisión 348): la lámina de `DIAPHRAGM_THICKNESS_MM` pegada por debajo a la base de su propio pulmón, donde
 * ninguna máscara reclama el punto. Devuelve los mm bajo el pulmón, o null. «Por debajo»: 3 mm más arriba el pulmón queda al
 * menos 1 mm más cerca. Sustituye a la cúpula analítica de la otra persona, que no coincidía con este pulmón. También por delante
 * del pulmón (3 mm más atrás queda más cerca), lejos de la piel: es el diafragma entre el hígado o la cava y el receso posterior
 * (decisión 375); junto a la pared torácica anterior no hay lámina.
 * @twin s0028-diafragma
 */
export function s0028Diaphragm(
  regional: { s0028SourceValue: (p: Vec3, name: string) => { d: number } },
  m: Vec3,
  belowSkinMm: number,
): number | null {
  const d = regional.s0028SourceValue(m, 'lung').d;
  if (!(d >= 0 && d < DIAPHRAGM_THICKNESS_MM)) return null;
  if (regional.s0028SourceValue([m[0], m[1], m[2] + 3], 'lung').d < d - 1) return d;
  return belowSkinMm > S0028_DIAPHRAGM_DEEP_MM && regional.s0028SourceValue([m[0], m[1] - 3, m[2]], 'lung').d < d - 1 ? d : null;
}
/** @twin clasificacion */
export function classifyInside(
  scene: AnatomyScene,
  m: Vec3,
  caliber: VesselCaliber,
  withCurtain: boolean,
  depth: number,
  wallMm: number,
  spineDistance: number,
  solids?: S0028Ownership,
): Classification {
  // r5: el interior renal sale del rótulo offline del propio TAC (corteza y médula E, seno graso y colector D); lo demás U.
  const owner = solids?.owners[0]?.id;
  const renal = owner?.startsWith('kidney');
  const interior = scene.person.cpu.regional!.s0028RenalInterior(m);
  {
    const lung = scene.person.cpu.regional!.s0028SourceValue(m, 'lung');
    if (lung.d < 0) return { ...NONE, tissue: Tissue.Lung, boundaryDistance: -lung.d };
  }
  const curtain = null;
  if (curtain) return curtain;
  const tube = scene.classifyTubes(m, caliber);
  if (tube && tube.interface !== Interface.IvcLumen) return tube;
  // Corazón (decisión 356): dentro de la máscara de esta persona no hay cúpula que recorte (suelo a −1000): la cava entra en su
  // aurícula con la regla de la decisión 85, y fuera de ella gana el corazón.
  const heart = scene.person.cpu.regional!.s0028SourceValue(m, 'heart');
  const [dDome, slope] = [1e3, 1];
  const floor = heartFloor(dDome, slope);
  // la VCI que entra en la aurícula derecha (decisión 85): dentro de ella no hay pared que dibujar (antes daba un eco de
  // pared brillante y seguía como un anillo dentro de la cavidad): su pared es sangre de la aurícula y su luz conserva el
  // flujo sin cara; fuera de la aurícula, por encima de su suelo, no hay VCI (gana el corazón)
  // Dentro de la máscara del corazón la cava es sangre hasta donde llega su eje, que acaba en la aurícula: sin pared ni cara.
  const ivc =
    tube?.interface !== Interface.IvcLumen
      ? null
      : heart.d < 0
        ? { cavity: -1e3, outside: false, cut: 1e3 }
        : ivcAtrium(m, floor, scene.person?.cpu);
  if (tube && ivc && ivc.cavity < 0) {
    if (tube.tissue === Tissue.Blood)
      return {
        ...tube,
        boundaryDistance: Math.min(tube.boundaryDistance, -ivc.cavity),
        interface: Interface.None,
        interfaceDistance: NONE.interfaceDistance,
      };
    return { ...NONE, tissue: Tissue.Blood, boundaryDistance: -ivc.cavity };
  }
  if (tube && !ivc?.outside) return ivc ? { ...tube, boundaryDistance: Math.min(tube.boundaryDistance, ivc.cut) } : tube;
  if (heart.d < 0) {
    // Sus cavidades (el esquema encajado a su TAC, `S0028_HEART`) son sangre y el resto de la máscara, miocardio. Con el recorte
    // por la cúpula de la otra persona, más alta, casi toda la máscara quedaba como «mediastino», con textura de hígado.
    const t = thorax(m, -1e3, -1e3, scene.person?.cpu);
    // Toda cavidad lleva su pared libre: a menos de `S0028_HEART_WALL_MM` del contorno es miocardio (decisión 369).
    return t.tissue === Tissue.Blood && -heart.d > S0028_HEART_WALL_MM
      ? { ...NONE, tissue: Tissue.Blood, boundaryDistance: Math.min(t.bd, -heart.d - S0028_HEART_WALL_MM) }
      : { ...NONE, tissue: Tissue.Myocardium, boundaryDistance: -heart.d };
  }
  if (dDome < 0) {
    // tórax (decisión 85): el corazón en su saco, el mediastino o el pulmón; la capa del pericardio dibuja su cara
    const t = thorax(m, dDome, floor, scene.person?.cpu);
    const face = t.ifd < NONE.interfaceDistance ? { interface: Interface.Pericardium, interfaceDistance: t.ifd } : {};
    // su distancia a la frontera cuenta también la columna y la pared (como el retroperitoneo)
    const bd = Math.min(t.bd, spineDistance, -depth - wallMm);
    return { ...NONE, tissue: t.tissue, boundaryDistance: bd, ...face };
  }
  if (dDome < DIAPHRAGM_THICKNESS_MM) {
    // la mitad abdominal dibuja la cara hepática; la pleural la dibuja el espejo exacto de la pasada A
    return scene.classifyDiaphragm(dDome);
  }
  const dGb = gallbladderSdf(m, scene.gallbladder);
  if (dGb < 0)
    return { ...NONE, tissue: Tissue.Fluid, boundaryDistance: -dGb, interface: Interface.GallbladderLumen, interfaceDistance: -dGb };
  if (dGb < scene.gallbladderWallMm)
    return {
      ...NONE,
      tissue: Tissue.BileDuctWall,
      boundaryDistance: Math.min(dGb, scene.gallbladderWallMm - dGb),
      interface: Interface.GallbladderLumen,
      interfaceDistance: dGb,
    };
  // El quiste izquierdo, líquido de un quiste simple (E rotulada en su dueño).
  if (renal)
    return renalFace(
      {
        ...NONE,
        tissue: owner === 'kidney_cyst_left' ? Tissue.Fluid : (RENAL_TISSUE[interior] ?? Tissue.UnsegmentedSoftTissue),
        boundaryDistance: -solids!.owners[0].d,
      },
      solids!,
    );
  const kidney = NO_KIDNEY;
  if (kidney.cls) return kidney.cls;
  if (scene.hasAbdominalAtlas) {
    const abdomen = abdomenQuery(m, scene.person?.cpu);
    if (abdomen) return { ...NONE, ...abdomen };
  }
  const liver = scene.classifyLiver(m, dDome, 1e3, kidney, dGb - scene.gallbladderWallMm);
  if (liver) return liver;
  {
    const muscle = scene.person.cpu.regional!.s0028SourceValue(m, 'posteriorMuscle');
    if (muscle.d < 0 && muscle.label > 0)
      return { ...NONE, tissue: muscle.label <= 2 ? Tissue.Psoas : Tissue.Muscle, boundaryDistance: -muscle.d };
    // Grasa compatible D por vóxel (HU, sin máscara): composición, no compartimento. El TAC dice que es grasa; cómo se ve depende
    // de dónde está (decisión 351): la de dentro de la cavidad (perirrenal, retroperitoneal, mesentérica) es ecogénica; con el
    // material hipoecoico del panículo el riñón parecía rodeado de líquido. Dentro de la pared conocida ya decidió `classifyWall`.
    if (owner === 'compatible_fat') {
      // «Dentro»: la carta da geometría de pared en este punto (la misma consulta que la GPU), o está muy por debajo de la piel.
      const inside = scene.person.cpu.regional!.s0028InsideWall(m);
      const visceral = inside !== null || -depth > S0028_SUBCUTANEOUS_REACH_MM;
      // Junto al riñón (cajas de grasa a 1,5 mm, hasta 30 mm de él) es grasa perirrenal, la más brillante: el riñón resalta.
      const perirenal = scene.person.cpu.regional!.s0028CompatibleFat(m) !== null;
      // Pegada por dentro a la pared es la grasa preperitoneal: hipoecoica como el panículo, no un parche brillante sobre el hígado.
      const preperitoneal = inside !== null && inside < S0028_PREPERITONEAL_MM;
      const fat = !visceral ? Tissue.Fat : perirenal ? Tissue.PerirenalFat : preperitoneal ? Tissue.Fat : Tissue.MesentericFat;
      return renalFace({ ...NONE, tissue: SINUS_TISSUE[interior] ?? fat, boundaryDistance: 0 }, solids!);
    }
    // Diafragma de esta persona (decisión 348): la máscara de cada órgano ya ganó antes; no corta el hígado.
    const dome = s0028Diaphragm(scene.person.cpu.regional!, m, -depth);
    if (dome !== null) return renalFace(scene.classifyDiaphragm(dome, scene.person.cpu.regional!.s0028InsideWall(m) ?? Infinity), solids!);
    // La cáscara sin máscara entre la cara interna de la pared y el hígado es músculo de la pared, y su peritoneo, la superficie
    // hepática (decisión 361).
    const inside = scene.person.cpu.regional!.s0028InsideWall(m),
      liverMm = scene.person.cpu.regional!.s0028SourceValue(m, 'liver').d;
    if (
      !SINUS_TISSUE[interior] &&
      inside !== null &&
      inside >= 0 &&
      inside < S0028_LIVER_GAP_MM &&
      liverMm < S0028_LIVER_GAP_MM &&
      solids!.kidneyMm > S0028_LIVER_GAP_KIDNEY_MM
    )
      return {
        ...NONE,
        tissue: Tissue.Muscle,
        boundaryDistance: liverMm,
        interface: Interface.Peritoneum,
        interfaceDistance: liverMm,
        approximation: 'wall-liver-shell',
      };
    // Dentro de la cavidad, lo que el TAC no rotula es grasa y tejido conectivo: se dibuja como la grasa visceral de al lado, no como
    // un gris aparte que dejaba ver en mosaico la rejilla de 3 mm de esa grasa (decisión 364). En la pared y a menos de 10 mm del
    // riñón sigue siendo U: su envolvente no recibe grasa inventada.
    if (
      !SINUS_TISSUE[interior] &&
      solids!.kidneyMm > S0028_LIVER_GAP_KIDNEY_MM &&
      (inside !== null || -depth > S0028_SUBCUTANEOUS_REACH_MM)
    )
      // Pegada por dentro a la pared es preperitoneal, hipoecoica como la grasa D de esa franja (decisión 366).
      return renalFace(
        {
          ...NONE,
          tissue: inside !== null && inside < S0028_PREPERITONEAL_MM ? Tissue.Fat : Tissue.MesentericFat,
          boundaryDistance: 0,
          approximation: 'grasa-estimada',
        },
        solids!,
      );
    // En la pared, donde la carta no conoce la celda, lo no rotulado se dibuja como su grasa (decisión 371): con el gris de «sin
    // rotular» la pared lateral salía a parches. Junto al riñón sigue siendo U.
    if (!SINUS_TISSUE[interior] && solids!.kidneyMm > S0028_LIVER_GAP_KIDNEY_MM)
      return renalFace({ ...NONE, tissue: Tissue.Fat, boundaryDistance: 0, wall: 'U', approximation: 'grasa-estimada' }, solids!);
    return renalFace({ ...NONE, tissue: SINUS_TISSUE[interior] ?? Tissue.UnsegmentedSoftTissue, boundaryDistance: 0, wall: 'U' }, solids!);
  }
}
function renalFace(c: Classification, solids: S0028Ownership): Classification {
  const d = Math.abs(solids.kidneyMm);
  return d < S0028_RENAL_FACE_MM && d < c.interfaceDistance ? { ...c, interface: Interface.RenalCapsule, interfaceDistance: d } : c;
}

/** Corteza y médula sólo dentro de la máscara renal; seno graso y colector sólo en el hueco del hilio, fuera de ella. */
const RENAL_TISSUE: Readonly<Record<number, Tissue>> = { 1: Tissue.RenalCortex, 2: Tissue.RenalMedulla };
const SINUS_TISSUE: Readonly<Record<number, Tissue>> = { 3: Tissue.RenalSinus, 4: Tissue.RenalPelvis, 5: Tissue.RenalSinus };

/** s0028 P3: sin arquitectura ni grasa perirrenal analíticas (Morison sin grasa inventada). */
const NO_KIDNEY = { cls: null, dPeriMm: 1e3, periThin: false } as const;
