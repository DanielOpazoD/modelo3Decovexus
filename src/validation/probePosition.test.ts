import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_BUNDLE, LEGACY_BUNDLE } from '../anatomy/anatomyBundle';
import { probePositionText, type ProbePositionInput } from '../app/probePosition';
import { defaultEquipment, type Simulator } from '../app/simulator';
import { Store } from '../app/store';
import { CASES, type CaseId } from '../cases';
import { defaultPose } from '../probe/probe';
import type { PanelContext } from '../ui/panel/context';
import { buildProbePositionCopy } from '../ui/panel/probePosition';
import { FakeElement, fakeDocument, findAll } from './support/fakeDom';

const S0028 = { person: 's0028', frameId: 's0028-audit-las-v1', revision: 's0028-p0e-P0c-direct-v1' } as const;

describe('Posición compartida de la sonda', () => {
  it('conserva precisión, unidades y contexto sin convertir una pose en evidencia del cine', () => {
    const pose = {
      phi: 3.019419873456789,
      z: -40.0000123456789,
      yaw: -1.2566370614359172,
      rock: -0.10471975511965977,
      tilt: -0.03490658503988659,
      lift: -1.23456789,
    };
    const input: ProbePositionInput = {
      source: {
        version: '0.5.0',
        commit: '123abcd',
        buildTime: '2026-10-11T14:00:00Z',
        anatomy: 's0028',
        revision: S0028.revision,
        transducer: 'convex-c35',
      },
      pose,
      equipment: defaultEquipment(),
      context: { caseId: 'normal-adult', seed: 42, respiration: 'apnea-expiratory', timeS: 19.123456789, mode: 'triplex', frozen: true },
    };
    const text = probePositionText(input);
    const result = JSON.parse(text) as ProbePositionInput & {
      format: string;
      scope: string;
      units: object;
      readout: { pressureMm: number };
    };
    expect(result.pose).toEqual(pose);
    expect(result.equipment).toEqual(input.equipment);
    expect(result.context).toEqual(input.context);
    expect(result.source).toEqual(input.source);
    // /2: desde la decisión 340 «atlas» ya no incluye a s0028, la persona por defecto.
    expect(result.format).toBe('vexus-probe-position/2');
    expect(result.scope).toBe('current-probe-and-equipment');
    expect(result.units).toEqual({ poseAngles: 'rad', poseDistances: 'mm' });
    expect(result.readout.pressureMm).toBe(1.23456789);
    // La copia ya formada sigue siendo la del clic aunque el operador continúe moviéndose.
    pose.z = -50;
    input.equipment.bmode.tgcDb = [1, 2, 3, 4, 5, 6, 7, 8];
    expect((JSON.parse(text) as ProbePositionInput).pose.z).toBe(-40.0000123456789);
    expect((JSON.parse(text) as ProbePositionInput).equipment.bmode.tgcDb).toEqual(defaultEquipment().bmode.tgcDb);
  });
});

/**
 * El botón real de Adquirir → Sonda con un DOM falso: lo que llega al portapapeles y, si no lo hay, el texto que queda a la
 * vista. El modo alumno ciego (decisiones 82 y 393) y la procedencia de la persona (decisiones 181 y 340).
 */
describe('«Copiar posición» en la consola', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function copyPosition(o: { caseId?: CaseId; search?: string; debug?: boolean; clipboard?: boolean; scene?: object }) {
    const caseId = o.caseId ?? 'severe-congestion';
    let copied = '';
    vi.stubGlobal('document', fakeDocument());
    vi.stubGlobal('location', { search: o.search ?? '' });
    vi.stubGlobal('navigator', o.clipboard === false ? {} : { clipboard: { writeText: (t: string) => void (copied = t) } });
    const sim = {
      scene: o.scene ?? { identity: S0028, hasAbdominalAtlas: true, torso: { profile: {} } },
      profile: { id: 'convex-c35' },
      pose: defaultPose(),
      equipment: defaultEquipment(),
      patient: CASES.find((c) => c.id === caseId),
      physiology: { clock: { t: 3 } },
      frozen: false,
    };
    const store = new Store({
      mode: 'B',
      tab: 'adquirir',
      frozen: false,
      debug: !!o.debug,
      audio: false,
      caseId,
      torso: true,
      tool: 'none',
    });
    const ctx = { sim: () => sim as unknown as Simulator, store, track: <T>(s: T) => s, setPose: vi.fn() };
    const host = new FakeElement('div');
    buildProbePositionCopy(ctx as unknown as PanelContext, host as unknown as HTMLElement);
    findAll(host, (e) => e.tagName === 'BUTTON' && e.textContent === 'Copiar posición')[0].click();
    await new Promise((r) => setTimeout(r, 0));
    const manual = findAll(host, (e) => e.tagName === 'TEXTAREA')[0];
    // Sin portapapeles el mismo texto queda a la vista, seleccionado.
    expect(manual.hidden).toBe(o.clipboard !== false);
    return o.clipboard === false ? manual.value : copied;
  }

  it('con ?alumno no nombra el caso ni en el portapapeles ni en el texto que queda a la vista', async () => {
    for (const [i, c] of CASES.entries()) {
      for (const clipboard of [true, false]) {
        const text = await copyPosition({ caseId: c.id as CaseId, search: '?alumno', clipboard });
        expect((JSON.parse(text) as ProbePositionInput).context.caseId).toBe(`Paciente ${String.fromCharCode(65 + i)}`);
        for (const other of CASES) {
          expect(text).not.toContain(other.id);
          expect(text).not.toContain(other.label);
        }
      }
    }
  });

  it('el docente y la dirección sin ?alumno conservan el id del caso', async () => {
    for (const o of [{ search: '?alumno', debug: true }, { search: '' }, { search: '?docente' }]) {
      expect((JSON.parse(await copyPosition(o)) as ProbePositionInput).context.caseId).toBe('severe-congestion');
    }
  });

  it('la procedencia distingue s0028 del atlas y del dominio procedural', async () => {
    const source = async (scene: object) => (JSON.parse(await copyPosition({ scene })) as ProbePositionInput).source;
    expect(await source({ identity: S0028, hasAbdominalAtlas: true, torso: { profile: {} } })).toMatchObject({
      anatomy: 's0028',
      revision: S0028.revision,
    });
    expect(await source({ identity: CURRENT_BUNDLE, hasAbdominalAtlas: true, torso: { profile: {} } })).toMatchObject({
      anatomy: 'atlas',
      revision: 'current',
    });
    expect((await source({ identity: LEGACY_BUNDLE, hasAbdominalAtlas: false, torso: { profile: null } })).anatomy).toBe('legacy');
    expect((await source({ identity: LEGACY_BUNDLE, hasAbdominalAtlas: false, torso: { profile: {} } })).anatomy).toBe('reference');
  });
});
