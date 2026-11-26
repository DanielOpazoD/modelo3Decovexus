import type { EquipmentCommand } from '../../app/equipment';
import type { Simulator } from '../../app/simulator';
import type { Store } from '../../app/store';
import { cssScale } from '../canvasText';
import { appKey } from '../keyRouting';

/** Punto del haz: ángulo (rad, positivo hacia la izquierda de pantalla) y profundidad desde la cara (mm). */
type Beam = { theta: number; r: number };
/** Sentido en pantalla de cada flecha. */
const ARROWS: Partial<Record<string, [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
/** Color propio del calibrador: el ámbar es la caja de color (#ffd166) y la línea M (#ffc857); el turquesa, la puerta. */
const CALIPER_COLOR = '#a6f05a';

/**
 * Clic para medir; arrastre primario del ratón para colocar Doppler en vivo (caja y puerta juntas en tríplex).
 * La línea M se arrastra desde su asa. Los otros gestos siguen moviendo la sonda. Congelada, la imagen solo mide.
 * Con teclado, sobre `keys` (la imagen enfocable; reparto en `keyRouting.ts`): con el calibrador, las flechas mueven su
 * cruz 1 mm en pantalla e Intro fija cada punto, como el cursor de un ecógrafo; en vivo con PW o Color, llevan la
 * puerta o la caja 0,5° y 1 mm por el haz, como un clic, y ← → la línea M. ⇧ las afina a un quinto.
 */
export function bindImageClick(opts: {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  keys: HTMLElement;
  getSim: () => Simulator;
  store: Store;
  /**
   * El calibre medido; null con `frameChanged`: el primer punto era de otro cuadro y este empieza de nuevo; null solo:
   * el punto pendiente se soltó sin medir.
   */
  setIvcCaliper: (mm: number | null, frameChanged?: boolean) => void;
  dispatch: (cmd: EquipmentCommand) => void;
}): { cancelCaliper: () => void; readonly marks: object; drawMarks: (overlay: HTMLCanvasElement) => void } {
  const { host, canvas, keys, getSim, store, setIvcCaliper, dispatch } = opts;
  /**
   * Calibrador: su primer punto y su cruz, en coordenadas del haz como la puerta: no dependen del tamaño del lienzo ni de
   * la profundidad. Cada cambio es un objeto nuevo: la capa se redibuja.
   */
  let marks: { a: Beam | null; cross: Beam | null } = { a: null, cross: null };
  /** Cuadro mostrado al fijar el primer punto: los dos puntos de un calibre son del mismo. */
  let aFrame: Simulator['renderer']['displayedFrame'] = null;
  let downAt: { x: number; y: number; t: number } | null = null;
  let drag: { id: number; mode: string } | null = null;
  /**
   * Punto del evento en píxeles del lienzo, cada eje con su escala: si el contenedor cambia (aparece la franja M) antes
   * del cuadro siguiente, el lienzo se ve estirado y el punto debe caer sobre la imagen que se ve.
   */
  const at = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    return { px: (e.clientX - rect.left) * dpr, py: ((e.clientY - rect.top) * canvas.height) / rect.height, dpr };
  };
  /** El evento empezó sobre un control (el deslizador del cine): no es un clic ni un arrastre de la imagen. */
  const onControl = (e: Event) => !!(e.target as Element | null)?.closest('#cine-bar, button, input, select');
  const transducer = () => getSim().renderer.displayedFrame?.anatomy.transducer ?? getSim().transducer;
  /** Ángulo de línea del punto, acotado al sector (la línea M se arrastra también fuera de él). */
  const lineTheta = (px: number, py: number) => {
    const s = getSim();
    const d = s.renderer.display;
    const hs = transducer().halfSector;
    return Math.min(hs, Math.max(-hs, -Math.atan2(px - d.apexX, py - d.apexY)));
  };
  /** Píxel del lienzo de un punto del haz, con la presentación de ahora. */
  const pixel = (b: Beam) => getSim().renderer.beamToPixel(b.theta, b.r, transducer());
  /** El punto del haz bajo el píxel, o null fuera del sector que se ve. */
  const beamAt = (px: number, py: number) => getSim().renderer.pixelToBeam(px, py, transducer(), getSim().displayed.bmode.depthMm);
  /** La cruz del calibrador, dentro del sector que se ve (la profundidad pudo bajar): donde quedó o, recién armado, en el centro. */
  const cross = (): Beam => {
    const depth = getSim().displayed.bmode.depthMm;
    const hs = transducer().halfSector;
    const c = marks.cross ?? { theta: 0, r: depth / 2 };
    return { theta: Math.min(hs, Math.max(-hs, c.theta)), r: Math.min(depth, c.r) };
  };
  /**
   * Un punto del calibrador: el primero congela, como la tecla Caliper de un ecógrafo, y se guarda con su cuadro; el
   * segundo, en el mismo cuadro, mide en la escala de ahora y desarma. Si el cuadro cambió (cine, descongelar), pasa a
   * ser el primero. Hasta el segundo, la medida anterior sigue: cancelar la conserva.
   */
  const caliperAt = (b: Beam): void => {
    if (!store.get().frozen) store.set({ frozen: true });
    const frame = getSim().renderer.displayedFrame;
    const a = marks.a;
    const frameChanged = !!a && frame !== aFrame;
    if (!a || frameChanged) {
      marks = { a: b, cross: b };
      aFrame = frame;
      if (frameChanged) setIvcCaliper(null, true);
      return;
    }
    marks = { a: null, cross: null };
    const p = pixel(a),
      q = pixel(b);
    setIvcCaliper(Math.hypot(q.x - p.x, q.y - p.y) / getSim().renderer.display.scale);
    store.set({ tool: 'none' });
  };
  /** En vivo, la puerta PW, la línea M o la caja de color al punto (θ, r) del haz; `coupled`: la caja acompaña a la puerta. */
  const steer = (theta: number, r: number, coupled: boolean): boolean => {
    const sim = getSim();
    if (sim.frozen) return false;
    if (sim.pw.enabled) dispatch({ type: 'placeGate', theta, r, withColorBox: coupled });
    else if (sim.mmode.enabled) dispatch({ type: 'placeMLine', theta });
    else if (sim.color.enabled) dispatch({ type: 'centerColorBox', theta, r });
    return true;
  };
  const place = (e: MouseEvent, coupled = false): boolean => {
    const { px, py } = at(e);
    const beam = beamAt(px, py);
    if (!beam) return false;
    if (!coupled && (store.get().tool === 'caliper' || e.metaKey || e.ctrlKey)) {
      caliperAt(beam);
      return true;
    }
    return steer(beam.theta, beam.r, coupled);
  };
  /** Una tecla sobre la imagen enfocada; true si la atiende. */
  const imageKey = (e: KeyboardEvent): boolean => {
    const s = getSim();
    const d = ARROWS[e.key];
    const k = e.shiftKey ? 0.2 : 1;
    if (store.get().tool === 'caliper') {
      // Intro mantenida sobre la fila que armó el calibrador sigue llegando aquí con el foco: su repetición no fija puntos
      if (!d) {
        if (e.key !== 'Enter' || e.repeat) return false;
        caliperAt(cross());
        return true;
      }
      const c = cross();
      const p = pixel(c);
      const mm = k * s.renderer.display.scale;
      // la cruz no sale del sector
      marks = { ...marks, cross: beamAt(p.x + d[0] * mm, p.y + d[1] * mm) ?? c };
      return true;
    }
    // en vivo, la puerta PW, la caja de color o la línea M, que solo va de lado; congelada, las flechas son del cine
    if (!d || s.frozen || !(s.pw.enabled || s.color.enabled || (s.mmode.enabled && d[0] !== 0))) return false;
    const { pw, mmode, color: c } = s;
    const [theta, r] = pw.enabled
      ? [pw.theta, pw.depthMm]
      : mmode.enabled
        ? [mmode.theta, 0]
        : [(c.theta0 + c.theta1) / 2, (c.r0 + c.r1) / 2];
    // θ crece hacia la izquierda de la pantalla; el equipo acota al sector y a la profundidad
    return steer(theta - (d[0] * k * Math.PI) / 360, r + d[1] * k, false);
  };
  keys.addEventListener('keydown', (e) => {
    if (!appKey(e) || !imageKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
  });
  // Capturar antes que ProbeInput: el arrastre del control nunca traslada la sonda.
  host.addEventListener(
    'pointerdown',
    (e) => {
      const s = getSim();
      if (s.frozen || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || onControl(e) || store.get().tool !== 'none') return;
      if (s.mmode.enabled) {
        const { px, py, dpr } = at(e);
        const tr = transducer();
        const a = s.renderer.beamToPixel(s.mmode.theta, 0, tr);
        const b = s.renderer.beamToPixel(s.mmode.theta, s.displayed.bmode.depthMm, tr);
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const L2 = dx ** 2 + dy ** 2 || 1;
        const u = Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / L2));
        if (Math.hypot(px - a.x - u * dx, py - a.y - u * dy) > 10 * dpr) return;
      } else if (e.pointerType !== 'mouse' || !(s.pw.enabled || s.color.enabled) || !place(e, true)) return;
      e.stopPropagation();
      host.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, mode: store.get().mode };
      downAt = null;
    },
    { capture: true },
  );
  host.addEventListener('pointermove', (e) => {
    if (drag?.id !== e.pointerId) return;
    if (getSim().frozen || store.get().tool !== 'none' || store.get().mode !== drag.mode) {
      drag = null;
      return;
    }
    if (drag.mode === 'M') {
      const { px, py } = at(e);
      dispatch({ type: 'placeMLine', theta: lineTheta(px, py) });
    } else place(e, true);
  });
  const endDrag = (e: PointerEvent) => {
    if (drag?.id === e.pointerId) drag = null;
  };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) host.addEventListener(event, endDrag);
  host.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY, t: performance.now() }));
  host.addEventListener('click', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4 || performance.now() - downAt.t > 400 || onControl(e)) return;
    place(e);
  });
  const cancelCaliper = () => {
    if (marks.a) setIvcCaliper(null);
    marks = { a: null, cross: null };
  };
  // cualquier cambio de herramienta suelta el punto pendiente, también armar el calibrador tras un ⌘/Ctrl+clic
  store.subscribe((st, prev) => {
    if (st.tool !== prev.tool) cancelCaliper();
  });
  return {
    /** Suelta el punto pendiente aunque la herramienta no cambie (Esc tras ⌘/Ctrl+clic, otra ventana, «Borrar»). */
    cancelCaliper,
    get marks() {
      return marks;
    },
    /**
     * Con el calibrador armado, su cruz y, desde el primer punto, el segmento que mide; sin armar, la cruz sobre el punto
     * pendiente de ⌘/Ctrl+clic. Un primer punto de otro cuadro no se une con la cruz ni se ve.
     */
    drawMarks: (overlay) => {
      const first = marks.a && aFrame === getSim().renderer.displayedFrame ? marks.a : null;
      const ctx = (store.get().tool === 'caliper' || first) && overlay.getContext('2d');
      if (!ctx) return;
      const c = pixel(cross());
      const a = first ? pixel(first) : c;
      // brazos en px CSS; el grosor, no (decisión 423)
      const arm = 12 * cssScale(overlay);
      ctx.strokeStyle = CALIPER_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
      ctx.moveTo(c.x - arm, c.y);
      ctx.lineTo(c.x + arm, c.y);
      ctx.moveTo(c.x, c.y - arm);
      ctx.lineTo(c.x, c.y + arm);
      ctx.stroke();
    },
  };
}
