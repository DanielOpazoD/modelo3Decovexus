/** @twin clasificacion */
import { type Vec3 } from '../../../core/vec3';
import { EMPTY_ATLAS } from '../../emptyAtlas';
import { Interface } from '../../interfaces';
import { abdomenQuery } from '../../organs/abdomen';
import { gallbladderSdf } from '../../organs/gallbladder';
import { heartFloor, ivcAtrium, thorax } from '../../organs/heart';
import type { S0028Ownership } from '../../people/s0028/solids';
import { S0028_RENAL_FACE_MM } from '../../people/s0028/solidsData';
import { sdDiaphragmSlope } from '../../primitives';
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
  if (solids.owners[0]?.id === 'compatible_fat' && regional.s0028CompatibleFat(m) === null && s0028Diaphragm(regional, m) !== null)
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
  const fat = q.depthMm < q.outerMm;
  const outer = fat ? 1.5 : q.outerMm,
    inner = fat ? q.outerMm : q.innerMm;
  // Banda blanda D/E, no músculo segmentado. No se inventan Scarpa, oblicuos ni grasa preperitoneal.
  return {
    final: true,
    cls: {
      ...NONE,
      tissue: fat ? Tissue.Fat : Tissue.UnsegmentedSoftTissue,
      boundaryDistance: Math.max(0, Math.min(q.depthMm - outer, inner - q.depthMm)),
      interface: fat ? Interface.DeepFascia : Interface.Peritoneum,
      interfaceDistance: Math.abs(inner - q.depthMm),
      wall: fat ? 'fat-D/E' : 'band-D/E',
      solids,
    },
  };
}
/**
 * Diafragma de s0028 (decisión 348): la lámina de `DIAPHRAGM_THICKNESS_MM` pegada por debajo a la base de su propio pulmón, donde
 * ninguna máscara reclama el punto. Devuelve los mm bajo el pulmón, o null. «Por debajo»: 3 mm más arriba el pulmón queda al
 * menos 1 mm más cerca. Sustituye a la cúpula analítica de la otra persona, que no coincidía con este pulmón.
 * @twin s0028-diafragma
 */
export function s0028Diaphragm(regional: { s0028SourceValue: (p: Vec3, name: string) => { d: number } }, m: Vec3): number | null {
  const d = regional.s0028SourceValue(m, 'lung').d;
  if (!(d >= 0 && d < DIAPHRAGM_THICKNESS_MM)) return null;
  return regional.s0028SourceValue([m[0], m[1], m[2] + 3], 'lung').d < d - 1 ? d : null;
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
    // P7 conserva los interiores cardíacos E vigentes, limitados por la máscara de esta persona.
    if (scene.person.cpu.regional!.s0028SourceValue(m, 'heart').d < 0) {
      const [dome, slope] = sdDiaphragmSlope(m, scene.diaphragm, scene.torso);
      const t = thorax(m, dome, heartFloor(dome, slope), scene.person?.cpu);
      return { ...NONE, tissue: t.tissue, boundaryDistance: t.bd };
    }
  }
  const curtain = null;
  if (curtain) return curtain;
  const tube = renal ? null : scene.classifyTubes(m, caliber);
  if (tube && tube.interface !== Interface.IvcLumen) return tube;
  const [dDome, slope] = [1e3, 1];
  const floor = heartFloor(dDome, slope);
  // la VCI que entra en la aurícula derecha (decisión 85): dentro de ella no hay pared que dibujar (antes daba un eco de
  // pared brillante y seguía como un anillo dentro de la cavidad): su pared es sangre de la aurícula y su luz conserva el
  // flujo sin cara; fuera de la aurícula, por encima de su suelo, no hay VCI (gana el corazón)
  const ivc = tube?.interface === Interface.IvcLumen ? ivcAtrium(m, floor, scene.person?.cpu) : null;
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
    // Grasa compatible D por vóxel (HU, ≤30 mm del riñón, sin máscara): composición, no compartimento.
    if (owner === 'compatible_fat')
      return renalFace({ ...NONE, tissue: SINUS_TISSUE[interior] ?? Tissue.Fat, boundaryDistance: 0 }, solids!);
    // Diafragma de esta persona (decisión 348): la máscara de cada órgano ya ganó antes; no corta el hígado.
    const dome = s0028Diaphragm(scene.person.cpu.regional!, m);
    if (dome !== null) return renalFace(scene.classifyDiaphragm(dome, scene.person.cpu.regional!.s0028InsideWall(m) ?? Infinity), solids!);
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
