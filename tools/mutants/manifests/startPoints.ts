import type { MutantManifest } from '../manifest';

/** Poses de inicio de las ventanas de s0028. */
export const startPoints: MutantManifest = {
  module: 'src/app/startPoints.ts',
  mutants: [
    {
      name: 'subcostal-portal-sin-eje-largo',
      origin: 'decisiones 381 y 386',
      breaks: 'La subcostal portal vuelve a la pose que solo enseñaba el codo de la bifurcación, sin la porta en eje largo.',
      from: '  portalSubcostal: { phi: 1.6, z: -100, yaw: -1.2, rock: 0.131, tilt: 0.15 },',
      to: '  portalSubcostal: { phi: 1.6, z: -49.4, yaw: -1.627, rock: 0.295, tilt: 0.255 },',
      tests: ['src/validation/s0028Windows.test.ts'],
    },
    {
      name: 'hepatorrenal-con-costillas-y-duodeno',
      origin: 'decisión 383',
      breaks: 'La hepatorrenal vuelve a la pose con dos costillas cruzando el campo, el duodeno junto al riñón y 66 mm de riñón.',
      from: '  hepatorenal: { phi: 3.2, z: -95, yaw: -0.8, rock: -0.188, tilt: -0.281 },',
      to: '  hepatorenal: { phi: 3.2, z: -90, yaw: -1.05, rock: 0.076, tilt: -0.236 },',
      tests: ['src/validation/s0028Windows.test.ts'],
    },
    {
      name: 'intercostal-sin-union-con-la-cava',
      origin: 'decisión 383',
      breaks: 'La intercostal vuelve a la pose en que la suprahepática derecha y la cava no se unen en el plano.',
      from: '  intercostal: { phi: 3.435, z: -68, yaw: 0.07, rock: 0, tilt: 0.112 },',
      to: '  intercostal: { phi: 3.55, z: -100, yaw: -0.838, rock: 0.488, tilt: 0.456 },',
      tests: ['src/validation/s0028Windows.test.ts'],
    },
    {
      name: 'intercostal-con-costilla-sobre-la-vena',
      origin: 'decisión 388',
      breaks: 'La intercostal vuelve a la pose en que la costilla central tapa el tramo alto de la suprahepática derecha.',
      from: '  intercostal: { phi: 3.435, z: -68, yaw: 0.07, rock: 0, tilt: 0.112 },',
      to: '  intercostal: { phi: 3.475, z: -70, yaw: -0.05, rock: 0.075, tilt: 0.112 },',
      tests: ['src/validation/s0028Windows.test.ts'],
    },
    {
      name: 'intrahepatica-con-grasa-al-borde',
      origin: 'decisión 385',
      breaks: 'La intrahepática vuelve a la pose que corta la grasa junto a la vesícula y pierde la rama anterior de la porta.',
      from: '  portal: { phi: 2.725, z: -59.014, yaw: -0.994, rock: 0.214, tilt: 0.086 },',
      to: '  portal: { phi: 2.8, z: -65, yaw: -0.996, rock: 0.097, tilt: 0.067 },',
      tests: ['src/validation/s0028Windows.test.ts'],
    },
  ],
};
