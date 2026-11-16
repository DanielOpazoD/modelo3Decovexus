import type { GallbladderShape } from '../../organs/gallbladder';

/**
 * Vesícula en ayunas de s0028 (decisión 413), nodos de la línea media de la luz del fondo al cuello (x, y, z en mm LAS; radio).
 * La de su TAC está contraída (4,7 ml): una ecografía VExUS se hace en ayunas, con la vesícula llena. La pera (21 ml, unos 6 cm
 * de largo y 2,4 cm de ancho, pared aparte) contiene el 94 % de la contraída y ocupa su fosa: el cuello mira al hilio, junto al
 * colédoco, y el fondo baja hacia delante y afuera hasta apoyarse en el ángulo hepático del colon, que cede (13 ml) como el hígado.
 * No toca venas, pared ni hueso. [EXTRAPOLACIÓN PROPIA: tamaño de ayunas habitual; la forma, la del módulo de órgano.]
 */
export const S0028_GALLBLADDER: Pick<GallbladderShape, 'nodes' | 'blendMm'> = {
  blendMm: 6,
  nodes: [
    { p: [-82.4, 47.6, -102.9], r: 10.5 }, // fondo
    { p: [-70.9, 39.8, -93.8], r: 12 }, // cuerpo
    { p: [-61.7, 33.6, -86.6], r: 10.5 }, // infundíbulo
    { p: [-55.7, 28.3, -85.7], r: 6.5 }, // bolsa de Hartmann
    { p: [-52, 27, -79], r: 4 }, // cuello
  ],
};
