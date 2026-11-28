/**
 * Reparto del teclado (objetivo 6) entre la imagen enfocada, la sonda, el cine y los atajos:
 * 1. La imagen enfocada (`#overlay`, `controllers/imageClick`) atiende en su elemento, antes que `window`, las flechas y, con
 *    el calibrador armado, Intro (no su repetición): mueven la cruz del calibrador o, en vivo, la puerta PW, la caja de color
 *    o, solo ← →, la línea M. Lo que atiende no sigue.
 * 2. `appKey` dice qué llega a la sonda, al cine y a los atajos: nada desde un campo de formulario (un deslizador conserva solo
 *    sus flechas, Inicio y Fin) ni con Ctrl/⌘, que son del navegador y del sistema (zoom, copiar, imprimir; en macOS ⌘ se
 *    traga además el keyup de la letra). AltGr (Ctrl+Alt en Windows) sí llega: escribe [ y ].
 * 3. Congelada, ← → Inicio y Fin recorren el cine; en vivo, las teclas de la sonda la mueven (`ProbeInput`); el resto son
 *    los atajos (`keyboardShortcuts`). Espacio congela también sobre un botón: es el gesto del ecógrafo.
 * Fuera de este reparto, Esc cierra antes lo suyo y, si había algo, no lo deja seguir: el ⓘ a la vista (`panel.ts`), una
 * ventana emergente (`disclosure.ts`) y la selección o la guía del corte enfocado (`cutMapView.ts`); el visor venoso, modal,
 * no deja salir sus teclas.
 */
export function appKey(e: KeyboardEvent): boolean {
  const el = e.target as HTMLInputElement | null;
  const tag = el?.tagName;
  if (e.metaKey || (e.ctrlKey && !e.getModifierState('AltGraph')) || tag === 'SELECT' || tag === 'TEXTAREA') return false;
  return tag !== 'INPUT' || (el?.type === 'range' && !/^(Arrow|Home|End)/.test(e.key));
}
