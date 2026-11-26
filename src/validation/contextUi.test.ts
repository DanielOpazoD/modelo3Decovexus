import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulationSession } from '../app/session';
import { caseTeacherNotes } from '../app/teacherNotes';
import { defaultEquipment, type Simulator } from '../app/simulator';
import { defaultPose } from '../probe/probe';
import { Store } from '../app/store';
import { CASE_TEACHING } from '../cases/teaching';
import { CASE_VIGNETTES } from '../cases/vignettes';
import type { Syncable } from '../ui/controls';
import type { PanelContext } from '../ui/panel/context';
import { MeasureTab } from '../ui/panel/measureTab';
import { TeacherTab, renderCaseNotes } from '../ui/panel/teacherTab';
import { CONTEXT_FLAGS, CONTEXT_LABELS, contextResultLines } from '../ui/panel/vexusText';
import { classifyModifiedVexus, classifyVexusC } from '../vexus/classification';
import { FakeElement, fakeDocument, findAll } from './support/fakeDom';
import { fixtureInstalled } from './support/legacyPerson/state';
import { recordingGl } from './support/recordingGl';

/**
 * Cableado del contexto clínico en la consola (decisión 82), con un DOM falso: la sección «Contexto clínico» de la
 * pestaña Medir (viñeta, una casilla por confusor, lo marcado en el grado y en el resultado, y cuándo se borra) y lo que
 * solo ve el docente en su pestaña. Las pestañas son las de la app; el panel se sustituye por lo mínimo que la pestaña le
 * pide (secciones, sincronización, estado y un simulador con el id del caso). Con el mismo panel, la pestaña Medir sobre una
 * sesión real comprueba también la serie de adquisición que abre un cambio de caso.
 */
beforeEach(() => vi.stubGlobal('document', fakeDocument()));
afterEach(() => vi.unstubAllGlobals());

function fakePanel(sim: object, debug = false) {
  const syncables: Syncable[] = [];
  const sections: string[] = [];
  const store = new Store({
    mode: 'B',
    tab: 'medir',
    frozen: false,
    debug,
    audio: false,
    caseId: 'normal-adult',
    torso: true,
    tool: 'none',
  });
  const ctx: PanelContext = {
    setPose: vi.fn(),
    sim: () => sim as unknown as Simulator,
    store,
    dispatch: () => undefined,
    track: <T extends Syncable>(s: T): T => {
      syncables.push(s);
      return s;
    },
    sync: () => syncables.forEach((s) => s.sync()),
    section: (parent, title) => {
      const sec = document.createElement('section');
      const body = document.createElement('div');
      sec.append(title, body);
      parent.appendChild(sec);
      sections.push(title);
      return body;
    },
    // como Panel.segmented: un botón por opción que llama a `set` en cada clic, también en el ya pulsado
    segmented: (parent, options, get, set) => {
      const seg = document.createElement('div');
      for (const [v, label] of options) {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', () => {
          set(v);
          ctx.sync();
        });
        seg.appendChild(b);
        ctx.track({ sync: () => b.setAttribute('aria-pressed', String(get() === v)) });
      }
      parent.appendChild(seg);
      return seg;
    },
    cancelCaliper: vi.fn(),
  };
  return { ctx, sections, store };
}

function mountMeasure(caseId: string, debug = false) {
  const sim = {
    patient: { id: caseId, respiratoryPattern: 'quiet' },
    pw: { enabled: false },
    acquisitionEpoch: 0,
    acquisitionFrameAfter: null as number | null,
    physiology: { clock: { t: 5 } },
    pose: defaultPose(),
    equipment: defaultEquipment(),
    renderer: { displayedFrame: null as { n: number } | null },
  };
  const { ctx, sections, store } = fakePanel(sim, debug);
  const host = new FakeElement('div');
  const tab = new MeasureTab(ctx, host as unknown as HTMLElement, new FakeElement('span') as unknown as HTMLElement);
  const byClass = (c: string) => findAll(host, (e) => e.classList.contains(c));
  const boxes = () => findAll(host, (e) => e.tagName === 'INPUT' && e.type === 'checkbox');
  const box = (label: string) => boxes().find((b) => b.parentElement!.textContent === label)!;
  return {
    tab,
    sim,
    store,
    cancelCaliper: ctx.cancelCaliper,
    /** El aviso de la tarjeta de captura (role=status). */
    status: () => findAll(host, (e) => e.getAttribute('role') === 'status')[0],
    history: () => byClass('measurement-history')[0],
    sections,
    boxes,
    box,
    result: () => byClass('result')[0].innerHTML,
    /** El anunciador del grado va en la pestaña, fuera del cuerpo de la medida (que se oculta con el calibrador armado). */
    live: () => {
      const live = findAll(host, (e) => e.classList.contains('sr-only'));
      expect(live).toHaveLength(1);
      expect(live[0].parentElement).toBe(host);
      return live[0];
    },
    vignette: () => byClass('vignette')[0].textContent,
    /** Otro caso (la sesión reconstruye el simulador y el panel avisa a la pestaña) o el mismo reiniciado. */
    load: (id: string) => {
      sim.patient = { id, respiratoryPattern: 'quiet' };
      tab.onSimulatorChanged();
    },
    button: (text: string) => findAll(host, (e) => e.tagName === 'BUTTON' && e.textContent === text)[0],
    /** La salida de una fila del protocolo («VCI diámetro», «Porta PF»…). */
    output: (label: string) =>
      findAll(host, (e) => e.tagName === 'BUTTON' && e.textContent === label)[0].parentElement!.children[1].textContent,
    /**
     * Capturas ya hechas. Las de la pestaña salen del espectro adquirido, que aquí no hay: se ponen en sus campos, y lo
     * que se prueba es lo que la pestaña hace con ellas (grado con el contexto, líneas y avisos).
     */
    measured: (m: { hepatic?: unknown; portal?: unknown; renal?: unknown }) => {
      const t = tab as unknown as { lastHepatic: unknown; lastPortal: unknown; lastRenal: unknown };
      t.lastHepatic = m.hepatic ?? null;
      t.lastPortal = m.portal ?? null;
      t.lastRenal = m.renal ?? null;
    },
    /** Calibres públicos sobre un ciclo M continuo; la verdad sintética difiere de lo medido. */
    measureM: () => {
      Object.assign(sim, {
        physiology: {
          clock: { t: 5 },
          samples: Array.from({ length: 9 }, (_, i) => ({
            t: i / 8,
            resp: { cycling: true, phase: (i / 8) % 1, volume: (1 - Math.cos((i * Math.PI) / 4)) / 2 },
            ivc: { dApMm: 40 - i },
          })),
        },
        renderer: { mStrip: { count: 9, time: (i: number) => i / 8 } },
      });
      ctx.store.set({ tool: 'mmode' });
      for (const p of [
        { t: 0, r: 50 },
        { t: 0, r: 74 },
        { t: 1, r: 50 },
        { t: 1, r: 68 },
      ])
        tab.addMPoint({ ...p, pixelMm: 0.2 }, [0, 1]);
    },
  };
}

// capturas con el visto bueno de la calidad, con los valores del caso de la presión intraabdominal alta
const OK = { quality: { issue: null } };
const SEVERE_HV = { ...OK, pattern: 'severe', sPeak: -9, dPeak: 27, aPeak: 2, beats: 4 };
const NORMAL_HV = { ...OK, pattern: 'normal', sPeak: 25, dPeak: 15, aPeak: -4, beats: 4 };
const NORMAL_PV = { ...OK, vMax: 21, vMin: 16, pulsatilityFraction: 22 };
const CONTINUOUS_RV = { ...OK, pattern: 'continuous', sPeak: 13, dPeak: 22, vMin: 6, beats: 4 };
const MONOPHASIC_RV = { ...CONTINUOUS_RV, pattern: 'monophasic', sPeak: 8, dPeak: 36, vMin: -6 };

describe('Pestaña Medir: contexto clínico (decisión 82)', () => {
  it('archiva una copia y excluye la serie previa; una imagen antigua no puede convertirse en un calibre nuevo', () => {
    const m = mountMeasure('normal-adult');
    m.measured({ hepatic: NORMAL_HV, portal: NORMAL_PV, renal: CONTINUOUS_RV });
    m.tab.setIvcCaliper(25);
    expect(m.tab.archiveMeasurements('respiration')).toBe(true);
    expect(m.result()).toContain('Nueva serie');
    expect(m.result()).toContain('VCI: —');
    expect(m.history().children).toHaveLength(1);
    const saved = m.history().children[0].children[2].innerHTML;
    expect(saved).toContain('25.0 mm');
    expect(m.history().textContent).toContain('excluida del resultado actual');
    m.sim.acquisitionFrameAfter = 42;
    m.sim.renderer.displayedFrame = { n: 12 };
    m.tab.setIvcCaliper(30);
    expect(m.result()).toContain('Imagen de la serie anterior');
    expect(m.result()).toContain('VCI: —');
    expect(m.history().children[0].children[2].innerHTML).toBe(saved);
    m.load('severe-congestion');
    expect(m.history().children).toHaveLength(0);
  });

  it('no presenta entradas inválidas ni fases indeterminadas como un estudio normal', () => {
    const m = mountMeasure('normal-adult');
    m.tab.setIvcCaliper(-1);
    expect(m.result()).toContain('entrada inválida');
    expect(m.result()).not.toContain('VExUS 0 ');
    m.measured({
      hepatic: { ...NORMAL_HV, sPeak: 0, pattern: 'indeterminate' },
      portal: NORMAL_PV,
      renal: { ...CONTINUOUS_RV, dPeak: 0, pattern: 'systolic-only' },
    });
    m.tab.setIvcCaliper(25);
    expect(m.result()).toContain('indeterminado: fase no identificable');
    expect(m.result()).toContain('solo S: fuera del esquema');
    expect(m.result()).toContain('incompleto');
    expect(m.result()).not.toContain('S invertida');
    expect(m.result()).not.toContain('bifásico (S+D)');
  });

  it('una PF inmediatamente inferior al umbral no se presenta redondeada en la siguiente categoría', () => {
    const m = mountMeasure('normal-adult');
    for (const [pf, threshold, label, below] of [
      [29.999, 30, 'normal', '29,9'],
      [49.999, 50, 'leve', '49,9'],
    ] as const) {
      // con los latidos, también el resumen de su variabilidad en la misma línea
      const portal = { ...NORMAL_PV, pulsatilityFraction: pf, beats: 4, pulsatilityByBeat: [pf, pf, pf, pf] };
      m.measured({ hepatic: NORMAL_HV, portal, renal: CONTINUOUS_RV });
      m.tab.setIvcCaliper(25);
      expect(m.result()).toContain(`PF <b>menos de ${threshold} %</b>`);
      expect(m.result()).toContain(`(${label}, próximo al umbral)`);
      expect(m.result()).toContain(`PF menos de ${threshold} % · rango entre 4 latidos ${below}–${below} %`);
      expect(m.result()).not.toContain(`PF ${threshold} %`);
    }
  });

  it('una VCI inmediatamente inferior al corte no se presenta redondeada a 20 mm junto a un grado 0', () => {
    const m = mountMeasure('normal-adult');
    m.measured({ hepatic: SEVERE_HV, portal: { ...NORMAL_PV, pulsatilityFraction: 60 }, renal: MONOPHASIC_RV });
    m.tab.setIvcCaliper(19.97);
    expect(m.result()).toContain('VExUS 0');
    expect(m.result()).toContain('VCI: 19.9 mm <span class="small">(< 20 mm)</span>');
    expect(m.result()).not.toContain('20.0 mm');
    expect(m.output('VCI diámetro')).toBe('19.9 mm');
    m.tab.setIvcCaliper(20);
    expect(m.result()).toContain('VCI: 20.0 mm <span class="small">(≥ 20 mm: dilatada)</span>');
    expect(m.output('VCI diámetro')).toBe('20.0 mm');
  });

  it('la onda A ausente de la FA y un mínimo renal sin latido creíble se muestran «—», nunca «NaN»', () => {
    const m = mountMeasure('af-moderate-congestion');
    m.measured({ hepatic: { ...NORMAL_HV, aPeak: NaN }, portal: NORMAL_PV, renal: { ...CONTINUOUS_RV, vMin: NaN } });
    m.tab.setIvcCaliper(25);
    expect(m.result()).not.toContain('NaN');
    expect(m.result()).toContain('VSH: S 25.0 · D 15.0 · A — cm/s');
    expect(m.result()).toContain('mín — cm/s');
  });

  it('una S invertida que redondea a cero conserva el signo junto a «grave (S invertida)» (decisión 272)', () => {
    const m = mountMeasure('severe-congestion');
    m.measured({ hepatic: { ...SEVERE_HV, sPeak: -0.04 }, portal: NORMAL_PV, renal: MONOPHASIC_RV });
    m.tab.setIvcCaliper(25);
    expect(m.result()).toContain('VSH: S -0.0 · D 27.0');
    expect(m.result()).toContain('grave (S invertida)');
  });

  it('una S apenas mayor que D no se presenta igual que D junto a «normal (S>D)»', () => {
    const m = mountMeasure('normal-adult');
    m.measured({ hepatic: { ...NORMAL_HV, sPeak: 25.04, dPeak: 25 }, portal: NORMAL_PV, renal: CONTINUOUS_RV });
    m.tab.setIvcCaliper(15);
    expect(m.result()).toContain('VSH: S 25.04 · D 25.00 · A -4.0 cm/s → <b>normal (S>D)</b>');
  });

  it('una PF medida con el valle en el filtro de pared se presenta como cota inferior y cuenta como grave', () => {
    const m = mountMeasure('severe-congestion');
    const portal = { ...OK, vMax: 20, vMin: 2.4, pulsatilityFraction: 88, pulsatilityLowerBound: true };
    m.measured({ hepatic: SEVERE_HV, portal, renal: MONOPHASIC_RV });
    m.tab.setIvcCaliper(25);
    expect(m.result()).toContain('PF <b>≥ 88,0 %</b>');
    expect(m.result()).toContain('(grave; el valle cae en el filtro de pared: la PF real es mayor)');
    expect(m.output('Porta PF')).toBe('≥ 88,0 %');
    expect(m.result()).toContain('VExUS 3');
  });

  it('la cota inferior con el filtro de pared alto no afirma que el valle llegue a la línea de base', () => {
    // a 200 Hz el suelo de la traza está a ~10 cm/s: un Vmín de 6,9 es el borde del filtro, no la línea de base
    const m = mountMeasure('severe-congestion');
    const portal = { ...OK, vMax: 24, vMin: 6.9, pulsatilityFraction: 71, pulsatilityLowerBound: true };
    m.measured({ hepatic: SEVERE_HV, portal, renal: MONOPHASIC_RV });
    m.tab.setIvcCaliper(25);
    expect(m.result()).toContain('PF <b>≥ 71,0 %</b>');
    expect(m.result()).toContain('el valle cae en el filtro de pared: la PF real es mayor');
    expect(m.result()).not.toContain('línea de base');
  });

  it('«Contexto clínico» va antes del protocolo, con la viñeta del caso y una casilla sin marcar por confusor', () => {
    const m = mountMeasure('abdominal-hypertension');
    expect(m.sections).toEqual(['Contexto clínico', 'Protocolo VExUS', 'Resultado']);
    expect(m.vignette()).toBe(CASE_VIGNETTES['abdominal-hypertension']);
    expect(m.boxes().map((b) => b.parentElement!.textContent)).toEqual([
      'ERC avanzada o diálisis',
      'Cirrosis',
      'Fibrilación auricular',
      'Sin ECG',
      'Ventilación con presión positiva',
      'Presión intraabdominal alta',
      'Deportista',
    ]);
    expect(m.boxes().every((b) => !b.checked)).toBe(true);
    // el grupo tiene nombre (la leyenda) y cada casilla el suyo (su etiqueta la envuelve)
    const group = m.boxes()[0].parentElement!.parentElement!;
    expect(group.tagName).toBe('FIELDSET');
    expect(group.children[0].tagName).toBe('LEGEND');
    // sin nada marcado ni medido: sin avisos, y la línea del mVExUS
    expect(m.result()).not.toContain('ctx-warn');
    expect(m.result()).toContain('mVExUS (sin riñón): <b>—</b>');
    // el resumen para el lector de pantalla está en una región viva
    expect(m.live().getAttribute('aria-live')).toBe('polite');
    expect(m.live().textContent).toBe('VExUS —, VCI no medida');
  });

  it('«Cirrosis» quita la porta en los dos sentidos y la suprahepática solo si no está invertida', () => {
    const m = mountMeasure('cirrhosis-pulmonary-hypertension');
    const portal = { ...OK, vMax: 13, vMin: 8, pulsatilityFraction: 38 };
    m.measured({ hepatic: SEVERE_HV, portal, renal: MONOPHASIC_RV });
    m.tab.setIvcCaliper(31);
    expect(m.result()).toContain('VExUS 3 <span class="small">completo</span>');
    m.box('Cirrosis').click();
    let r = m.result();
    // la S invertida y el riñón grave siguen dando el 3: la cirrosis aplana la suprahepática, no la invierte (un grado,
    // no un intervalo: «con el contexto»)
    expect(r).toContain('VExUS 3 <span class="small">con el contexto</span>');
    expect(r).toContain('<b>Porta · no fiable</b> — cirrosis: la pulsatilidad portal no sigue a la PAD');
    expect(r).toContain('<b>Suprahepática · aviso</b> — cirrosis:');
    let lines = r.split('</div>');
    expect(lines.find((l) => l.includes('Porta: 13.0/8.0'))).toContain('(leve)');
    expect(lines.find((l) => l.includes('Porta: 13.0/8.0'))).toContain('· no fiable');
    expect(lines.find((l) => l.includes('VSH: S'))).not.toContain('no fiable');
    expect(lines.find((l) => l.includes('Renal: máx. sist.'))).not.toContain('no fiable');
    expect(m.live().textContent).toBe('VExUS 3, con el contexto');
    // con la suprahepática normal, que la cirrosis puede ocultar, sí deja de contar: el intervalo lo abre el riñón
    m.measured({ hepatic: NORMAL_HV, portal, renal: MONOPHASIC_RV });
    m.tab.renderResult();
    r = m.result();
    expect(r).toContain('VExUS 2–3 <span class="small">intervalo por el contexto</span>');
    expect(r).toContain('<b>Suprahepática · no fiable</b> — cirrosis:');
    lines = r.split('</div>');
    expect(lines.find((l) => l.includes('VSH: S'))).toContain('· no fiable');
    m.box('Cirrosis').click();
    expect(m.result()).not.toContain('no fiable');
  });

  it('presión intraabdominal alta: la VCI pequeña da el intervalo en vez del grado 0 falso, con el aviso y el mVExUS', () => {
    const m = mountMeasure('abdominal-hypertension');
    m.measured({ hepatic: SEVERE_HV, portal: NORMAL_PV, renal: CONTINUOUS_RV });
    m.tab.setIvcCaliper(14.5);
    expect(m.result()).toContain('VExUS 0 <span class="small">completo</span>');
    m.box('Presión intraabdominal alta').click();
    const r = m.result();
    expect(r).toContain('VExUS 0–2 <span class="small">intervalo por el contexto</span>');
    expect(r).toContain('<b>VCI · aviso</b> — presión intraabdominal alta: la VCI puede ser pequeña con la PAD alta');
    expect(r).toContain('mVExUS (sin riñón): <b>0–2</b> <span class="small">intervalo por el contexto</span>');
    expect(r).not.toContain('del corte de 20 mm');
    expect(m.live().textContent).toBe('VExUS 0–2, intervalo por el contexto');
    // sin el riñón medido, «incompleto»: falta una medida, no solo el contexto
    m.measured({ hepatic: SEVERE_HV, portal: NORMAL_PV });
    m.tab.renderResult();
    expect(m.result()).toContain('VExUS 0–3 <span class="small">incompleto</span>');
    // a ±2 mm del corte, la nota
    m.tab.setIvcCaliper(21);
    expect(m.result()).toContain('VCI a ±2 mm del corte de 20 mm');
  });

  it('ERC y deportista solo quitan el hallazgo grave: con el riñón y la porta normales el grado no se abre', () => {
    const m = mountMeasure('normal-adult');
    m.measured({ hepatic: NORMAL_HV, portal: NORMAL_PV, renal: CONTINUOUS_RV });
    m.tab.setIvcCaliper(24);
    m.box('ERC avanzada o diálisis').click();
    m.box('Deportista').click();
    const r = m.result();
    expect(r).toContain('VExUS 1 <span class="small">completo</span>');
    expect(r).not.toContain('no fiable');
    expect(r).toContain('<b>Renal · aviso</b>');
    expect(r).toContain('<b>VCI · aviso</b> — deportista: la VCI puede estar dilatada sin PAD alta');
  });

  it('otro caso desmarca todo y cambia la viñeta; reiniciar el mismo, intervenir o «Borrar mediciones» no tocan lo marcado', () => {
    const m = mountMeasure('abdominal-hypertension');
    m.box('Presión intraabdominal alta').click();
    m.box('Cirrosis').click();
    const warnings = () => (m.result().match(/ctx-warn/g) ?? []).length;
    expect(warnings()).toBe(3);
    // intervención docente: la historia no cambia (el panel solo borra las mediciones)
    m.tab.setIvcCaliper(9);
    m.tab.clearMeasurements();
    expect(m.box('Presión intraabdominal alta').checked).toBe(true);
    expect(warnings()).toBe(3);
    m.button('Borrar mediciones').click();
    expect(m.box('Cirrosis').checked).toBe(true);
    // «Reiniciar paciente»: el mismo caso, las mediciones fuera y lo marcado sigue
    m.tab.setIvcCaliper(9);
    m.load('abdominal-hypertension');
    expect(m.result()).toContain('VCI: — ');
    expect(m.box('Cirrosis').checked).toBe(true);
    expect(warnings()).toBe(3);
    // otro caso: nada marcado, sin avisos y la viñeta nueva
    m.load('normal-adult');
    expect(m.boxes().every((b) => !b.checked)).toBe(true);
    expect(warnings()).toBe(0);
    expect(m.vignette()).toBe(CASE_VIGNETTES['normal-adult']);
  });

  it('el rótulo de VCI M sigue la casilla respiratoria del alumno, conserva los calibres y no revela la verdad', () => {
    for (const caseId of ['normal-adult', 'mechanical-ventilation']) {
      const m = mountMeasure(caseId);
      m.measureM();
      const spontaneous = m.result();
      const grade = m.live().textContent;
      expect(spontaneous).toContain('máx 24,0 · mín 18,0 mm → colapso <b>25 %</b>');
      expect(spontaneous).not.toContain('variación respiratoria');
      expect(spontaneous).not.toContain('verdad');
      m.box('Ventilación con presión positiva').click();
      expect(m.result()).toContain('máx 24,0 · mín 18,0 mm → variación respiratoria <b>25 %</b>');
      expect(m.result()).toContain('puede alterar la VCI');
      expect(m.result()).not.toContain('colapso');
      expect(m.result()).not.toContain('verdad');
      expect(m.live().textContent).toBe(grade);
      m.box('Ventilación con presión positiva').click();
      expect(m.result()).toBe(spontaneous);
    }
  });

  it('la verdad del modo M sigue al modo docente al encenderlo y al apagarlo, también en las series archivadas', () => {
    const m = mountMeasure('normal-adult', true);
    // como ControlPanel: cada cambio del estado llega a la pestaña
    m.store.subscribe((st) => m.tab.applyStore(st));
    const truth = '(verdad 40,0/32,0 mm → 20 %)';
    m.measureM();
    expect(m.result()).toContain(truth);
    m.store.set({ debug: false });
    expect(m.result()).not.toContain('verdad');
    m.store.set({ debug: true });
    expect(m.result()).toContain(truth);
    expect(m.tab.archiveMeasurements('intervention')).toBe(true);
    expect(m.history().textContent).toContain(truth);
    m.store.set({ debug: false });
    expect(m.history().textContent).not.toContain('verdad');
    expect(m.history().textContent).toContain('máx 24,0 · mín 18,0 mm');
    m.store.set({ debug: true });
    expect(m.history().textContent).toContain(truth);
    // medida sin el modo docente: la verdad aparece al encenderlo
    m.store.set({ debug: false });
    m.measureM();
    expect(m.result()).not.toContain('verdad');
    m.store.set({ debug: true });
    expect(m.result()).toContain(truth);
  });
});

describe('Pestaña Medir sobre la sesión: serie de adquisición al cambiar de caso', () => {
  /** Sesión y simulador reales sobre un WebGL falso, con la pestaña avisada como en bootstrap; un cuadro adquirido y congelado. */
  function frozenSession() {
    const rec = recordingGl({ width: 320, height: 240 });
    const session = new SimulationSession(rec.canvas, 'normal-adult', fixtureInstalled());
    const { ctx } = fakePanel(session.sim);
    ctx.sim = () => session.sim;
    const host = new FakeElement('div');
    const tab = new MeasureTab(ctx, host as unknown as HTMLElement, new FakeElement('span') as unknown as HTMLElement);
    session.onSimulatorChanged(() => tab.onSimulatorChanged());
    session.sim.render();
    session.sim.frozen = true;
    return { rec, session, tab, result: () => findAll(host, (e) => e.classList.contains('result'))[0].innerHTML };
  }

  it('con la imagen congelada, otro caso o «Reiniciar paciente» no dejan calibrar la imagen del paciente anterior', () => {
    const { rec, session, tab, result } = frozenSession();
    for (const change of [() => session.loadCase('severe-congestion'), () => session.reloadCase()]) {
      expect(change()).toBeNull();
      expect(session.sim.frozen).toBe(true);
      // la pantalla tampoco conserva la imagen anterior: lo último que se limpia es el lienzo
      expect(rec.clears.at(-1)).toBeNull();
      tab.setIvcCaliper(15);
      expect(result()).toContain('Imagen de la serie anterior');
      expect(result()).toContain('VCI: —');
    }
    // el primer cuadro del paciente nuevo sí se mide
    session.sim.frozen = false;
    session.sim.render();
    tab.setIvcCaliper(15);
    expect(result()).toContain('15.0 mm');
    expect(result()).not.toContain('Imagen de la serie anterior');
  });

  it('el cuadro mostrado es el mismo al congelar y al volver al último del cine: el calibrador lo compara entre sus puntos', () => {
    const rec = recordingGl({ width: 320, height: 240 });
    const { sim } = new SimulationSession(rec.canvas, 'normal-adult', fixtureInstalled());
    const renderer = sim.renderer;
    for (let i = 0; i < 3; i++) {
      sim.advance(0.05);
      sim.render();
    }
    const live = renderer.displayedFrame;
    sim.frozen = true;
    renderer.cineSeal();
    renderer.showCine(renderer.cineCount - 1);
    expect(renderer.displayedFrame).toBe(live);
    renderer.showCine(renderer.cineCount - 2);
    expect(renderer.displayedFrame).not.toBe(live);
  });

  it('un cambio de caso que falla tras cambiar la escena deja el caso anterior sin calibres sobre el lienzo ya limpio', () => {
    const { rec, session, tab, result } = frozenSession();
    const prev = session.sim;
    const setScene = prev.renderer.setScene.bind(prev.renderer);
    vi.spyOn(prev.renderer, 'setScene').mockImplementationOnce((scene) => {
      setScene(scene);
      throw new Error('fallo provocado tras cambiar la escena');
    });
    expect(session.loadCase('severe-congestion')).toBeInstanceOf(Error);
    // sigue el caso anterior, con su escena, pero su imagen congelada ya no está en pantalla
    expect(session.sim).toBe(prev);
    expect(prev.renderer.scene).toBe(prev.scene);
    expect(rec.clears.at(-1)).toBeNull();
    tab.setIvcCaliper(15);
    expect(result()).toContain('Imagen de la serie anterior');
    expect(result()).toContain('VCI: —');
  });
});

describe('Pestaña Medir: captura sin un latido completo (decisión 292)', () => {
  it.each([
    ['Suprahepática', 'hepatic', NORMAL_HV],
    ['Renal', 'renal', CONTINUOUS_RV],
  ] as const)('«Capturar» en %s antes del primer latido conserva la medición guardada y lo dice', async (row, tool, saved) => {
    const m = mountMeasure('normal-adult');
    // espectro recién reiniciado: la lectura está lista, pero aún no cubre ningún latido
    Object.assign(m.sim, {
      pw: { enabled: true, angleCorrection: 0, invert: false },
      pwChain: {
        revision: 1,
        readCapture: () => ({
          kind: 'ready',
          revision: 1,
          columns: [],
          acquiredEquipment: { prfHz: 4000, f0Hz: 2.5e6, gainDb: 0, wallFilterHz: 25, fftSize: 128 },
        }),
      },
      gateTrack: [],
    });
    Object.assign(m.sim.physiology, { rhythm: { beatsBetween: () => [] } });
    m.measured({ [tool]: saved });
    m.tab.renderResult();
    const before = m.result();
    m.button(row).click();
    await vi.waitFor(() => expect(m.button('Capturar')).toBeDefined());
    m.button('Capturar').click();
    expect(m.store.get().tool).toBe(tool);
    expect(m.status().textContent).toMatch(/^Adquiere señal nueva: aún no hay un latido completo/);
    expect(m.status().textContent).toContain('si está congelada, reanuda el PW');
    m.tab.renderResult();
    expect(m.result()).toBe(before);
  });

  it('el calibrador que vuelve a empezar porque cambió el cuadro lo dice donde se mira: la tarjeta o el resultado', () => {
    const m = mountMeasure('normal-adult');
    const restarted = /La imagen cambió entre los dos puntos: este pasa a ser el primero/;
    m.button('VCI diámetro').click();
    m.tab.setIvcCaliper(null, true);
    expect(m.status().textContent).toMatch(restarted);
    // ⌘/Ctrl+clic sin la fila armada: la tarjeta está oculta
    m.store.set({ tool: 'none' });
    m.tab.setIvcCaliper(null, true);
    expect(m.result()).toMatch(restarted);
    // Esc, armar una fila o «Borrar» sueltan ese punto: el aviso, que lo daba por primero, se retira
    m.tab.setIvcCaliper(null);
    expect(m.result()).not.toMatch(restarted);
    m.tab.setIvcCaliper(null, true);
    m.tab.setIvcCaliper(18);
    expect(m.result()).not.toMatch(restarted);
  });

  it('«Borrar mediciones» suelta también el punto de ⌘/Ctrl+clic, que no arma herramienta', () => {
    const m = mountMeasure('normal-adult');
    m.button('Borrar mediciones').click();
    expect(m.cancelCaliper).toHaveBeenCalledTimes(1);
  });

  it('repetir la VCI y cancelar conserva la medida anterior: el calibre que vuelve a empezar no la borra', () => {
    const m = mountMeasure('normal-adult');
    m.tab.setIvcCaliper(22.4);
    m.button('VCI diámetro').click();
    m.tab.setIvcCaliper(null, true);
    m.button('Cancelar (Esc)').click();
    m.tab.renderResult();
    expect(m.output('VCI diámetro')).toBe('22.4 mm');
    expect(m.result()).toContain('VCI: 22.4 mm <span class="small">(≥ 20 mm: dilatada)</span>');
  });
});

describe('Pestaña Medir con el teclado', () => {
  it('armar una fila con el teclado lleva el foco adonde se mide (la imagen o la tarjeta) y desarmarla lo devuelve a la fila', () => {
    const sim = { patient: { id: 'normal-adult' }, pw: { enabled: false } };
    const { ctx, store } = fakePanel(sim);
    const image = new FakeElement('canvas');
    const host = new FakeElement('div');
    const tab = new MeasureTab(
      { ...ctx, measureImage: image as unknown as HTMLElement },
      host as unknown as HTMLElement,
      new FakeElement('span') as unknown as HTMLElement,
    );
    store.subscribe((st) => tab.applyStore(st));
    const row = (text: string) => findAll(host, (e) => e.tagName === 'BUTTON' && e.textContent === text)[0];
    const focused = () => (document as unknown as { activeElement: unknown }).activeElement;
    // el botón de la fila se oculta con el protocolo: sin esto el foco caía al body
    row('VCI diámetro').click();
    expect(focused()).toBe(image);
    store.set({ tool: 'none' }); // Esc, o el segundo punto del calibrador
    expect(focused()).toBe(row('VCI diámetro'));
    row('VCI modo M').click();
    expect(focused()).toBe(row('Cancelar (Esc)'));
    row('Cancelar (Esc)').click();
    expect(focused()).toBe(row('VCI modo M'));
    // el foco que el alumno llevó a otro sitio no se mueve
    row('VCI diámetro').click();
    const other = new FakeElement('button');
    other.focus();
    store.set({ tool: 'none' });
    expect(focused()).toBe(other);
    // con el ratón (el clic trae su número de pulsaciones) el foco no salta a la imagen: ← → siguen siendo del cine
    row('VCI diámetro').focus();
    row('VCI diámetro').dispatch('click', { detail: 1 });
    expect(store.get().tool).toBe('caliper');
    expect(focused()).toBe(row('VCI diámetro'));
  });
});

describe('Resultado con el contexto: textos (decisión 82)', () => {
  it('cada confusor tiene su rótulo y cada aviso su territorio y su motivo', () => {
    expect(CONTEXT_FLAGS).toHaveLength(7);
    for (const f of CONTEXT_FLAGS) expect(CONTEXT_LABELS[f].length).toBeGreaterThan(3);
    const all = Object.fromEntries(CONTEXT_FLAGS.map((f) => [f, true]));
    const input = { ivcMaxDiameterMm: 24, hepatic: 'severe', portalPulsatilityFraction: 60, renal: 'monophasic' } as const;
    const lines = contextResultLines(classifyVexusC(input, all), classifyModifiedVexus(input, all));
    const warn = lines.filter((l) => l.includes('ctx-warn'));
    expect(warn).toHaveLength(9); // la cirrosis y el deportista avisan de dos territorios cada uno
    // quitan: el riñón grave (ERC) y la porta (cirrosis y deportista); la S invertida sigue contando
    expect(warn.filter((l) => l.includes('· no fiable'))).toHaveLength(3);
    expect(lines[0]).toMatch(/^<div>mVExUS \(sin riñón\): <b>/);
    // la nota de la VCI solo a ±2 mm del corte: 24 mm no, 21,5 sí
    expect(lines.some((l) => l.includes('del corte de 20 mm'))).toBe(false);
    const near = { ...input, ivcMaxDiameterMm: 21.5 };
    expect(contextResultLines(classifyVexusC(near), classifyModifiedVexus(near)).some((l) => l.includes('del corte de 20 mm'))).toBe(true);
  });
});

/** Un simulador con lo que lee la pestaña Docente al construirse: el id del caso y el estado del lazo cerrado. */
function fakeTeacherSim(caseId: string) {
  return {
    patient: { id: caseId },
    physiology: {
      clock: { t: 0 },
      circulation: {
        state: {
          rapMeanMmHg: 14,
          cardiacOutputMlS: 80,
          fluidDeltaMl: 0,
          fluidTargetMl: 0,
          peepCmH2O: 0,
          peepTargetCmH2O: 0,
          tricuspidRegurgitation: 0.7,
        },
        loop: { rap0: 14, co0: 80, tr0: 0.7 },
        interventions: [],
        fluidRoom: () => 500,
      },
    },
  };
}

describe('Pestaña Docente: lo que solo ve el docente (decisión 82)', () => {
  it('las notas del caso: el nombre, los confusores reales y la trampa; para el alumno, nada', () => {
    const el = new FakeElement('div');
    renderCaseNotes(el as unknown as HTMLElement, caseTeacherNotes('abdominal-hypertension', true));
    expect(el.children.map((c) => c.textContent)).toEqual([
      'Trampa · PIA alta con fallo derecho',
      'Contexto real: Presión intraabdominal alta',
      CASE_TEACHING['abdominal-hypertension'].trap,
    ]);
    renderCaseNotes(el as unknown as HTMLElement, caseTeacherNotes('af-moderate-congestion', true));
    expect(el.children.map((c) => c.textContent).slice(1)).toEqual([
      'Contexto real: Fibrilación auricular',
      'Caso de referencia, sin trampa.',
    ]);
    renderCaseNotes(el as unknown as HTMLElement, caseTeacherNotes('abdominal-hypertension', false));
    expect(el.childNodes).toHaveLength(0);
    expect(el.textContent).toBe('');
  });

  it('pulsar la PEEP ya pedida no es una intervención: ni la registra ni archiva las mediciones', () => {
    vi.useFakeTimers();
    try {
      const sim = fakeTeacherSim('normal-adult');
      const intervene = vi.fn(() => ({ kind: 'peep', cmH2O: 10, t0: 0 }));
      Object.assign(sim.physiology, { intervene });
      const { ctx } = fakePanel(sim, true);
      const host = new FakeElement('div');
      const tab = new TeacherTab(ctx, host as unknown as HTMLElement);
      const onIntervention = vi.fn(() => true);
      tab.onIntervention = onIntervention;
      ctx.sync();
      const peep = (v: string) => findAll(host, (e) => e.tagName === 'BUTTON' && e.textContent === v)[0];
      const status = () => findAll(host, (e) => e.getAttribute('role') === 'status')[0].textContent;
      expect(peep('0').getAttribute('aria-pressed')).toBe('true');
      peep('0').click();
      vi.advanceTimersByTime(60);
      expect(intervene).not.toHaveBeenCalled();
      expect(onIntervention).not.toHaveBeenCalled();
      expect(status()).toBe('Sin cambios: la PEEP pedida ya es de 0 cmH₂O.');
      peep('10').click();
      vi.advanceTimersByTime(60);
      expect(intervene).toHaveBeenCalledWith({ kind: 'peep', cmH2O: 10 });
      expect(onIntervention).toHaveBeenCalledTimes(1);
      expect(status()).toContain('Mediciones archivadas');
      // en la transición hacia 10, repetir «10» tampoco reinicia nada
      sim.physiology.circulation.state.peepTargetCmH2O = 10;
      ctx.sync();
      expect(peep('10').getAttribute('aria-pressed')).toBe('true');
      peep('10').click();
      expect(intervene).toHaveBeenCalledTimes(1);
      expect(onIntervention).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('al apagar el modo docente se vacían las notas y el estado del lazo, también en el DOM oculto', () => {
    const sim = fakeTeacherSim('abdominal-hypertension');
    const { ctx, store } = fakePanel(sim, true);
    const host = new FakeElement('div');
    const tab = new TeacherTab(ctx, host as unknown as HTMLElement);
    ctx.sync();
    const notes = () => findAll(host, (e) => e.classList.contains('case-notes'))[0].textContent;
    const loop = () => findAll(host, (e) => e.classList.contains('loop-state'))[0].textContent;
    expect(notes()).toContain('VCI comprimida: el cálculo literal de grado 0');
    expect(loop()).toContain('14.0 mmHg · caso 14.0');
    // la verdad que pintó el bucle (`renderDebug`, que aquí no corre: necesita el simulador entero)
    const truth = findAll(host, (e) => e.classList.contains('debug'))[0];
    truth.textContent = 'VERDAD FISIOLÓGICA (últimos 6 s)';
    store.set({ debug: false });
    ctx.sync();
    expect(notes()).toBe('');
    expect(truth.textContent).toBe('');
    // quedan los rótulos de las filas, sin ningún valor del caso
    expect(loop()).not.toMatch(/\d/);
    // tampoco al cambiar de caso en modo alumno (la pestaña ya cargada sigue recibiendo el aviso)
    sim.patient = { id: 'cirrhosis-pulmonary-hypertension' };
    tab.onSimulatorChanged();
    ctx.sync();
    expect(loop()).not.toMatch(/\d/);
    expect(notes()).toBe('');
    // y al volver al modo docente, todo otra vez
    store.set({ debug: true });
    ctx.sync();
    expect(notes()).toContain('La porta subestima');
    expect(loop()).toContain('caso 14.0');
  });
});
