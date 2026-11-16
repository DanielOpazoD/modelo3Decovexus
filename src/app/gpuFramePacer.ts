type PendingGpuContext = { gl: WebGL2RenderingContext; sync: WebGLSync | null };

/**
 * RAF de espera a partir de las cuales se cede otra antes de adquirir. Una sola es una GPU real cuyo cuadro terminó justo
 * después del refresco: ceder ahí convertía 30 cuadros por segundo en 20 al mover la sonda. Dos o más son una cola lenta
 * (GPU por software, otra vista preparando sus recursos), el caso para el que existe la cesión.
 */
export const YIELD_AFTER_WAITS = 2;
/** Tope de la comprobación temprana de la valla tras un RAF (ms): poco más de un refresco a 60 Hz (decisión 405). */
export const EARLY_CHECK_MS = 18;

/** Una adquisición en vuelo por vista: la CPU no acumula cuadros por delante de la GPU. */
export class GpuFramePacer {
  #pending: PendingGpuContext[] = [];
  #waits = 0;

  get inFlight(): boolean {
    return this.#pending.length > 0;
  }

  /** Consulta sin espera; un contexto perdido queda a cargo del controlador de recuperación. */
  ready(): boolean {
    let completed = false;
    let waiting = false;
    let error = '';
    for (let i = this.#pending.length - 1; i >= 0; i--) {
      const pending = this.#pending[i];
      const { gl } = pending;
      if (gl.isContextLost()) {
        if (pending.sync) gl.deleteSync(pending.sync);
        this.#pending.splice(i, 1);
        continue;
      }
      // También se repara con la imagen congelada, sin necesitar otro submit.
      if (!pending.sync) this.#fence(pending);
      const { sync } = pending;
      if (!sync) {
        waiting = true;
        error = 'No se pudo crear la valla del cuadro GPU';
        continue;
      }
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) {
        waiting = true;
        continue;
      }
      pending.sync = null;
      gl.deleteSync(sync);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
        this.#pending.splice(i, 1);
        completed = true;
      } else {
        waiting = true;
        error = 'No se pudo comprobar la finalización del cuadro GPU';
      }
    }
    if (waiting) this.#waits++;
    // Un fallo de valla no dice cuánto tardó el cuadro: se trata como una espera larga.
    if (error) this.#waits = Math.max(this.#waits, YIELD_AFTER_WAITS);
    const yieldFrame = this.#waits >= YIELD_AFTER_WAITS && completed;
    if (!this.inFlight) this.#waits = 0;
    if (error) throw new Error(error);
    // Si la espera fue larga, ceder una RAF con la cola vacía permite que otra vista
    // prepare sus recursos antes de volver a ocupar la GPU. Sin demora fija.
    return !this.inFlight && !yieldFrame;
  }

  /**
   * ¿Terminó ya la GPU el cuadro en vuelo? Consulta sin espera que no cuenta como espera ni libera vallas (eso lo hace `ready`).
   * El bucle la usa entre dos RAF (decisión 405): con la ecografía de s0028 (12–17 ms de GPU) la valla llegaba justo después del
   * refresco y el cuadro siguiente esperaba otra RAF entera, 30 fps con la GPU ociosa la mitad del tiempo.
   */
  settled(): boolean {
    for (const { gl, sync } of this.#pending) {
      if (gl.isContextLost()) continue;
      if (!sync) return false;
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) return false;
    }
    return true;
  }

  submit(...contexts: WebGL2RenderingContext[]): void {
    if (this.inFlight) throw new Error('Ya hay un cuadro GPU en vuelo');
    let failed = false;
    for (const gl of new Set(contexts)) {
      if (gl.isContextLost()) continue;
      const pending: PendingGpuContext = { gl, sync: null };
      this.#pending.push(pending);
      this.#fence(pending);
      failed ||= !pending.sync;
    }
    if (failed) throw new Error('No se pudo crear la valla del cuadro GPU');
  }

  #fence(pending: PendingGpuContext): void {
    const { gl } = pending;
    pending.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (pending.sync) gl.flush();
  }
}
