import { afterEach, describe, expect, it, vi } from 'vitest';
import { EQUIPMENT_LIMITS } from '../app/equipment';
import { defaultEquipment } from '../app/simulator';
import { slider, type Syncable } from '../ui/controls';
import type { PanelContext } from '../ui/panel/context';
import { buildImageAdvanced } from '../ui/panel/imageControls';
import { TGC_BANDS } from '../ultrasound/tgcBands';
import { FakeElement, fakeDocument, findAll } from './support/fakeDom';

afterEach(() => vi.unstubAllGlobals());

function stubDocument(): void {
  const doc = fakeDocument();
  // `<output>.htmlFor` es una lista de identificadores, no un texto
  vi.stubGlobal('document', {
    ...doc,
    createElement: (tag: string) => Object.assign(doc.createElement(tag), tag === 'output' ? { htmlFor: new Set<string>() } : {}),
  });
}

describe('Deslizador', () => {
  it('tras mover la barra, el valor y la barra dicen lo que el modelo alcanzó, no lo pedido', () => {
    stubDocument();
    // una meseta: el modelo no pasa de 30 (la PRF de la profundidad, una pose acotada) y nadie sincroniza el mando
    let value = 10;
    const host = new FakeElement('div');
    slider(host as unknown as HTMLElement, {
      label: 'Escala',
      min: 4,
      max: 60,
      step: 1,
      get: () => value,
      set: (v) => (value = Math.min(v, 30)),
      format: (v) => `±${v} cm/s`,
    });
    const [input] = findAll(host, (e) => e.tagName === 'INPUT');
    const [out] = findAll(host, (e) => e.tagName === 'OUTPUT');
    expect(out.textContent).toBe('±10 cm/s');
    input.value = '50';
    input.dispatch('input');
    expect(value).toBe(30);
    expect(out.textContent).toBe('±30 cm/s');
    expect(input.value).toBe('30');
  });
});

describe('Mandos avanzados de la imagen 2D', () => {
  it('la TGC, el rango dinámico y la persistencia toman sus límites de EQUIPMENT_LIMITS, sin literales', () => {
    stubDocument();
    // otros límites que los de fábrica: un literal en el panel no los seguiría
    type Range = { min: number; max: number };
    const limits = EQUIPMENT_LIMITS as unknown as Record<'tgcDb' | 'dynamicRangeDb' | 'persistence', Range>;
    const want: Record<keyof typeof limits, Range> = {
      tgcDb: { min: -12, max: 9 },
      dynamicRangeDb: { min: 30, max: 90 },
      persistence: { min: 0.1, max: 0.6 },
    };
    const saved = structuredClone({ tgcDb: limits.tgcDb, dynamicRangeDb: limits.dynamicRangeDb, persistence: limits.persistence });
    for (const k of Object.keys(want) as (keyof typeof want)[]) Object.assign(limits[k], want[k]);
    try {
      const host = new FakeElement('div');
      const syncables: Syncable[] = [];
      const bmode = defaultEquipment().bmode;
      const ctx = {
        sim: () => ({ bmode }),
        dispatch: () => undefined,
        track: (c: Syncable) => (syncables.push(c), c),
      } as unknown as PanelContext;
      buildImageAdvanced(ctx, host as unknown as HTMLElement);
      for (const c of syncables) c.sync();
      const bounds = (prefix: string) =>
        findAll(host, (e) => e.tagName === 'INPUT' && String(e.id).startsWith(prefix)).map((e) => [
          Number(Reflect.get(e, 'min')),
          Number(Reflect.get(e, 'max')),
        ]);
      expect(bounds('ctl-tgc-')).toEqual(Array(TGC_BANDS).fill([want.tgcDb.min, want.tgcDb.max]));
      expect(bounds('ctl-rango-dinamico-')).toEqual([[want.dynamicRangeDb.min, want.dynamicRangeDb.max]]);
      expect(bounds('ctl-persistencia-')).toEqual([[want.persistence.min, want.persistence.max]]);
    } finally {
      for (const k of Object.keys(saved) as (keyof typeof saved)[]) Object.assign(limits[k], saved[k]);
    }
  });
});
