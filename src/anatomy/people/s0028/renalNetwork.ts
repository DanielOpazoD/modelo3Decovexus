import type { Vec3 } from '../../../core/vec3';
import type { VesselId } from '../../../physiology/vessels';
import { S0028_RENAL_NETWORK } from '../../s0028RenalNetworkData';
import type { VesselDef } from '../../vesselTree';

/**
 * Red interlobar del riñón derecho de s0028 (decisión 402). Cada arteria va junto a su vena, como en un riñón real, y la puerta PW
 * sobre una recoge las dos; los pares salen del seno por las columnas de corteza de su TAC, alrededor de todo el seno, y se doblan
 * en arcuata: el riñón enseña vasos también al abanicar o deslizar la sonda fuera del plano de la ventana. Las madres conservan
 * su vena original (la de la puerta del alumno) y su `refRadius`; las ramas comparten su id y su velocidad (`flowFactor` 1) y no
 * definen área. [EXTRAPOLACIÓN PROPIA: la disposición; el TAC sin contraste no muestra los vasos intrarrenales.]
 */
export function placeS0028RenalNetwork(vessels: VesselDef[]): VesselDef[] {
  const branches: VesselDef[] = [];
  for (const [k, mother, artery, vein] of S0028_RENAL_NETWORK)
    for (const [kind, nodes] of [
      ['Artery', artery],
      ['Vein', vein],
    ] as const) {
      const id = `interlobar${kind}${k}` as VesselId;
      const parent = vessels.find((v) => v.id === id && v.flowFactor === undefined);
      if (!parent) throw new Error('Interlobar madre ausente: ' + id);
      const tube = { ...parent.tube, nodes: nodes.map(([x, y, z, r]) => ({ p: [x, y, z] as Vec3, r })) };
      if (mother) parent.tube = tube;
      else branches.push({ ...parent, tube, flowFactor: 1 });
    }
  return branches;
}
