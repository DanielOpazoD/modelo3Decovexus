import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultEquipment, type Simulator } from '../app/simulator';
import type { SpectralColumn } from '../doppler/spectral';
import type { CaptureOverlay } from '../ui/captureOverlay';
import { SpectrogramView, drawEcg, drawOverlay } from '../ui/displays';
import { MModeView } from '../ui/mModeView';
import { drawVelocityRuler } from '../ui/velocityRuler';
import { CONVEX_C35 } from '../probe/probe';
import { DISPLAY_MARGIN_PX, type UltrasoundRenderer } from '../ultrasound/renderer';
import { beamToPixel, sectorLayout } from '../ultrasound/sectorGeometry';

/**
 * Lienzo de cw × ch px CSS con mapa de bits a `dpr` (como `fitCanvases`); registra cada texto (su letra en px CSS, su
 * posición y su extremo derecho) y cada longitud de trazo (vértices, radios, rayas y rectángulos de contorno).
 */
function canvas(cw: number, ch: number, dpr: number) {
  const texts: { text: string; css: number; x: number; right: number; y: number; W: number }[] = [];
  const shapes: number[][] = [];
  const state: Record<string | symbol, unknown> = { font: '10px sans-serif', textAlign: 'start' };
  const stack: number[] = [];
  let scale = 1;
  const px = () => Number(/([\d.]+)px/.exec(String(state.font))![1]);
  // Ancho holgado (0,6 em por carácter): si cabe aquí, cabe con la letra real.
  const width = (s: string) => 0.6 * px() * s.length;
  const shape = (...v: number[]) => shapes.push(v.map((n) => n * scale));
  const methods: Record<string, unknown> = {
    save: () => stack.push(scale),
    restore: () => (scale = stack.pop() ?? 1),
    scale: (s: number) => (scale *= s),
    measureText: (s: string) => ({ width: width(s) }),
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    moveTo: shape,
    lineTo: shape,
    arc: (x: number, y: number, r: number) => shape(x, y, r),
    strokeRect: shape,
    setLineDash: (dash: number[]) => shape(...dash),
  };
  const record = (s: string, x: number, y: number) => {
    const right = (x + (state.textAlign === 'right' ? 0 : width(s))) * scale;
    texts.push({ text: s, css: (px() * scale) / dpr, x: x * scale, right, y: y * scale, W: cw * dpr });
  };
  methods.fillText = methods.strokeText = record;
  const element = { width: cw * dpr, height: ch * dpr, clientWidth: cw, clientHeight: ch, getAttribute: () => null, setAttribute() {} };
  const ctx = new Proxy(state, {
    get: (t, key) => (key === 'canvas' ? element : key in methods ? methods[key as string] : key in t ? t[key] : () => undefined),
    set: (t, key, value) => Reflect.set(t, key, value),
  });
  Object.assign(element, { getContext: () => ctx });
  return { element: element as unknown as HTMLCanvasElement, texts, shapes };
}

const deg = Math.PI / 180;

function scene(dpr: number) {
  vi.stubGlobal('document', { createElement: () => canvas(10, 10, 1).element });
  const pw = { ...defaultEquipment().pw, enabled: true, prfHz: 2000, angleCorrection: 60 * deg, invert: true };
  const sim = {
    pw,
    pwChain: { revision: 0 },
    spectral: { fftSize: 128, hop: 16 },
    pwNyquistCms: () => pw.prfHz * 0.0154,
    physiology: { samples: [] },
    transducer: { halfSector: 0.6, f0Doppler: 2.5e6 },
    renderer: { displayedFrame: null, beamToPixel: (th: number, r: number) => ({ x: (400 + 300 * th) * dpr, y: (20 + 3 * r) * dpr }) },
    displayed: { bmode: { depthMm: 160, focusMm: 60 }, color: { enabled: true, prfHz: 2500, invert: false } },
    color: { enabled: true, theta0: -0.2, theta1: 0.2, r0: 40, r1: 90 },
    mmode: { enabled: true, theta: 0.1 },
    frozen: false,
  } as unknown as Simulator;
  const columns: SpectralColumn[] = [0.8, 0.9].map((t) => ({ t, prfHz: 2000, powerDb: new Float32Array(128).fill(-30) }));
  const capture: CaptureOverlay = {
    revision: 0,
    accepted: true,
    prfHz: 2000,
    trace: [
      { t: 0.8, fHz: 200 },
      { t: 0.9, fHz: 250 },
    ],
    // «S» junto al borde de arriba (rótulo debajo del punto) y «A» junto al derecho (rótulo a su izquierda)
    marks: [
      { t: 0.8, fHz: 990, label: 'S' },
      { t: 0.85, fHz: 300, label: 'D' },
      { t: 0.9, fHz: -200, label: 'A' },
    ],
    beats: [[0.8, 0.9]],
  };
  return { sim, pw, columns, capture };
}

/** Todos los lienzos de la consola (cursor del cine y calibres M incluidos), con las trazas de `width` px CSS a `dpr`. */
function drawAll(dpr: number, width = 900) {
  const s = scene(dpr);
  const overlay = canvas(800, 600, dpr);
  drawOverlay(overlay.element, s.sim);
  const ecg = canvas(width, 40, dpr);
  drawEcg(ecg.element, s.sim, 3, 1, 0.85);
  const spectrum = canvas(width, 160, dpr);
  new SpectrogramView(spectrum.element).draw(s.sim, s.columns, 1, 3, 0.85, s.capture);
  const empty = canvas(width, 160, dpr);
  new SpectrogramView(empty.element).draw(s.sim, [], 1, 3);
  const mmode = canvas(width, 176, dpr);
  const r = { mStrip: { depthMm: 160, version: 1 }, canvas: { width: 10, height: 10 }, drawMStrip() {}, represent() {} };
  const calipers = [
    { t: 0.8, r: 40 },
    { t: 0.8, r: 90 },
  ];
  new MModeView(mmode.element).draw(r as unknown as UltrasoundRenderer, 1, 3, 0.85, calipers);
  const ruler = canvas(52, 160, dpr);
  drawVelocityRuler(ruler.element, 31, 0, false);
  s.pw.enabled = false;
  const off = canvas(width, 160, dpr);
  new SpectrogramView(off.element).draw(s.sim, [], 1, 3);
  const canvases = { overlay, ecg, spectrum, empty, mmode, ruler, off };
  const all = Object.values(canvases).flatMap((c) => c.texts);
  return { all, spectrum: spectrum.texts, canvases };
}

/** #overlay de cw × ch px CSS con la geometría real del convexo (`sectorLayout` del renderizador) y la regla a `depthMm`. */
function realOverlay(cw: number, ch: number, dpr: number, depthMm: number) {
  const c = canvas(cw, ch, dpr);
  const layout = sectorLayout(cw * dpr, ch * dpr, CONVEX_C35, depthMm, DISPLAY_MARGIN_PX);
  const sim = {
    transducer: CONVEX_C35,
    renderer: { displayedFrame: null, beamToPixel: (th: number, r: number) => beamToPixel(layout, CONVEX_C35, th, r) },
    displayed: { bmode: { depthMm, focusMm: 80 }, color: { enabled: false } },
    color: { enabled: false },
    mmode: { enabled: false },
    pw: { enabled: false },
    frozen: false,
  } as unknown as Simulator;
  drawOverlay(c.element, sim);
  return c.texts;
}

afterEach(() => vi.unstubAllGlobals());

describe('texto de los lienzos en píxeles CSS (misión, objetivo 6)', () => {
  for (const dpr of [1, 2])
    it(`ningún rótulo baja de 12 px CSS a DPR ${dpr}`, () => {
      const { all } = drawAll(dpr);
      expect(all.map((t) => t.text)).toEqual(
        expect.arrayContaining(['5', '10', 'cm/s', 'ECG · resp', 'S', 'D', 'A', 'Sin adquisición nueva', '5 cm —', '0 cm/s']),
      );
      for (const t of all) {
        expect(t.css, t.text).toBeGreaterThanOrEqual(12);
        expect(t.right, t.text).toBeLessThanOrEqual(t.W);
      }
    });

  it('el pie del espectro cabe en una línea en escritorio y se parte en un móvil sin perder θ ni INV', () => {
    const wide = drawAll(2).spectrum.filter((t) => t.text.startsWith('Nyquist'));
    expect(wide.map((t) => t.text)).toEqual(['Nyquist ±31 cm/s · PRF 2000 Hz · WF 25 Hz · 50 mm/s · θ 60° · INV']);
    for (const width of [320, 260]) {
      const { all, spectrum } = drawAll(2, width);
      const lines = spectrum.filter((t) => /Nyquist|PRF|WF|mm\/s|θ/.test(t.text));
      expect(lines.length, `${width} px`).toBeGreaterThan(1);
      // las partes no se reordenan ni se pierden: de arriba abajo, apoyadas en el borde inferior
      expect(lines.map((t) => t.text).join(' · ')).toBe(wide[0].text);
      expect(lines.map((t) => t.y)).toEqual([...lines.map((t) => t.y)].sort((a, b) => a - b));
      expect(lines.at(-1)!.y).toBe(wide[0].y);
      // también el aviso de PW apagado: ningún texto se sale del lienzo
      for (const t of all) expect(t.right, `${width} px: ${t.text}`).toBeLessThanOrEqual(t.W);
    }
  });

  it('el aviso de PW apagado se parte por palabras sin dejar «—» al principio de una línea', () => {
    const text = 'Doppler pulsado desactivado — pulse PW y coloque la puerta en un vaso';
    for (let width = 200; width <= 440; width += 4) {
      const s = scene(2);
      s.pw.enabled = false;
      const off = canvas(width, 160, 2);
      new SpectrogramView(off.element).draw(s.sim, [], 1, 3);
      expect(off.texts.map((t) => t.text).join(' ')).toBe(text);
      for (const t of off.texts) {
        expect(t.text.startsWith('—'), `${width} px: «${t.text}»`).toBe(false);
        expect(t.right, `${width} px: ${t.text}`).toBeLessThanOrEqual(t.W);
      }
    }
  });

  it('las cifras de la regla del sector no se salen de #overlay con la geometría real (sector limitado por el ancho)', () => {
    // modo B a 1600 × 1000 (sector de 1032 × 871 px CSS) y un móvil de 390 px; 150 y 200 mm caen en la esquina del sector
    for (const [cw, ch] of [
      [1032, 871],
      [390, 400],
    ])
      for (const dpr of [1, 2])
        for (const depthMm of [150, 155, 160, 180, 200, 210]) {
          const texts = realOverlay(cw, ch, dpr, depthMm);
          const where = `${cw}×${ch} px CSS, DPR ${dpr}, ${depthMm} mm`;
          const labels = texts.map((t) => t.text);
          expect(labels, where).toEqual(['0', '5', '10', '15', '20'].filter((cm) => +cm * 10 <= depthMm));
          for (const t of texts) {
            expect(t.css, `${where}: ${t.text}`).toBeGreaterThanOrEqual(12);
            expect(t.right, `${where}: ${t.text}`).toBeLessThanOrEqual(t.W);
          }
        }
  });

  it('a DPR 2 cada lienzo es el de DPR 1 al doble: texto, marcas, puerta, cursor y calibres en px CSS', () => {
    const one = drawAll(1).canvases;
    const two = drawAll(2).canvases;
    for (const [name, a] of Object.entries(one)) {
      const b = two[name as keyof typeof two];
      const sizes = (c: typeof a) => c.texts.map((t) => [t.text, t.css]);
      expect(sizes(b), name).toEqual(sizes(a));
      a.texts.forEach((t, i) => {
        expect(Math.abs(b.texts[i].x / 2 - t.x), `${name}: x de «${t.text}»`).toBeLessThanOrEqual(1);
        expect(Math.abs(b.texts[i].y / 2 - t.y), `${name}: y de «${t.text}»`).toBeLessThanOrEqual(1);
      });
      // vértices, radios y rayas; los grosores de línea siguen en px de mapa de bits (dopplerInteraction.spec los usa)
      expect(b.shapes.length, name).toBe(a.shapes.length);
      a.shapes.forEach((v, i) =>
        v.forEach((n, j) => expect(Math.abs(b.shapes[i][j] / 2 - n), `${name}: trazo ${i}`).toBeLessThanOrEqual(1)),
      );
    }
  });
});
