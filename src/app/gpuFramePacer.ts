type PendingGpuContext = { gl: WebGL2RenderingContext; sync: WebGLSync | null };

/**
 * RAF de espera a partir de las cuales se cede otra antes de adquirir. Una sola es una GPU real cuyo cuadro terminó justo
 * después del refresco: ceder ahí convertía 30 cuadros por segundo en 20 al mover la sonda. Dos o más son una cola lenta
 * (GPU por software, otra vista preparando sus recursos), el caso para el que existe la cesión.
 */
export const YIELD_AFTER_WAITS = 2;

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
