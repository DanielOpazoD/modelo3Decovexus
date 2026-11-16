import { CURRENT_BUNDLE } from '../anatomy/anatomyBundle';
import type { Torso } from '../anatomy/primitives';
import { startPointsFor, type StartPoint } from './startPoints';

/** Accesos del examen; los presets históricos de calibración conservan sus IDs fuera del menú. */
export const WINDOW_GROUPS = [
  {
    label: 'Porta',
    windows: [
      ['portal', 'Intrahepática'],
      ['portalSubcostal', 'Subcostal'],
    ],
  },
  {
    label: 'Suprahepáticas',
    windows: [
      ['intercostal', 'Intercostal'],
      ['subcostal', 'Subcostal'],
    ],
  },
  {
    label: 'VCI y aorta',
    windows: [
      ['epigastric', 'Eje corto'],
      ['subxiphoid', 'Eje largo'],
      ['aortaSagittal', 'Aorta'],
    ],
  },
  {
    label: 'Renal',
    windows: [
      ['renal', 'Focalizada'],
      ['hepatorenal', 'Hepatorrenal'],
      ['splenorenal', 'Esplenorrenal'],
    ],
  },
] as const satisfies readonly { label: string; windows: readonly (readonly [StartPoint['id'], string])[] }[];

/** Menú y marcas 3D comparten las mismas diez posiciones; no son límites al movimiento libre. */
export function windowMenuPoints(torso: Pick<Torso, 'a' | 'b' | 'profile' | 'person'>): readonly StartPoint[] {
  const points = startPointsFor(torso, torso.person?.assets.identity ?? CURRENT_BUNDLE);
  return WINDOW_GROUPS.flatMap(({ windows }) => windows.map(([id]) => points.find((sp) => sp.id === id)!));
}
