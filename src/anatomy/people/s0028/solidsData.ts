import { S0028_RENAL_INTERIOR as R } from '../../s0028RenalInteriorData';
import { S0028_BUNDLE as B } from './descriptor';
export const S0028_RENAL_FACE_MM = 1.2;
/**
 * Donde la carta de pared no conoce la celda, la grasa a más de esta profundidad bajo la piel (mm) es visceral: el panículo de
 * esta persona mide 29 mm de mediana y 39 en su percentil 90, y la cara interna de su pared, 38 y 48.
 */
export const S0028_SUBCUTANEOUS_REACH_MM = 50;
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
/** Colocación xyz de cada página 32×32 RG16F de grasa en el atlas abdominal: x/32 + 6·y/32 + 48·z, tres cifras en base 36. */
export const s0028FatPages = (): number[][] =>
  Array.from({ length: B.solids.pages.length / 3 }, (_, i) => {
    const c = parseInt(B.solids.pages.slice(3 * i, 3 * i + 3), 36);
    return [(c % 6) * 32, (Math.floor(c / 6) % 8) * 32, Math.floor(c / 48)];
  });
/** Colocación xyz de cada página 32×32 RG16F del interior renal en el atlas abdominal, con el mismo código que la grasa. */
export const s0028RenalPages = (): number[][] =>
  Array.from({ length: R.pageCount }, (_, i) => {
    const c = parseInt(R.pages.slice(3 * i, 3 * i + 3), 36);
    return [(c % 6) * 32, (Math.floor(c / 6) % 8) * 32, Math.floor(c / 48)];
  });
/** Colocación xyz de cada página 32×32 RG16F de la grasa del abdomen a 3 mm, con el mismo código que la grasa P3. */
export const s0028WideFatPages = (): number[][] =>
  Array.from({ length: B.wideFat.pages.length / 3 }, (_, i) => {
    const c = parseInt(B.wideFat.pages.slice(3 * i, 3 * i + 3), 36);
    return [(c % 6) * 32, (Math.floor(c / 6) % 8) * 32, Math.floor(c / 48)];
  });
