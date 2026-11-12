import { personShader } from '../../gpu/personShader';
import type { InstalledCpuPerson, PersonGpuPlan } from '../../person';
import { Tissue } from '../../tissues';
import { S0028_BUNDLE } from './descriptor';
import { S0028_TUBE_SEGMENTS } from './vessels';
/**
 * Aspecto de los tejidos de s0028 donde la tabla común no basta para leer la imagen (decisión 355). Su grasa visceral es la del
 * TAC, no una cáscara analítica: con 1,3–2,5 dB sobre el hígado los bordes de hígado, riñón y páncreas no se distinguían. Y su
 * estómago y su colon están llenos: contenido ecogénico y grueso que atenúa, no líquido. Valores [EXTRAPOLACIÓN PROPIA].
 */
export const S0028_TISSUE_LOOK = Object.freeze({
  [Tissue.PerirenalFat]: { backscatter: 3 },
  [Tissue.MesentericFat]: { backscatter: 2.6 },
  [Tissue.GastricContents]: { backscatter: 0.45, speckleClump: 3, attenuation: 2.5 },
  [Tissue.ColonicContents]: { backscatter: 3.5, attenuation: 5 },
});
export function gpuPlan(person: InstalledCpuPerson): PersonGpuPlan {
  return Object.freeze({
    specializeFragment: (source: string) => personShader(source, { person: 's0028', bundle: S0028_BUNDLE }),
    uploads: [...person.cpu.regional!.s0028WallUploads(), ...person.cpu.regional!.s0028SolidsUploads()],
    tubeSegments: S0028_TUBE_SEGMENTS,
    tissueLook: S0028_TISSUE_LOOK,
  });
}
