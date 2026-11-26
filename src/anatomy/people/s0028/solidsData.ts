import { Tissue } from '../../tissues';
import { S0028_RENAL_INTERIOR as R } from '../../s0028RenalInteriorData';
import { S0028_BUNDLE as B } from './descriptor';
export const S0028_RENAL_FACE_MM = 1.2;
/**
 * Donde la carta de pared no conoce la celda, la grasa a más de esta profundidad bajo la piel (mm) es visceral: el panículo de
 * esta persona mide 29 mm de mediana y 39 en su percentil 90, y la cara interna de su pared, 38 y 48.
 */
export const S0028_SUBCUTANEOUS_REACH_MM = 50;
/** Profundidad bajo la piel (mm) desde la que la cara anterior del pulmón lleva lámina de diafragma (decisión 375). */
export const S0028_DIAPHRAGM_DEEP_MM = 60;
/**
 * Fascia superficial del panículo (la capa membranosa que todo ecografista ve como una línea continua dentro de la grasa): el TAC no
 * la resuelve, así que su profundidad es una fracción estimada del espesor de la grasa de esta persona, no una medida.
 */
export const S0028_SCARPA_FRACTION = 0.45;
/**
 * La grasa pegada por dentro a la pared (preperitoneal, propia de la pared) es hipoecoica como el panículo; la de más adentro es
 * visceral y ecogénica. Espesor máximo estimado de esa lámina (mm): en el epigastrio de esta persona mide 10 a 12 mm.
 */
export const S0028_PREPERITONEAL_MM = 15;
/**
 * Distancia (mm) al corazón hasta la que la grasa es epicárdica o pericárdica (decisión 380): hipoecoica, como la del panículo. Con
 * el material brillante de la grasa visceral, entre el hígado y el corazón salía una banda blanca.
 */
export const S0028_EPICARDIAL_MM = 15;
/**
 * Entre la cara interna de la pared y el hígado queda una cáscara sin máscara, casi toda de menos de 2 mm (volumen parcial del
 * TAC). Hasta esta distancia de ambos se dibuja como músculo de la pared: sin ella el borde hepático quedaba tras una franja gris.
 */
export const S0028_LIVER_GAP_MM = 8;
/** …y solo a más de esto del riñón: su contorno y el receso hepatorrenal no reciben músculo ni grasa estimados (361, 364). */
export const S0028_LIVER_GAP_KIDNEY_MM = 10;
/** A menos de esto del hígado la pared no dibuja su línea de peritoneo: la cápsula hepática es esa misma línea, no una segunda. */
export const S0028_LIVER_SEAM_MM = 4;
/** Colocación xyz de cada página 32×32 RG16F de una tabla en el atlas abdominal: x/32 + 6·y/32 + 48·z, tres cifras en base 36. */
export const s0028Pages = (pages: string): number[][] =>
  Array.from({ length: pages.length / 3 }, (_, i) => {
    const c = parseInt(pages.slice(3 * i, 3 * i + 3), 36);
    return [(c % 6) * 32, (Math.floor(c / 6) % 8) * 32, Math.floor(c / 48)];
  });
/** Subidas de una tabla de páginas: la página i son las palabras 2048·i a 2048·(i + 1) de `words`, en su colocación. */
export const s0028PageUploads = (pages: readonly number[][], words: Uint16Array) =>
  pages.map((offset, i) => ({ offset, size: [32, 32, 1], data: words.subarray(2048 * i, 2048 * (i + 1)) }));
/** Páginas de la grasa P3 en el atlas abdominal. */
export const s0028FatPages = (): number[][] => s0028Pages(B.solids.pages);
/** Páginas del interior renal en el atlas abdominal (`R.pageCount`, tres cifras cada una), con el mismo código que la grasa. */
export const s0028RenalPages = (): number[][] => s0028Pages(R.pages);
/** Páginas de la grasa del abdomen a 3 mm, con el mismo código que la grasa P3. */
export const s0028WideFatPages = (): number[][] => s0028Pages(B.wideFat.pages);
/** Entero exacto (0–2047) como half float, como lo guarda una página RG16F. */
export const intHalf = (n: number): number => {
  if (n === 0) return 0;
  const e = Math.floor(Math.log2(n));
  return ((e + 15) << 10) | ((n / 2 ** e - 1) * 1024);
};
/** Radio (mm) del cuerpo vertebral lumbar con que su cortical reparte el eco: un cilindro vertical (decisión 368). [ESTIMADO] */
export const S0028_LUMBAR_BODY_RADIUS_MM = 22;
/**
 * Grasa de esta persona al otro lado de la cápsula hepática (decisión 378): la perirrenal, que da la interfase hepatorrenal. La
 * tabla común solo cuenta la mesentérica y la retroperitoneal. La grasa de la pared no entra: mirando de cerca, una lámina de
 * 1–3 mm entre pared e hígado encendía la línea a tramos; mirando a 4,5 mm se perdía la hepatorrenal.
 */
export const S0028_CAPSULE_FAT_TISSUES = Object.freeze([Tissue.PerirenalFat]);
/**
 * Pared libre mínima del corazón (mm): por dentro del contorno de su máscara, lo que no llega a esta profundidad es miocardio aunque
 * el esquema de cavidades lo alcance. Sin ella la sangre de una cavidad tocaba la grasa de fuera (decisión 369). [ESTIMADO]
 */
export const S0028_HEART_WALL_MM = 4;
