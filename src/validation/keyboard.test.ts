import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EquipmentCommand } from '../app/equipment';
import type { Simulator } from '../app/simulator';
import { Store, type AppState } from '../app/store';
import { defaultPose, type ProbePose, type Transducer } from '../probe/probe';
import { beamToPixel, pixelToBeam, sectorLayout } from '../ultrasound/sectorGeometry';

/**
 * Reparto del teclado (objetivo 6) sin DOM: qué tecla atiende quién entre la imagen enfocada, la sonda, el cine y los
 * atajos. Los oyentes son los de la app; `window` y la imagen son registros de oyentes con eventos planos.
 */
afterEach(() => vi.unstubAllGlobals());

interface KeyInit {
  key: string;
  target?: object | null;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** Repetición automática de una tecla mantenida. */
  repeat?: boolean;
  /** AltGr: en Windows llega como Ctrl+Alt. */
  altGraph?: boolean;
  /** Eventos del ratón sobre la imagen. */
  clientX?: number;
  clientY?: number;
  button?: number;
}

function keyEvent(init: KeyInit) {
  return {
    target: null,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...init,
    getModifierState: (k: string) => k === 'AltGraph' && !!init.altGraph,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

/** Registro de oyentes con el que se sustituye `window` o se finge un elemento. */
function listeners() {
  const on = new Map<string, Array<(e: unknown) => void>>();
  return {
    target: {
      addEventListener: (type: string, fn: (e: unknown) => void) => on.set(type, [...(on.get(type) ?? []), fn]),
      removeEventListener: () => undefined,
      setPointerCapture: () => undefined,
    },
    fire: (type: string, init: KeyInit) => {
      const e = keyEvent(init);
      for (const fn of on.get(type) ?? []) fn(e);
      return e;
    },
  };
}

const initial = (patch: Partial<AppState> = {}): AppState => ({
  mode: 'B',
  tab: 'adquirir',
  frozen: false,
  debug: false,
  audio: false,
  caseId: 'normal-adult',
  torso: true,
  tool: 'none',
  ...patch,
});

describe('Reparto del teclado', () => {
  it('appKey: nada desde un campo de formulario ni con Ctrl/⌘; AltGr sí; un deslizador conserva flechas, Inicio y Fin', async () => {
    const { appKey } = await import('../ui/keyRouting');
    const ok = (init: KeyInit) => appKey(keyEvent(init) as unknown as KeyboardEvent);
    const range = { tagName: 'INPUT', type: 'range' };
    expect(ok({ key: 'w' })).toBe(true);
    expect(ok({ key: ' ', target: { tagName: 'BUTTON' } })).toBe(true);
    expect(ok({ key: ' ', target: range })).toBe(true);
    for (const key of ['ArrowLeft', 'Home', 'End']) expect(ok({ key, target: range })).toBe(false);
    for (const tagName of ['TEXTAREA', 'SELECT']) expect(ok({ key: 'ArrowLeft', target: { tagName } })).toBe(false);
    expect(ok({ key: ' ', target: { tagName: 'INPUT', type: 'checkbox' } })).toBe(false);
    expect(ok({ key: '=', metaKey: true })).toBe(false);
    expect(ok({ key: '+', ctrlKey: true })).toBe(false);
    expect(ok({ key: '[', ctrlKey: true, altKey: true, altGraph: true })).toBe(true);
  });

  it('los atajos no se disparan con el zoom, copiar o imprimir del navegador (Ctrl/⌘), y sí con AltGr', async () => {
    const win = listeners();
    vi.stubGlobal('window', win.target);
    const { bindKeyboardShortcuts } = await import('../ui/keyboardShortcuts');
    const store = new Store(initial());
    const cmds: EquipmentCommand[] = [];
    bindKeyboardShortcuts(store, (c) => cmds.push(c));
    for (const k of [
      { key: '=', metaKey: true },
      { key: '+', ctrlKey: true },
      { key: '-', ctrlKey: true },
      { key: 'c', metaKey: true },
      { key: 'p', ctrlKey: true },
      { key: 'm', metaKey: true },
    ])
      win.fire('keydown', k);
    expect(cmds).toEqual([]);
    expect(store.get()).toMatchObject({ mode: 'B', frozen: false });
    win.fire('keydown', { key: '[', ctrlKey: true, altKey: true, altGraph: true });
    win.fire('keydown', { key: '=' });
    win.fire('keydown', { key: 'c' });
    win.fire('keydown', { key: ' ' });
    expect(cmds).toEqual([
      { type: 'stepDepth', deltaMm: -10 },
      { type: 'stepGain', deltaDb: 2 },
    ]);
    expect(store.get()).toMatchObject({ mode: 'color', frozen: true });
  });

  it('la sonda no hereda teclas pulsadas con ⌘ (macOS no envía su keyup) ni se mueve desde un campo de texto', async () => {
    const win = listeners();
    vi.stubGlobal('window', win.target);
    const { ProbeInput } = await import('../ui/probeInput');
    const start = defaultPose();
    let pose = start;
    const poses: ProbePose[] = [];
    const input = new ProbeInput(
      listeners().target as unknown as HTMLElement,
      () => pose,
      (p) => poses.push((pose = p)),
    );
    win.fire('keydown', { key: 'a', metaKey: true }); // ⌘A, seleccionar todo
    input.tick(1);
    win.fire('keydown', { key: 'a' });
    win.fire('keydown', { key: 'Meta', metaKey: true });
    win.fire('keyup', { key: 'Meta' }); // el keyup de la «a» no llega
    input.tick(1);
    const inText = win.fire('keydown', { key: 'ArrowLeft', shiftKey: true, target: { tagName: 'TEXTAREA' } });
    input.tick(1);
    expect(inText.preventDefault).not.toHaveBeenCalled();
    expect(poses).toEqual([]);
    win.fire('keydown', { key: 'a' });
    input.tick(1);
    expect(poses[0].phi - start.phi).toBeCloseTo(0.32, 9);
    // soltar ⌘ con ⇧ aún pulsada (no se repite) conserva el modo fino
    win.fire('keyup', { key: 'a' });
    win.fire('keydown', { key: 'Shift', shiftKey: true });
    win.fire('keyup', { key: 'Meta', shiftKey: true });
    win.fire('keydown', { key: 'A', shiftKey: true });
    input.tick(1);
    expect(poses[1].phi - poses[0].phi).toBeCloseTo(0.32 * 0.3, 9);
  });
});

describe('Cruz de teclado sobre la imagen', () => {
  const tr = { curvatureRadius: 50, halfSector: 0.6 } as Transducer;

  async function mount(patch: Partial<AppState>, on: { pw?: boolean; mmode?: boolean } = {}) {
    const { bindImageClick } = await import('../ui/controllers/imageClick');
    const renderer = {
      display: sectorLayout(1000, 800, tr, 180, 12),
      /** El cuadro en pantalla: otro objeto al recorrer el cine o en vivo. */
      displayedFrame: null as object | null,
      beamToPixel: (theta: number, r: number) => beamToPixel(renderer.display, tr, theta, r),
      pixelToBeam: (px: number, py: number, _tr: Transducer, depth: number) => pixelToBeam(renderer.display, tr, depth, px, py),
    };
    const sim = {
      frozen: patch.frozen ?? false,
      transducer: tr,
      pw: { enabled: !!on.pw, theta: 0, depthMm: 90 },
      mmode: { enabled: !!on.mmode, theta: 0 },
      color: { enabled: false },
      displayed: { bmode: { depthMm: 180 } },
      renderer,
    };
    /** El lienzo o la profundidad cambian, como al redimensionar o con [ ]: la presentación se rehace. */
    const show = (width: number, height: number, depthMm: number) => {
      renderer.display = sectorLayout(width, height, tr, depthMm, 12);
      sim.displayed.bmode.depthMm = depthMm;
    };
    const store = new Store(initial(patch));
    const image = listeners();
    const host = listeners();
    const calipers: Array<number | null> = [];
    /** Segundos puntos que volvieron a empezar porque el cuadro cambió. */
    const restarts: number[] = [];
    /** Puntos pendientes soltados sin medir: la pestaña retira el aviso que los daba por primeros. */
    let released = 0;
    const cmds: EquipmentCommand[] = [];
    const canvas = { width: 1000, height: 800, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }) };
    const click = bindImageClick({
      host: host.target as unknown as HTMLElement,
      canvas: canvas as unknown as HTMLCanvasElement,
      keys: image.target as unknown as HTMLElement,
      getSim: () => sim as unknown as Simulator,
      store,
      setIvcCaliper: (mm, frameChanged) => {
        if (mm === null && !frameChanged) return void released++;
        if (frameChanged) restarts.push(calipers.length);
        calipers.push(mm);
      },
      dispatch: (c) => cmds.push(c),
    });
    return {
      click,
      store,
      calipers,
      restarts,
      released: () => released,
      renderer,
      cmds,
      show,
      display: () => renderer.display,
      press: (key: string, init: Partial<KeyInit> = {}) => image.fire('keydown', { key, ...init }),
      /** Clic del ratón en el eje de la imagen a `r` mm de la cara (con ⌘ o Ctrl, el calibrador sin armar la fila). */
      clickAt: (r: number, init: Partial<KeyInit> = {}) => {
        const p = beamToPixel(renderer.display, tr, 0, r);
        for (const type of ['pointerdown', 'click']) host.fire(type, { key: '', clientX: p.x, clientY: p.y, button: 0, ...init });
      },
    };
  }

  it('con el calibrador (congelada): las flechas mueven la cruz 1 mm (⇧ 0,2) e Intro fija cada punto; no siguen', async () => {
    const { click, store, calipers, press } = await mount({ tool: 'caliper', frozen: true });
    const before = click.marks;
    const handled = [press('Enter'), ...Array.from({ length: 10 }, () => press('ArrowDown')), press('Enter')];
    for (const e of handled) {
      expect(e.preventDefault).toHaveBeenCalled();
      expect(e.stopPropagation).toHaveBeenCalled();
    }
    expect(click.marks).not.toBe(before); // la cruz se vuelve a dibujar
    // el primer punto no toca la medida guardada: solo el segundo da una nueva
    expect(calipers).toHaveLength(1);
    expect(calipers[0]).toBeCloseTo(10, 9);
    expect(store.get().tool).toBe('none');
    store.set({ tool: 'caliper' });
    press('Enter');
    for (let i = 0; i < 5; i++) press('ArrowRight', { shiftKey: true });
    press('Enter');
    expect(calipers[1]).toBeCloseTo(1, 9);
    // Espacio congela, Inicio y Fin son del cine y ⌘← es «atrás» del navegador: no son de la cruz
    store.set({ tool: 'caliper' });
    for (const e of [press(' '), press('Home'), press('ArrowLeft', { metaKey: true })]) expect(e.stopPropagation).not.toHaveBeenCalled();
  });

  it('Intro mantenida no fija puntos: su repetición llega a la imagen tras armar la fila; las flechas sí se repiten', async () => {
    const { store, calipers, press } = await mount({ tool: 'caliper', frozen: true });
    // la primera pulsación activó «VCI diámetro» y pasó el foco aquí: sin esto, A, B a 0 mm y vuelta a armar
    for (const e of [press('Enter', { repeat: true }), press('Enter', { repeat: true })]) expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(calipers).toEqual([]);
    expect(store.get().tool).toBe('caliper');
    press('Enter');
    for (let i = 0; i < 10; i++) press('ArrowDown', { repeat: i > 0 });
    press('Enter', { repeat: true });
    expect(calipers).toEqual([]);
    press('Enter');
    expect(calipers[0]).toBeCloseTo(10, 9);
  });

  it('la medida no mezcla escalas si el lienzo o la profundidad cambian entre los puntos, y la cruz no sale del sector', async () => {
    const { store, calipers, press, show } = await mount({ tool: 'caliper', frozen: true });
    press('Enter'); // A en el centro: θ = 0, r = 90 mm
    for (let i = 0; i < 10; i++) press('ArrowDown');
    show(500, 400, 180); // el lienzo a la mitad antes del segundo punto
    press('Enter');
    expect(calipers[0]).toBeCloseTo(10, 9);
    store.set({ tool: 'caliper' });
    press('Enter');
    for (let i = 0; i < 80; i++) press('ArrowDown'); // r = 170 mm
    show(500, 400, 100); // la profundidad baja con la cruz más abajo: queda en el borde del sector que se ve
    press('Enter');
    expect(calipers[1]).toBeCloseTo(10, 9);
  });

  it('un calibre es de un solo cuadro: el primer punto congela; si el cuadro cambia antes del segundo, vuelve a empezar y lo dice', async () => {
    const { click, store, calipers, restarts, renderer, press } = await mount({ tool: 'caliper' });
    renderer.displayedFrame = { n: 1, anatomy: { transducer: tr } };
    press('Enter'); // A en vivo: congela sobre el cuadro que se ve
    expect(store.get().frozen).toBe(true);
    for (let i = 0; i < 10; i++) press('ArrowDown');
    renderer.displayedFrame = { n: 2, anatomy: { transducer: tr } }; // recorrer el cine (o descongelar) entre los dos puntos
    // la cruz no se une con un punto de otro cuadro
    const path: number[][] = [];
    const to = (x: number, y: number) => path.push([x, y]);
    const ctx = { beginPath: () => (path.length = 0), moveTo: to, lineTo: to, stroke: () => {} };
    click.drawMarks({ getContext: () => ctx } as unknown as HTMLCanvasElement);
    // el segmento empieza en la cruz (θ = 0, r = 100 mm), no en el primer punto (r = 90 mm)
    const c = beamToPixel(renderer.display, tr, 0, 100);
    expect(path[0][0]).toBeCloseTo(c.x, 9);
    expect(path[0][1]).toBeCloseTo(c.y, 9);
    press('Enter'); // B en otro cuadro: no mide, pasa a ser el primer punto y se avisa
    expect(calipers).toEqual([null]);
    expect(restarts).toEqual([0]);
    expect(store.get().tool).toBe('caliper');
    for (let i = 0; i < 8; i++) press('ArrowUp');
    press('Enter'); // las dos paredes en el mismo cuadro
    expect(calipers[1]).toBeCloseTo(8, 9);
    expect(restarts).toEqual([0]);
    expect(store.get().tool).toBe('none');
  });

  it('cancelar no deja un punto pendiente: ni al volver a armar la fila ni con Esc tras ⌘/Ctrl+clic', async () => {
    const win = listeners();
    vi.stubGlobal('window', win.target);
    const { bindKeyboardShortcuts } = await import('../ui/keyboardShortcuts');
    const { click, store, calipers, released, clickAt } = await mount({ frozen: true });
    bindKeyboardShortcuts(store, () => {}, click.cancelCaliper);
    const measured = () => calipers.filter((mm) => mm !== null);
    // control: con la fila armada, dos clics miden y desarman
    store.set({ tool: 'caliper' });
    clickAt(60);
    clickAt(82.4);
    expect(measured()).toHaveLength(1);
    expect(measured()[0]).toBeCloseTo(22.4, 9);
    expect(store.get().tool).toBe('none');
    // un primer punto y «Cancelar (Esc)»: armar otra vez empieza de cero (antes lo hacía un oyente de bootstrap; ahora,
    // el propio calibrador)
    store.set({ tool: 'caliper' });
    clickAt(60);
    store.set({ tool: 'none' });
    store.set({ tool: 'caliper' });
    clickAt(95);
    expect(measured()).toHaveLength(1);
    expect(store.get().tool).toBe('caliper');
    win.fire('keydown', { key: 'Escape' });
    // la regresión: ⌘ o Ctrl+clic sin la fila armada deja un punto que armar «VCI diámetro» no soltaba
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      clickAt(60, mod);
      store.set({ tool: 'caliper' });
      clickAt(95);
      expect(measured()).toHaveLength(1);
      expect(store.get().tool).toBe('caliper');
      win.fire('keydown', { key: 'Escape' });
    }
    // y con la herramienta ya en «ninguna», Esc no cambia el estado: ahora también lo suelta, y la pestaña lo sabe
    const before = released();
    clickAt(60, { metaKey: true });
    win.fire('keydown', { key: 'Escape' });
    expect(released()).toBe(before + 1);
    clickAt(95, { metaKey: true });
    expect(measured()).toHaveLength(1);
    clickAt(80, { metaKey: true });
    expect(measured()[1]).toBeCloseTo(15, 9);
    // ningún primer punto llegó a la pestaña: la medida anterior sigue hasta que otra la sustituye
    expect(calipers).not.toContain(null);
  });

  /** La capa #overlay con un mapa de bits de k píxeles por píxel CSS, como la deja `fitCanvases` con DPR k; registra los trazos. */
  function overlay(k = 1) {
    let path: number[][] = [];
    const strokes: Array<{ color: string; width: number; path: number[][] }> = [];
    const ctx = {
      strokeStyle: '',
      lineWidth: 0,
      beginPath: () => (path = []),
      moveTo: (x: number, y: number) => path.push([x, y]),
      lineTo: (x: number, y: number) => path.push([x, y]),
      stroke: () => strokes.push({ color: ctx.strokeStyle, width: ctx.lineWidth, path }),
    };
    const canvas = { width: 1000 * k, height: 800 * k, clientWidth: 1000, clientHeight: 800, getContext: () => ctx };
    return { canvas: canvas as unknown as HTMLCanvasElement, strokes };
  }
  /** Los extremos de los brazos de una cruz centrada en `c`. */
  const arms = (c: { x: number; y: number }, arm: number) => [
    [c.x - arm, c.y],
    [c.x + arm, c.y],
    [c.x, c.y - arm],
    [c.x, c.y + arm],
  ];

  it('la cruz recién armada se dibuja en el centro de la imagen con su propio color y brazos de 12 px CSS (decisión 423)', async () => {
    const { click, display, show } = await mount({ tool: 'caliper', frozen: true });
    const dpr1 = overlay();
    click.drawMarks(dpr1.canvas);
    expect(dpr1.strokes).toHaveLength(1);
    expect(dpr1.strokes[0].path).toEqual(expect.arrayContaining(arms(beamToPixel(display(), tr, 0, 90), 12)));
    // la caja de color (y la e2e que la reconoce por él) es ámbar #ffd166; la línea M, #ffc857; la puerta, #7ff0d8
    expect(['#ffd166', '#ffc857', '#7ff0d8']).not.toContain(dpr1.strokes[0].color);
    // a DPR 2 la cruz es la de DPR 1 al doble en el mapa de bits; el grosor no se escala
    show(2000, 1600, 180);
    const dpr2 = overlay(2);
    click.drawMarks(dpr2.canvas);
    expect(dpr2.strokes[0].path).toEqual(expect.arrayContaining(arms(beamToPixel(display(), tr, 0, 90), 24)));
    expect(dpr2.strokes[0].width).toBe(dpr1.strokes[0].width);
  });

  it('el primer punto de ⌘/Ctrl+clic se ve hasta el segundo, solo sobre su cuadro', async () => {
    const { click, renderer, display, clickAt } = await mount({ frozen: true });
    const drawn = () => {
      const o = overlay();
      click.drawMarks(o.canvas);
      return o.strokes;
    };
    expect(drawn()).toEqual([]);
    clickAt(60, { metaKey: true });
    const strokes = drawn();
    expect(strokes).toHaveLength(1);
    expect(strokes[0].path).toEqual(expect.arrayContaining(arms(beamToPixel(display(), tr, 0, 60), 12)));
    // en otro cuadro del cine el punto no se ve: el siguiente clic vuelve a ser el primero
    renderer.displayedFrame = { n: 2, anatomy: { transducer: tr } };
    expect(drawn()).toEqual([]);
    renderer.displayedFrame = null;
    clickAt(80, { metaKey: true });
    expect(drawn()).toEqual([]);
  });

  it('en vivo con el modo M: ← → llevan la línea; ↑ ↓ no la mueven y siguen siendo de la sonda', async () => {
    const m = await mount({ mode: 'M' }, { mmode: true });
    for (const key of ['ArrowUp', 'ArrowDown']) expect(m.press(key).stopPropagation).not.toHaveBeenCalled();
    m.press('ArrowRight', { shiftKey: true });
    expect(m.cmds).toHaveLength(1);
    expect(m.cmds[0].type).toBe('placeMLine');
    expect((m.cmds[0] as { theta: number }).theta).toBeCloseTo(-Math.PI / 1800, 12);
  });

  it('en vivo con PW: las flechas llevan la puerta 0,5° y 1 mm (⇧ un quinto); congelada o en 2D son de la sonda y del cine', async () => {
    const live = await mount({ mode: 'pw' }, { pw: true });
    live.press('ArrowLeft');
    live.press('ArrowDown', { shiftKey: true });
    const round = (c: EquipmentCommand) => (c.type === 'placeGate' ? { ...c, theta: +c.theta.toFixed(12), r: +c.r.toFixed(12) } : c);
    expect(live.cmds.map(round)).toEqual([
      { type: 'placeGate', theta: +(Math.PI / 360).toFixed(12), r: 90, withColorBox: false },
      { type: 'placeGate', theta: 0, r: 90.2, withColorBox: false },
    ]);
    const frozen = await mount({ mode: 'pw', frozen: true }, { pw: true });
    const bMode = await mount({});
    for (const m of [frozen, bMode]) {
      expect(m.press('ArrowLeft').stopPropagation).not.toHaveBeenCalled();
      expect(m.press('Enter').stopPropagation).not.toHaveBeenCalled();
      expect(m.cmds).toEqual([]);
    }
  });
});
