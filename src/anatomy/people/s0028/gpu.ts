import { personShader } from '../../gpu/personShader';
import type { InstalledCpuPerson, PersonGpuPlan } from '../../person';
import { Interface } from '../../interfaces';
import { Tissue } from '../../tissues';
import { S0028_BUNDLE } from './descriptor';
import { S0028_TUBE_SEGMENTS } from './vessels';
/**
 * Aspecto de las caras de s0028 (decisión 368). La cortical ósea se ve como un arco brillante y continuo aunque el haz no le llegue
 * de frente: el hueso es rugoso a la escala de la onda. Con la pendiente de 0,15 de la otra persona, la cortical de una vértebra
 * salía en destellos sueltos. Valor [EXTRAPOLACIÓN PROPIA].
 */
export const S0028_INTERFACE_LOOK = Object.freeze({ [Interface.RibCortex]: { slopeRms: 0.5 } });

/**
 * Aspecto de los tejidos de s0028 donde la tabla común no basta para leer la imagen (decisión 355). Su grasa visceral es la del
 * TAC, no una cáscara analítica: con 1,3–2,5 dB sobre el hígado los bordes de hígado, riñón y páncreas no se distinguían. Y su
 * estómago y su colon están llenos: contenido ecogénico y grueso que atenúa, no líquido. Valores [EXTRAPOLACIÓN PROPIA].
 */
export const S0028_TISSUE_LOOK = Object.freeze({
  [Tissue.PerirenalFat]: { backscatter: 3 },
  [Tissue.MesentericFat]: { backscatter: 2.6 },
  // El músculo de la pared se ve más oscuro que su grasa, como una lente hipoecoica entre fascias (decisión 366).
  [Tissue.Muscle]: { backscatter: 0.24 },
  // Miocardio de gris medio: la pared se distingue de la sangre de su cavidad (decisión 369).
  [Tissue.Myocardium]: { backscatter: 0.9 },
  // Páncreas algo más ecogénico que el hígado y menos que la grasa que lo rodea: se distingue de los dos (decisión 367).
  [Tissue.Pancreas]: { backscatter: 1.9 },
  [Tissue.GastricContents]: { backscatter: 0.45, speckleClump: 3, attenuation: 2.5 },
  [Tissue.ColonicContents]: { backscatter: 3.5, attenuation: 5 },
  // Manguito periportal: lo que distingue una rama portal de una suprahepática a cualquier ángulo (decisión 357).
  [Tissue.VesselWallPortal]: { backscatter: 5.5 },
});
export function gpuPlan(person: InstalledCpuPerson): PersonGpuPlan {
  return Object.freeze({
    specializeFragment: (source: string) => personShader(source, { person: 's0028', bundle: S0028_BUNDLE }),
    uploads: [...person.cpu.regional!.s0028WallUploads(), ...person.cpu.regional!.s0028SolidsUploads()],
    tubeSegments: S0028_TUBE_SEGMENTS,
    tissueLook: S0028_TISSUE_LOOK,
    interfaceLook: S0028_INTERFACE_LOOK,
  });
}
