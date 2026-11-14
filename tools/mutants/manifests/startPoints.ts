import type { MutantManifest } from '../manifest';

/** Poses de inicio de las ventanas de s0028. */
export const startPoints: MutantManifest = {
  module: 'src/app/startPoints.ts',
  mutants: [
    {
      name: 'subcostal-portal-roza-el-codo',
      origin: 'decisión 381',
      breaks: 'La subcostal portal vuelve a la pose que rozaba el codo de la porta: la luz sale en dos trozos.',
      from: '  portalSubcostal: { phi: 1.6, z: -49.4, yaw: -1.627, rock: 0.295, tilt: 0.255 },',
      to: '  portalSubcostal: { phi: 1.6, z: -50, yaw: -1.602, rock: 0.295, tilt: 0.255 },',
      tests: ['src/validation/s0028Windows.test.ts'],
    },
  ],
};
