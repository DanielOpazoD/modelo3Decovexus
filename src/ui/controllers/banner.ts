/**
 * Aviso superpuesto a la imagen (GPU perdida, audio, caso, bucle degradado). Se anuncia (`role="alert"`, como el aviso del
 * corte) al aparecer y al cambiar de texto; el mismo texto repetido (el bucle degradado, cada segundo) no se reescribe.
 */
export class Banner {
  private el: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: HTMLElement) {}

  show(text: string, autoHideMs?: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = autoHideMs ? setTimeout(() => this.hide(), autoHideMs) : null;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'banner';
      this.el.setAttribute('role', 'alert');
      this.host.appendChild(this.el);
    }
    if (this.el.textContent !== text) this.el.textContent = text;
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
  }
}
