import { caseVignette } from '../../app/blindMode';
import { errorLog } from '../../app/errorLog';
import { toggleMode } from '../../app/equipment';
import { M_MAX_GAP_S } from '../../ultrasound/mmode';
import { ivcFromCalipers, ivcPixelInterval, ivcTruth, hasRespiratoryCycle, type IvcCollapse } from '../../vexus/ivcCollapse';
import type { MMark } from '../mModeView';
import type { AppState, MeasureTool } from '../../app/store';
import type { MeasurementQuality } from '../../doppler/measureQuality';
import type { ObservedHepatic, ObservedPortal, ObservedRenal } from '../../doppler/spectralMeasure';
import type * as CaptureMeasurements from '../../doppler/capture';
import type { PwAcquiredEquipment, PwPresentation } from '../../doppler/pwChain';
import type { ProtocolVessel } from '../../doppler/vesselIdentity';
import { captureOverlay, type CaptureOverlay } from '../captureOverlay';
import { portalBeatSummary } from '../portalBeatSummary';
import { classifyModifiedVexus, classifyVexusC, type Territory, type VexusContext, type VexusResult } from '../../vexus/classification';
import { button, note, row } from '../controls';
import type { PanelContext } from './context';
import type { Simulator, EquipmentSettings } from '../../app/simulator';
import type { ProbePose } from '../../probe/probe';
import type { RespiratoryPattern } from '../../physiology/patientState';
import {
  CONTEXT_FLAGS,
  CONTEXT_LABELS,
  contextResultLines,
  excludedTerritories,
  gradeValueText,
  hepaticPeaksText,
  ivcDiameterText,
  patternText,
  portalText,
  portalPulsatilityText,
  renalText,
  resultStatusText,
  velocityText,
  type ContextFlag,
} from './vexusText';

interface AcquisitionContext {
  epoch: number;
  time: number;
  respiration: RespiratoryPattern;
  pose: ProbePose;
  equipment: EquipmentSettings;
}
type AcquisitionStamp = AcquisitionContext &
  ({ kind: 'image' } | { kind: 'pw'; revision: number; acquiredEquipment: PwAcquiredEquipment; presentation: PwPresentation });
type Stamps = Partial<Record<'ivc' | 'mmode' | 'hepatic' | 'portal' | 'renal', AcquisitionStamp>>;

/** Aviso del calibrador que volvió a empezar: da por primero el punto pendiente, así que se retira cuando se suelta. */
const CALIPER_RESTARTED = 'La imagen cambió entre los dos puntos: este pasa a ser el primero. Marca las dos paredes en el mismo cuadro.';

function acquisitionStamp(sim: Simulator, image = false): AcquisitionStamp {
  const frame = image ? sim.renderer.displayedFrame : null;
  return structuredClone({
    kind: 'image',
    epoch: sim.acquisitionEpoch,
    time: frame?.t ?? sim.physiology.clock.t,
    respiration: sim.patient.respiratoryPattern,
    pose: frame?.anatomy.pose ?? sim.pose,
    equipment: { ...sim.equipment, ...(frame ? { bmode: frame.bmode, color: frame.color } : { pw: sim.pw }) },
  });
}

/**
 * Pestaña Medir: contexto clínico del caso (viñeta y confusores que marca el alumno, decisión 82), protocolo VExUS
 * (calibrador de VCI, VCI en modo M, suprahepática, porta y vena interlobar sobre el espectro adquirido) y resultado.
 * Guarda las mediciones adquiridas; `clearMeasurements` las borra al cambiar de caso para no mezclar pacientes, y el
 * contexto marcado se borra con el caso. Con una medición armada, arriba aparece su tarjeta de captura.
 */
export class MeasureTab {
  #observations: typeof CaptureMeasurements | null = null;
  #observationLoad: Promise<void> | null = null;
  #loadFailed = false;
  #captureCard!: HTMLElement;
  #measureBody!: HTMLElement;
  #resultEl!: HTMLElement;
  /**
   * Resumen del grado para los lectores de pantalla (`aria-live`): cambia al medir o al marcar un confusor. Va en la
   * pestaña pero fuera del cuerpo de la medida: con el calibrador armado ese cuerpo está oculto y un cambio dentro de un
   * subárbol oculto no se anuncia. (Con el calibrador de ⌘/Ctrl desde otra pestaña, la pestaña entera está oculta: se ve
   * el contador de la pestaña.)
   */
  #liveEl!: HTMLElement;
  private lastHepatic: ObservedHepatic | null = null;
  private lastPortal: ObservedPortal | null = null;
  private lastRenal: ObservedRenal | null = null;
  #lastOverlay: CaptureOverlay | null = null;
  #presentedPwRevision = -1;
  #captureWait!: HTMLElement;
  #ivcCaliperMm: number | null = null;
  /** VCI en modo M (decisión 80): los puntos de los calibres y el resultado con la verdad de su ventana. */
  #mPoints: MMark[] = [];
  #ivcM: (IvcCollapse & { truth: IvcCollapse | null; pixels: [number, number]; respiratoryCycle: boolean }) | null = null;
  /** Confusores marcados por el alumno (decisión 82): empiezan sin marcar y se borran al cambiar de caso. */
  #context: VexusContext = {};
  /** Caso de la viñeta y del contexto marcado. */
  #caseId = '';
  #vignetteEl!: HTMLElement;
  #stamps: Stamps = {};
  #historyEl!: HTMLElement;
  #history: Array<{
    stamps: Stamps;
    hepatic: ObservedHepatic | null;
    portal: ObservedPortal | null;
    renal: ObservedRenal | null;
    ivcMm: number | null;
    ivcM: IvcCollapse | null;
    context: VexusContext;
  }> = [];
  #seriesNote = '';
  /**
   * La verdad del motor (decisión 80) solo con el modo docente, también en el DOM (decisión 82): el HTML del resultado y de
   * cada serie se guarda con ella y se pinta sin ella fuera de ese modo; `#shownDebug`, el modo con que se pintó.
   */
  #shownDebug = false;
  #painted: readonly [html: string, truth: string] = ['', ''];
  #historyViews: Array<[HTMLElement, readonly [string, string]]> = [];
  /** Fila que armó la medición y el control al que pasó el foco (la fila se oculta con el protocolo). */
  #focusBack: [HTMLElement, HTMLElement | null] | null = null;

  readonly #ctx: PanelContext;
  readonly #badge: HTMLElement;

  constructor(ctx: PanelContext, host: HTMLElement, badge: HTMLElement) {
    this.#ctx = ctx;
    this.#badge = badge;
    this.#build(host);
  }

  /** Con una medición armada solo se ve su tarjeta de captura; sin ella, el protocolo y el resultado. */
  applyStore(st: AppState): void {
    this.#captureCard.hidden = st.tool === 'none';
    this.#measureBody.hidden = st.tool !== 'none';
    // desarmada: el foco que sigue donde se medía, o que se perdió al ocultarse la tarjeta, vuelve a su fila
    const back = this.#focusBack;
    if (st.tool === 'none' && back) {
      this.#focusBack = null;
      const a = document.activeElement;
      if (!a || a === document.body || a === back[1] || this.#captureCard.contains(a)) back[0].focus();
    }
    // calibres del modo M a medio poner: se descartan al cancelar la herramienta
    if (st.tool !== 'mmode' && this.#mPoints.length < 4) this.#mPoints = [];
    // el modo docente pone o quita la verdad del motor en el resultado y en las series archivadas
    if (st.debug !== this.#shownDebug) {
      this.renderResult();
      for (const [body, painted] of this.#historyViews) this.#paint(body, painted);
    }
  }

  /**
   * Borra toda medición adquirida (cambio de caso, intervención docente o «Borrar»): nunca se mezclan pacientes ni el
   * antes y el después de una intervención. Devuelve si había alguna.
   */
  clearMeasurements(): boolean {
    const had =
      this.#lastOverlay !== null ||
      this.lastHepatic !== null ||
      this.lastPortal !== null ||
      this.lastRenal !== null ||
      this.#ivcCaliperMm !== null ||
      this.#ivcM !== null ||
      this.#mPoints.length > 0;
    this.lastHepatic = null;
    this.lastPortal = null;
    this.lastRenal = null;
    this.#lastOverlay = null;
    this.#ivcCaliperMm = null;
    this.#ivcM = null;
    this.#mPoints = [];
    this.#stamps = {};
    this.#ctx.sync();
    this.renderResult();
    return had;
  }

  /** Historial de sesión: instantánea independiente, excluida del grado actual. */
  archiveMeasurements(reason: 'respiration' | 'intervention'): boolean {
    const result = this.#painted;
    const record = structuredClone({
      stamps: this.#stamps,
      hepatic: this.lastHepatic,
      portal: this.lastPortal,
      renal: this.lastRenal,
      ivcMm: this.#ivcCaliperMm,
      ivcM: this.#ivcM,
      context: this.#context,
    });
    const had = this.clearMeasurements();
    this.#seriesNote = 'Nueva serie: adquiere señal y repite las mediciones.';
    if (had) {
      this.#history.push(record);
      const entry = document.createElement('details');
      const title = document.createElement('summary');
      title.textContent = `Serie ${this.#history.length} · anterior a ${reason === 'respiration' ? 'cambio respiratorio' : 'intervención'} · excluida del resultado actual`;
      const body = document.createElement('div');
      this.#paint(body, result);
      this.#historyViews.push([body, result]);
      const provenance = document.createElement('p');
      provenance.className = 'small';
      provenance.textContent = Object.entries(record.stamps)
        .map(([kind, s]) => `${kind}: ${s.time.toFixed(1)} s · ${s.respiration}`)
        .join(' / ');
      entry.append(title, provenance, body);
      this.#historyEl.appendChild(entry);
    }
    this.renderResult();
    return had;
  }

  /**
   * El simulador cambió (caso nuevo o «Reiniciar paciente»): se borran las mediciones; con otro caso, además, el
   * contexto marcado y la viñeta pasan a los suyos. Reiniciar el mismo paciente o intervenir no cambia su historia: lo
   * marcado sigue.
   */
  onSimulatorChanged(): void {
    this.#history = [];
    this.#historyViews = [];
    this.#historyEl.innerHTML = '';
    this.#seriesNote = '';
    const id = this.#ctx.sim().patient.id;
    if (id !== this.#caseId) {
      this.#caseId = id;
      this.#context = {};
      this.#vignetteEl.textContent = caseVignette(id);
    }
    this.clearMeasurements(); // sincroniza las casillas y vuelve a pintar el resultado
  }

  /**
   * El calibre de la VCI medido. null no borra la medida anterior, que sigue hasta que otra la sustituye (repetir y
   * cancelar la conserva); con `frameChanged`, el calibrador volvió a empezar porque el cuadro cambió entre sus dos
   * puntos (se dice donde se mira); sin él, el punto pendiente se soltó.
   */
  setIvcCaliper(mm: number | null, frameChanged = false): void {
    const sim = this.#ctx.sim();
    if (mm !== null && sim.acquisitionFrameAfter !== null && (sim.renderer.displayedFrame?.n ?? 0) <= sim.acquisitionFrameAfter) {
      this.#seriesNote = 'Imagen de la serie anterior: descongela y adquiere una imagen nueva antes de medir.';
      this.renderResult();
      return;
    }
    if (mm !== null) {
      this.#ivcCaliperMm = mm;
      this.#stamps.ivc = acquisitionStamp(sim, true);
      this.#seriesNote = '';
    }
    if (frameChanged) {
      // con la fila armada se ve su tarjeta; con ⌘/Ctrl+clic, el resultado
      if (this.#ctx.store.get().tool === 'none') this.#seriesNote = CALIPER_RESTARTED;
      else this.#captureWait.textContent = CALIPER_RESTARTED;
    } else if (mm === null && this.#seriesNote === CALIPER_RESTARTED) this.#seriesNote = '';
    this.renderResult();
  }

  /** Trazado de la última captura sobre el espectro (null sin captura o tras borrar). */
  get captureOverlay(): CaptureOverlay | null {
    return this.#lastOverlay?.revision === this.#ctx.sim().pwChain.revision ? this.#lastOverlay : null;
  }

  syncAcquisition(): void {
    const revision = this.#ctx.sim().pwChain.revision;
    if (revision === this.#presentedPwRevision) return;
    this.#presentedPwRevision = revision;
    this.renderResult();
  }

  /** Calibres del modo M a la vista en la franja (los del último resultado o los que se están poniendo). */
  get mMarks(): readonly MMark[] {
    return this.#mPoints;
  }

  /**
   * Un punto sobre la franja M con la herramienta «VCI modo M» (decisión 80). Cada calibre son dos puntos en el
   * mismo instante (una vertical: pared anterior y posterior); un calibre de menos de 1 mm (dos clics en el mismo
   * sitio) se descarta. Con dos calibres se calcula la colapsabilidad y se compara con la verdad del motor en la
   * ventana que muestra la franja.
   */
  addMPoint(p: MMark, window: [number, number]): void {
    if (this.#ctx.store.get().tool !== 'mmode') return;
    const pts = this.#mPoints.length >= 4 ? [] : this.#mPoints;
    const k = pts.length;
    pts.push(k % 2 ? { ...p, t: pts[k - 1].t } : p);
    const d = (i: number) => Math.abs(pts[i + 1].r - pts[i].r);
    if (k % 2 && d(k - 1) < 1) pts.length = k - 1;
    this.#mPoints = pts;
    if (pts.length === 4) {
      const sim = this.#ctx.sim();
      const samples = sim.physiology.samples;
      const strip = sim.renderer.mStrip;
      // Solo el último tramo continuo adquirido: una línea recién cambiada o un hueco no hereda ciclos del motor.
      let last = strip.count - 1;
      while (last >= 0 && strip.time(last) > window[1]) last--;
      let first = last;
      while (first > 0 && strip.time(first) - strip.time(first - 1) <= M_MAX_GAP_S) first--;
      const from = last >= 0 ? Math.max(window[0], strip.time(first)) : Infinity;
      const to = last >= 0 ? strip.time(last) : -Infinity;
      const respiratoryCycle = hasRespiratoryCycle(samples, from, to);
      const truth = respiratoryCycle ? ivcTruth(samples, from, to) : null;
      const measured = ivcFromCalipers(d(0), d(2));
      this.#ivcM = {
        ...measured,
        truth,
        respiratoryCycle,
        pixels: ivcPixelInterval(measured.maxMm, measured.minMm, Math.max(...pts.map((p) => p.pixelMm ?? 0))),
      };
      this.#stamps.mmode = acquisitionStamp(sim);
      this.#seriesNote = '';
      this.#ctx.store.set({ tool: 'none' });
      this.renderResult();
    } else this.#renderCapture();
  }

  #build(p: HTMLElement): void {
    this.#captureCard = document.createElement('div');
    this.#captureCard.className = 'callout';
    p.appendChild(this.#captureCard);
    this.#liveEl = document.createElement('div');
    this.#liveEl.className = 'sr-only';
    this.#liveEl.setAttribute('aria-live', 'polite');
    p.appendChild(this.#liveEl);
    this.#measureBody = document.createElement('div');
    p.appendChild(this.#measureBody);

    this.#buildContext(this.#measureBody);
    const proto = this.#ctx.section(this.#measureBody, 'Protocolo VExUS', {
      info: 'Suprahepática, porta y vena interlobar se miden sobre el espectro PW adquirido (últimos 7 s, ventanas S/D ancladas al ECG); la VCI, con el calibrador sobre la imagen. Pulsa una fila para medirla.',
    });
    // una fila por medición: el botón la arma y la salida muestra el valor
    const protoRow = (label: string, tool: MeasureTool, value: () => string) => {
      const r = document.createElement('div');
      r.className = 'control proto';
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', (e) => {
        this.#armTool(tool);
        // Con el teclado o un lector de pantalla (el clic no trae pulsaciones), el foco pasa adonde se mide: la imagen con el
        // calibrador (se mide con sus flechas) o la tarjeta. Con el ratón no se mueve: congelada, ← → siguen en el cine.
        const to = e.detail
          ? null
          : (tool === 'caliper' && this.#ctx.measureImage) || this.#captureCard.querySelector<HTMLElement>('button:enabled');
        to?.focus();
        this.#focusBack = [b, to];
      });
      const v = document.createElement('output');
      r.append(b, v);
      proto.appendChild(r);
      this.#ctx.track({ sync: () => (v.textContent = value()) });
    };
    protoRow('VCI diámetro', 'caliper', () => (this.#ivcCaliperMm !== null ? `${ivcDiameterText(this.#ivcCaliperMm)} mm` : '—'));
    protoRow('VCI modo M', 'mmode', () =>
      this.#ivcM ? (this.#ivcM.respiratoryCycle ? `${this.#ivcM.ciPct.toFixed(0)} %` : 'sin ciclo respiratorio') : '—',
    );
    // una captura rechazada por la calidad no muestra patrón (el de un espectro de ruido es «grave»)
    const NOT_MEASURABLE = 'no medible';
    protoRow('Suprahepática', 'hepatic', () => {
      const h = this.lastHepatic;
      return h ? (h.quality.issue ? NOT_MEASURABLE : patternText(h.pattern)) : '—';
    });
    protoRow('Porta PF', 'portal', () => {
      const p = this.lastPortal;
      if (!p) return '—';
      if (p.quality.issue) return NOT_MEASURABLE;
      return portalPulsatilityText(p.pulsatilityFraction, p.pulsatilityLowerBound);
    });
    protoRow('Renal', 'renal', () => {
      const k = this.lastRenal;
      return k ? (k.quality.issue ? NOT_MEASURABLE : renalText(k.pattern)) : '—';
    });

    const res = this.#ctx.section(this.#measureBody, 'Resultado');
    this.#resultEl = document.createElement('div');
    this.#resultEl.className = 'result';
    res.appendChild(this.#resultEl);
    // el calibrador libre era la misma herramienta que «VCI diámetro»: queda solo borrar
    button(row(res), 'Borrar mediciones', () => {
      this.#ctx.store.set({ tool: 'none' });
      this.#ctx.cancelCaliper?.(); // también el punto de ⌘/Ctrl+clic, que no arma herramienta
      this.clearMeasurements();
    });
    this.#historyEl = document.createElement('div');
    this.#historyEl.className = 'measurement-history';
    res.appendChild(this.#historyEl);
    this.renderResult();
  }

  /**
   * «Contexto clínico» (decisión 82): la viñeta del caso, que ve también el alumno, y una casilla por confusor. Lo
   * marcado entra en el grado (`classifyVexusC` con el contexto): un territorio poco fiable cuenta como no evaluado y
   * el resultado dice por qué.
   */
  #buildContext(parent: HTMLElement): void {
    const sec = this.#ctx.section(parent, 'Contexto clínico', {
      info:
        'Lo que sabes del paciente antes de medir. Marca los confusores que tenga: cada uno quita solo el hallazgo que ' +
        'puede falsear, que cuenta como no evaluado (el grado pasa a intervalo): la ERC avanzada o la diálisis un riñón ' +
        'grave, el deportista una porta grave, y la cirrosis la porta siempre y la suprahepática si no está invertida. La ' +
        'FA, la falta de ECG y la ventilación con presión positiva solo avisan; con la presión intraabdominal alta una ' +
        'VCI < 20 mm no cierra el grado en 0. El mVExUS es el grado sin el riñón (Martin 2025).',
    });
    this.#caseId = this.#ctx.sim().patient.id;
    this.#vignetteEl = document.createElement('p');
    this.#vignetteEl.className = 'vignette';
    this.#vignetteEl.textContent = caseVignette(this.#caseId);
    sec.appendChild(this.#vignetteEl);
    const group = document.createElement('fieldset');
    group.className = 'checks';
    const legend = document.createElement('legend');
    legend.textContent = 'Confusores del paciente';
    group.appendChild(legend);
    for (const flag of CONTEXT_FLAGS) {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.addEventListener('change', () => this.#setContextFlag(flag, box.checked));
      label.append(box, document.createTextNode(CONTEXT_LABELS[flag]));
      group.appendChild(label);
      this.#ctx.track({ sync: () => (box.checked = this.#context[flag] === true) });
    }
    sec.appendChild(group);
  }

  #setContextFlag(flag: ContextFlag, on: boolean): void {
    const next = { ...this.#context };
    if (on) next[flag] = true;
    else delete next[flag];
    this.#context = next;
    this.renderResult();
  }

  #armTool(tool: MeasureTool): void {
    if (tool === 'hepatic' || tool === 'portal' || tool === 'renal') {
      this.#loadObservations();
      // abre el PW conservando el color si estaba encendido (tríplex, decisión 66)
      if (!this.#ctx.sim().pw.enabled) this.#ctx.store.set({ mode: toggleMode(this.#ctx.store.get().mode, 'pw') });
      this.#ctx.store.set({ tool });
      this.#renderCapture();
      return;
    }
    if (tool === 'mmode') {
      this.#mPoints = [];
      this.#ctx.store.set({ mode: 'M' });
    }
    this.#ctx.store.set({ tool });
    this.#renderCapture();
  }

  #renderCapture(): void {
    const tool = this.#ctx.store.get().tool;
    this.#captureCard.innerHTML = '';
    if (tool === 'none') return;
    const title = document.createElement('h3');
    title.textContent =
      tool === 'caliper'
        ? 'Calibrador'
        : tool === 'mmode'
          ? 'VCI en modo M'
          : tool === 'hepatic'
            ? 'Medir suprahepática'
            : tool === 'portal'
              ? 'Medir porta'
              : 'Medir vena interlobar';
    this.#captureCard.appendChild(title);
    note(
      this.#captureCard,
      tool === 'caliper'
        ? 'VCI: marca ambas paredes en el mismo cuadro, perpendicular al eje (o flechas e Intro en la imagen); el primer punto congela. Esc cancela.'
        : tool === 'mmode'
          ? `Espacio congela. VCI M: paredes máx./mín. Calibre ${(this.#mPoints.length >> 1) + 1}/2, punto ${(this.#mPoints.length % 2) + 1}/2.`
          : 'Puerta en el vaso: espera 4 latidos estables y pulsa «Capturar». Se mide el espectro adquirido.',
    );
    const r = row(this.#captureCard);
    if (tool !== 'caliper' && tool !== 'mmode') {
      const b = button(r, '', () => this.capture(tool)).el;
      b.classList.add('primary');
      this.#updateCaptureButton(b);
    }
    button(r, 'Cancelar (Esc)', () => this.#ctx.store.set({ tool: 'none' }));
    this.#captureWait = note(this.#captureCard);
    this.#captureWait.setAttribute('role', 'status');
  }

  #updateCaptureButton(b: HTMLButtonElement): void {
    b.textContent = this.#observations ? 'Capturar' : 'Preparando medición…';
    b.disabled = !this.#observations;
    if (this.#loadFailed)
      note(this.#captureCard, 'No se pudo preparar la medición. Revisa la conexión y recarga.').setAttribute('role', 'alert');
  }

  /** Se prepara al armar PW; la captura sigue siendo síncrona sobre el espectro del clic, sin carrera de paciente/equipo. */
  #loadObservations(): void {
    if (this.#observationLoad) return;
    this.#observationLoad = import('../../doppler/capture')
      .then((m) => {
        this.#observations = m;
      })
      .catch((e: unknown) => {
        this.#loadFailed = true;
        errorLog.report('ui', e);
      })
      .finally(() => {
        const tool = this.#ctx.store.get().tool;
        if (tool !== 'hepatic' && tool !== 'portal' && tool !== 'renal') return;
        // Actualizar en sitio: Cancelar puede tener el foco y la herramienta pudo cambiar durante la descarga.
        const b = this.#captureCard.querySelector<HTMLButtonElement>('button.primary');
        if (!b) return;
        this.#updateCaptureButton(b);
      });
  }

  /** Captura la medición armada sobre el espectro adquirido. */
  capture(kind: MeasureTool): void {
    if (!this.#observations || (kind !== 'hepatic' && kind !== 'portal' && kind !== 'renal')) return;
    const { captureProtocolVessel } = this.#observations;
    const sim = this.#ctx.sim();
    const tNow = sim.physiology.clock.t;
    const source = sim.pwChain.readCapture();
    if (source.kind === 'waiting') {
      this.#captureWait.textContent =
        source.reason === 'samples'
          ? 'Adquiere señal nueva antes de capturar. Si está congelada, reanuda el PW.'
          : 'Estabilizando señal nueva. Espera antes de capturar.';
      return;
    }
    const display = { angleCorrectionRad: sim.pw.angleCorrection, invert: sim.pw.invert };
    const opts = { ...source.acquiredEquipment, ...display };
    const cap = <K extends ProtocolVessel>(k: K) => captureProtocolVessel(k, source, sim.physiology.rhythm, tNow, display, sim.gateTrack);
    const m = kind === 'hepatic' ? cap('hepatic') : kind === 'portal' ? cap('portal') : cap('renal');
    // sin un latido completo de señal nueva no hay captura: como la espera, conserva la medición guardada (decisión 292)
    if (!m) {
      this.#captureWait.textContent =
        'Adquiere señal nueva: aún no hay un latido completo. Espera 4 latidos con la puerta quieta; si está congelada, reanuda el PW.';
      return;
    }
    if (m.kind === 'hepatic') this.lastHepatic = m;
    else if (m.kind === 'portal') this.lastPortal = m;
    else this.lastRenal = m;
    this.#stamps[kind] = structuredClone({
      ...acquisitionStamp(sim),
      kind: 'pw',
      revision: source.revision,
      acquiredEquipment: source.acquiredEquipment,
      presentation: display,
    });
    this.#seriesNote = '';
    this.#lastOverlay = captureOverlay(m, opts, source.acquiredEquipment.prfHz, source.revision);
    this.#ctx.store.set({ tool: 'none' });
    this.renderResult();
    this.#ctx.onCapture?.();
  }

  #paint(el: HTMLElement, [html, truth]: readonly [string, string]): void {
    el.innerHTML = this.#shownDebug ? html : html.replace(truth, '');
  }

  renderResult(): void {
    if (!this.#resultEl) return;
    // una captura sin calidad no entra en el grado («no medible» nunca es normal)
    const usable = <T extends { quality: { issue: unknown } }>(m: T | null) => (m && m.quality.issue === null ? m : null);
    const h = usable(this.lastHepatic);
    const p = usable(this.lastPortal);
    const k = usable(this.lastRenal);
    // sin calibrador en la imagen, el diámetro máximo del modo M
    const ivcMax = this.#ivcCaliperMm ?? this.#ivcM?.maxMm ?? null;
    // el contexto marcado entra en el grado: un territorio poco fiable cuenta como no evaluado (decisión 82)
    const veins = {
      ivcMaxDiameterMm: ivcMax,
      hepatic: h ? h.pattern : 'not-assessed',
      portalPulsatilityFraction: p ? p.pulsatilityFraction : null,
    } as const;
    const res: VexusResult = classifyVexusC({ ...veins, renal: k ? k.pattern : 'not-assessed' }, this.#context);
    const literal = classifyVexusC({ ...veins, renal: k ? k.pattern : 'not-assessed' });
    const modified = classifyModifiedVexus(veins, this.#context);
    const excluded = excludedTerritories(res);
    // una línea por territorio, marcada si el contexto la vuelve poco fiable
    const line = (t: Territory, inner: string) => {
      const stamp = this.#stamps[t];
      const previous = stamp?.kind === 'pw' && stamp.revision !== this.#ctx.sim().pwChain.revision;
      return `<div>${inner}${excluded.has(t) ? ' <span class="small unreliable">· no fiable</span>' : ''}${previous ? ' <span class="small">· captura previa</span>' : ''}</div>`;
    };
    const rejected = (m: { quality: MeasurementQuality } | null, name: string) =>
      m && m.quality.issue ? `${name}: <b>${this.#observations!.qualityText(m.quality)}</b>` : null;
    const n = (h ? 1 : 0) + (p ? 1 : 0) + (k ? 1 : 0) + (this.#ivcCaliperMm !== null ? 1 : 0) + (this.#ivcM ? 1 : 0);
    const mM = this.#ivcM;
    const mm = (v: number) => ivcDiameterText(v, ',');
    const beatSummary = p ? portalBeatSummary(p) : '';
    const [hvS, hvD] = h ? hepaticPeaksText(h.sPeak, h.dPeak) : [];
    // la verdad del motor, como las demás, solo con el modo docente (la quita `#paint`)
    const mTruth = mM?.truth
      ? ` <span class="small">(verdad ${mm(mM.truth.maxMm)}/${mm(mM.truth.minMm)} mm → ${mM.truth.ciPct.toFixed(0)} %)</span>`
      : '';
    this.#badge.textContent = String(n);
    this.#badge.hidden = n === 0;
    const lines = [
      `<div class="small">Cálculo literal: VExUS ${gradeValueText(literal)} · ${resultStatusText(literal)}</div>`,
      '<div class="small">Interpretación contextual · adaptación local</div>',
      `<div class="grade">VExUS ${gradeValueText(res)} <span class="small">${resultStatusText(res)}</span></div>`,
      this.#seriesNote ? `<div class="small">${this.#seriesNote}</div>` : '',
      `<div>VCI: ${ivcMax !== null ? ivcDiameterText(ivcMax) + ' mm' : '—'} ${res.ivcDilated === null ? '' : res.ivcDilated ? '<span class="small">(≥ 20 mm: dilatada)</span>' : '<span class="small">(< 20 mm)</span>'}</div>`,
      mM
        ? !mM.respiratoryCycle
          ? '<div>VCI modo M: sin ciclo respiratorio completo. Activa la respiración y adquiere un ciclo completo; reduce el barrido si no cabe. Repite los calibres.</div>'
          : `<div>VCI modo M: máx ${mm(mM.maxMm)} · mín ${mm(mM.minMm)} mm → ${this.#context.positivePressureVentilation ? 'variación respiratoria' : 'colapso'} <b>${mM.ciPct.toFixed(0)} %</b>${mTruth}<div class="small">Resolución: ${mM.pixels.map((v) => v.toFixed(1).replace('.', ',')).join('–')} %; excluye pared y error físico.</div></div>`
        : '',
      line(
        'hepatic',
        rejected(this.lastHepatic, 'VSH') ??
          (h
            ? `VSH: S ${hvS} · D ${hvD} · A ${velocityText(h.aPeak)} cm/s → <b>${patternText(h.pattern)}</b> <span class="small">(${h.beats} latidos)</span>`
            : 'VSH: —'),
      ),
      line(
        'portal',
        rejected(this.lastPortal, 'Porta') ??
          (p
            ? `Porta: ${velocityText(p.vMax)}/${velocityText(p.vMin)} cm/s → PF <b>${portalPulsatilityText(p.pulsatilityFraction, p.pulsatilityLowerBound)}</b> <span class="small">(${portalText(res.portalClass)}${res.portalNearThreshold ? ', próximo al umbral' : ''}${p.pulsatilityLowerBound ? '; el valle cae en el filtro de pared: la PF real es mayor' : ''})${beatSummary ? ` · ${beatSummary}` : ''}. Sentido dominante; confirma la dirección anatómica.</span>`
            : 'Porta: —'),
      ),
      line(
        'renal',
        rejected(this.lastRenal, 'Renal') ??
          (k
            ? `Renal: máx. sist. ${velocityText(k.sPeak)} · diást. ${velocityText(k.dPeak)} · mín ${velocityText(k.vMin)} cm/s → <b>${renalText(k.pattern)}</b> <span class="small">(${k.beats} latidos)</span>`
            : '<span class="small">Renal: no evaluado; el clasificador devuelve el intervalo compatible.</span>'),
      ),
      ...contextResultLines(res, modified),
    ];
    this.#shownDebug = this.#ctx.store.get().debug;
    this.#painted = [lines.join(''), mTruth]; // texto generado por el programa a partir de números
    this.#paint(this.#resultEl, this.#painted);
    // el lector de pantalla oye el grado nuevo al medir o al marcar un confusor, no cada repintado
    const summary = `VExUS ${gradeValueText(res)}, ${resultStatusText(res)}`;
    if (this.#liveEl.textContent !== summary) this.#liveEl.textContent = summary;
    this.#ctx.sync();
  }
}
