import type { UltrasoundRenderer } from '../ultrasound/renderer';
import { cssScale, labelFont } from './canvasText';
import { ecgT, ecgX } from './sweep';

/** Punto de un calibre del modo M: instante y profundidad a lo largo de la línea M (mm). */
export interface MMark {
  t: number;
  r: number;
  pixelMm?: number;
}

/**
 * Franja del modo M (decisión 80): profundidad (de la cara, arriba, al fondo del sector) × tiempo, con el eje de
 * tiempo del ECG (`ecgX`). La dibuja la GPU en una esquina del lienzo de la imagen (`drawMStrip`), se copia aquí con
 * `drawImage` (de GPU a GPU) y la imagen vuelve a la pantalla (`represent`); solo cuando cambian las columnas, el
 * eje o el tamaño. Encima, la escala de profundidad, los calibres y el cursor del cine. `pick` convierte un clic en
 * (t, r) con la misma geometría.
 */
export class MModeView {
  private readonly off = document.createElement('canvas');
  private key = '';
  private view = { tRight: 0, secondsVisible: 1, depthMm: 1 };

  constructor(private readonly canvas: HTMLCanvasElement) {}

  reset(): void {
    this.key = '';
  }

  draw(r: UltrasoundRenderer, tRight: number, secondsVisible: number, cursorT: number | null, marks: readonly MMark[]): void {
    const ctx = this.canvas.getContext('2d');
    const offCtx = this.off.getContext('2d');
    if (!ctx || !offCtx) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const depthMm = r.mStrip.depthMm || 1;
    const key = `${r.mStrip.version} ${tRight} ${secondsVisible} ${W} ${H} ${r.canvas.width} ${r.canvas.height}`;
    if (key !== this.key) {
      this.key = key;
      const gc = r.canvas;
      const w = Math.min(W, gc.width);
      const h = Math.min(H, gc.height);
      r.drawMStrip(tRight, secondsVisible, w, h);
      if (this.off.width !== W || this.off.height !== H) {
        this.off.width = W;
        this.off.height = H;
      }
      offCtx.drawImage(gc, 0, gc.height - h, w, h, 0, 0, W, H);
      r.represent();
    }
    ctx.drawImage(this.off, 0, 0);
    this.view = { tRight, secondsVisible, depthMm };
    // escala de profundidad cada 5 cm en el borde derecho, como la del sector (la raya toca el borde)
    const k = cssScale(this.canvas);
    ctx.fillStyle = '#9aa7b4';
    ctx.font = labelFont(k);
    ctx.textAlign = 'right';
    for (let cm = 5; cm < depthMm / 10; cm += 5) ctx.fillText(`${cm} cm —`, W, (cm * 10 * H) / depthMm + 4 * k);
    ctx.textAlign = 'start';
    // calibres: una cruz por punto y la vertical de cada par
    ctx.strokeStyle = '#ffc857';
    ctx.lineWidth = 1;
    marks.forEach((m, i) => {
      const x = ecgX(m.t, tRight, secondsVisible, W);
      const y = (m.r / depthMm) * H;
      ctx.beginPath();
      ctx.moveTo(x - 6 * k, y);
      ctx.lineTo(x + 6 * k, y);
      ctx.moveTo(x, y - 6 * k);
      ctx.lineTo(x, y + 6 * k);
      if (i % 2) ctx.lineTo(x, (marks[i - 1].r / depthMm) * H);
      ctx.stroke();
    });
    if (cursorT !== null) drawCursor(ctx, ecgX(cursorT, tRight, secondsVisible, W), H, k);
  }

  /** Instante y profundidad del punto (clientX, clientY), o null fuera de la franja. */
  pick(clientX: number, clientY: number): MMark | null {
    const rect = this.canvas.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return null;
    const v = this.view;
    return { t: ecgT(fx, v.tRight, v.secondsVisible, 1), r: fy * v.depthMm, pixelMm: v.depthMm / rect.height };
  }

  /** Ventana de tiempo que muestra la franja. */
  window(): [number, number] {
    return [this.view.tRight - this.view.secondsVisible, this.view.tRight];
  }
}

/** Cursor del cuadro del cine (decisión 80) en una franja: línea vertical con una marca arriba (en px CSS, k = cssScale). */
export function drawCursor(ctx: CanvasRenderingContext2D, x: number, H: number, k: number): void {
  ctx.strokeStyle = ctx.fillStyle = '#5cc8ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, H);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 5 * k, 0);
  ctx.lineTo(x + 5 * k, 0);
  ctx.lineTo(x, 6 * k);
  ctx.fill();
}
