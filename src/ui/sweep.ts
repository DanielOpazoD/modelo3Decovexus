/**
 * Eje temporal del espectrograma desplazable, el MISMO que el del ECG: el píxel x muestra el
 * instante tRight − (W − x)/pxPerSec. El mapa de bits se desplaza un número entero de píxeles por
 * cuadro y guarda el resto, así que su borde derecho corresponde siempre a un instante conocido
 * (`rightT`), a menos de un píxel de `tNow`. Cada columna espectral se pinta en el tramo de píxeles
 * de SU intervalo de tiempo. Antes cada columna ocupaba `round(dtCol·pxPerSec)` píxeles: el
 * redondeo hacía avanzar el espectro entre 0,7× y 5,5× la velocidad del ECG (a 25 mm/s y PRF 2600,
 * el doble), justo la referencia que se usa para identificar S y D frente al QRS.
 */
/** Mayor hueco (px) entre dos columnas seguidas que se toma por redondeo y se cierra (decisión 407). */
export const SEAM_PX = 2;

export class SweepTimeline {
  /** Instante (s) que corresponde al borde derecho del mapa de bits; NaN antes del primer cuadro. */
  rightT = Number.NaN;
  /** Borde derecho (px) de la última columna colocada con `place`, en el mapa de bits actual; −1 sin columna. */
  #lastX1 = -1;

  reset(): void {
    this.rightT = Number.NaN;
    this.#lastX1 = -1;
  }

  /**
   * Avanza el eje hasta `tNow` y devuelve cuántos píxeles hay que desplazar el mapa de bits a la
   * izquierda (0 si el tiempo retrocede o es el primer cuadro: entonces hay que limpiarlo).
   */
  advance(tNow: number, pxPerSec: number): { shiftPx: number; cleared: boolean } {
    if (!Number.isFinite(this.rightT) || tNow < this.rightT) {
      this.rightT = tNow;
      this.#lastX1 = -1;
      return { shiftPx: 0, cleared: true };
    }
    const shiftPx = Math.floor((tNow - this.rightT) * pxPerSec);
    this.rightT += shiftPx / pxPerSec;
    if (this.#lastX1 >= 0) this.#lastX1 = Math.max(-1, this.#lastX1 - shiftPx);
    return { shiftPx, cleared: false };
  }

  /** ¿Cabe ya entera en el mapa de bits una columna centrada en `t` de duración `dt`? */
  ready(t: number, dt: number): boolean {
    return t + dt / 2 <= this.rightT + 1e-9;
  }

  /** Píxeles [x0, x1) de la columna centrada en `t` de duración `dt`, recortados a [0, W]. */
  span(t: number, dt: number, pxPerSec: number, W: number): [number, number] {
    const x0 = Math.round(W - (this.rightT - (t - dt / 2)) * pxPerSec);
    const x1 = Math.round(W - (this.rightT - (t + dt / 2)) * pxPerSec);
    return [Math.max(0, Math.min(W, x0)), Math.max(0, Math.min(W, Math.max(x1, x0 + 1)))];
  }

  /**
   * `span` empalmada con la columna anterior (decisión 407). Los instantes de las columnas bailan ~0,2 ms (los pulsos se
   * acumulan con resto) y, a ~1 px por columna, redondear cada borde por su lado dejaba a veces un píxel sin pintar entre dos:
   * una línea negra vertical en el espectro. Un hueco de redondeo (≤ SEAM_PX) se cierra; uno mayor (una pausa de la
   * adquisición) sigue negro.
   */
  place(t: number, dt: number, pxPerSec: number, W: number): [number, number] {
    let [x0, x1] = this.span(t, dt, pxPerSec, W);
    if (this.#lastX1 >= 0 && x0 > this.#lastX1 && x0 - this.#lastX1 <= SEAM_PX) x0 = this.#lastX1;
    x1 = Math.max(x1, x0);
    this.#lastX1 = x1;
    return [x0, x1];
  }
}

/** Posición x del ECG para el instante `t` (misma fórmula que `drawEcg`). */
export function ecgX(t: number, tRight: number, secondsVisible: number, W: number): number {
  return ((t - (tRight - secondsVisible)) / secondsVisible) * W;
}

/** Instante del píxel x de las franjas (inversa de `ecgX`). */
export function ecgT(x: number, tRight: number, secondsVisible: number, W: number): number {
  return tRight - secondsVisible + (x / W) * secondsVisible;
}

/**
 * Borde derecho (instante) de las franjas de ECG, espectro y modo M. En vivo, el ahora; con el cine en un
 * cuadro más viejo que lo que cabe, las franjas se desplazan con él y su cursor queda a una décima del borde
 * izquierdo (decisión 80).
 */
export function traceRight(tNow: number, cursorT: number | null, secondsVisible: number): number {
  return cursorT === null ? tNow : Math.min(tNow, cursorT + 0.9 * secondsVisible);
}
