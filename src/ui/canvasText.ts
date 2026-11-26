/**
 * Texto de los lienzos 2D en píxeles CSS (misión, objetivo 6: nunca menos de 12 px). `fitCanvases` da a cada lienzo
 * un mapa de bits de clientWidth·DPR, así que un rótulo de tamaño fijo encogía a 1/DPR en pantallas 2×.
 */
export const MIN_TEXT_PX = 12;

/** Píxeles de mapa de bits por píxel CSS; 1 si el lienzo no está maquetado. */
export function cssScale(canvas: HTMLCanvasElement): number {
  return canvas.width / (canvas.clientWidth || canvas.width) || 1;
}

/** Letra de rótulo de `px` CSS (nunca menos de 12) para un lienzo de escala `k`. */
export function labelFont(k = 1, px = MIN_TEXT_PX): string {
  return `${Math.max(MIN_TEXT_PX, px) * k}px sans-serif`;
}

/** Une `parts` con `sep` en las líneas que quepan en `maxWidth` (de arriba abajo): ninguna parte se corta ni se omite. */
export function wrapParts(ctx: CanvasRenderingContext2D, parts: readonly string[], maxWidth: number, sep = ' · '): string[] {
  const lines: string[] = [];
  for (const part of parts) {
    const joined = lines.length ? lines[lines.length - 1] + sep + part : '';
    if (joined && ctx.measureText(joined).width <= maxWidth) lines[lines.length - 1] = joined;
    else lines.push(part);
  }
  return lines;
}
