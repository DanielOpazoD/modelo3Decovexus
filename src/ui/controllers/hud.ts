import { modeHasPw, type ImagingMode } from '../../app/equipment';
import type { Simulator } from '../../app/simulator';
import { nyquistVelocityCms } from '../../core/units';
import { compoundActive } from '../../ultrasound/compound';

/**
 * Textos del HUD de la imagen (esquinas y chip de contexto) como función pura de una vista
 * de solo lectura del simulador: se prueba sin DOM y `main.ts` solo los pinta.
 */
export interface HudInput {
  patientLabel: string;
  frozen: boolean;
  heartRateBpm: number;
  atrialFibrillation: boolean;
  transducerMHz: number;
  f0DopplerHz: number;
  depthMm: number;
  gainDb: number;
  dynamicRangeDb: number;
  /** Composición espacial formándose (decisión 58: `compoundActive`, apagada con el color): «CX». */
  compound: boolean;
  /** Reducción de moteado que actúa en esta imagen (decisión 313): «RM n»; 0 con Color, porque se suspende. */
  speckleReduction: number;
  /** Armónica tisular (decisión 77): «THI» delante de la frecuencia de la imagen. */
  harmonic: boolean;
  mode: ImagingMode;
  /** Color del cuadro en pantalla (`hudImage`), el de la barra: su línea, su escala y su cadencia si lo lleva. */
  color: { enabled: boolean; prfHz: number; wallFilterHz: number; frameHz: number };
  /** `nyquistCms`: la Nyquist rotulada con corrección angular (`Simulator.pwNyquistCms`), la del pie y la regla. */
  pw: { nyquistCms: number; gateMm: number; depthMm: number; sweepMmS: number };
  respVolume: number;
}

export interface HudText {
  topLeft: string[];
  topRight: string[];
  bottomRight: string[];
  chip: string;
}

const mhz = (v: number) => v.toFixed(1).replace('.', ',');

/**
 * Lo que el HUD dice de la imagen sale del cuadro mostrado (`Simulator.displayed`), como la regla y la barra de color:
 * congelada, en cine o entre adquisiciones, un mando recién movido no reescribe la imagen que ya está en pantalla. La
 * cadencia del color también es la del cuadro; antes del primero, la del equipo (decisión 430).
 */
export function hudImage(
  sim: Pick<Simulator, 'displayed' | 'colorTiming'>,
): Pick<HudInput, 'depthMm' | 'gainDb' | 'dynamicRangeDb' | 'compound' | 'speckleReduction' | 'harmonic' | 'color'> {
  const { bmode, color, frameHz = sim.colorTiming.frameHz } = sim.displayed;
  return {
    depthMm: bmode.depthMm,
    gainDb: bmode.gainDb,
    dynamicRangeDb: bmode.dynamicRangeDb,
    compound: compoundActive(bmode, color),
    speckleReduction: color.enabled ? 0 : bmode.speckleReduction,
    harmonic: bmode.harmonic,
    color: { enabled: color.enabled, prfHz: color.prfHz, wallFilterHz: color.wallFilterHz, frameHz },
  };
}

export function hudText(v: HudInput): HudText {
  const colorScale = `±${Math.round(nyquistVelocityCms(v.color.prfHz, v.f0DopplerHz))} cm/s`;
  // en tríplex (decisión 66) las dos líneas: la del color y la del PW; sin Doppler, la respiración y, en modo M (decisión 80), su barrido
  const doppler = [
    ...(v.color.enabled ? [`Color ${colorScale} · WF ${v.color.wallFilterHz.toFixed(0)} Hz · ${v.color.frameHz.toFixed(0)} Hz`] : []),
    ...(modeHasPw(v.mode) ? [`PW ±${Math.round(v.pw.nyquistCms)} cm/s · puerta ${v.pw.gateMm.toFixed(1)} mm`] : []),
  ];
  return {
    topLeft: [v.patientLabel + (v.frozen ? ' · congelada' : '')],
    topRight: [
      `FC ${Math.round(v.heartRateBpm)} lpm · ${v.atrialFibrillation ? 'FA' : 'Sinusal'}`,
      `${(v.depthMm / 10).toFixed(0)} cm · ${v.harmonic ? 'THI ' : ''}${mhz(v.transducerMHz)} MHz · G ${v.gainDb} dB · RD ${v.dynamicRangeDb}` +
        (v.compound ? ' · CX' : '') +
        (v.speckleReduction ? ` · RM ${v.speckleReduction}` : ''),
    ],
    bottomRight: doppler.length ? doppler : [(v.mode === 'M' ? `M ${v.pw.sweepMmS} mm/s · ` : '') + `resp ${v.respVolume.toFixed(2)}`],
    chip: [
      ...(v.mode === 'M' ? [`Modo M · ${v.pw.sweepMmS} mm/s`] : []),
      ...(v.color.enabled ? [colorScale] : []),
      ...(modeHasPw(v.mode) ? [`Puerta ${(v.pw.depthMm / 10).toFixed(1)} cm · ${v.pw.sweepMmS} mm/s`] : []),
    ].join(' · '),
  };
}

/** FC mostrada como un monitor: media móvil (en FA el RR latido a latido salta). */
/**
 * FC del monitor: media móvil de los RR ya vividos (entre dos R), como un equipo real; el RR del latido en curso aún no ha
 * ocurrido (decisión 442). La primera lectura sale del RR programado. Al cargar un caso se conserva la última lectura
 * hasta observar un RR completo del nuevo reloj.
 */
export class HeartRateDisplay {
  private value = 0;
  private lastR = NaN;
  private lived = NaN;
  resetRrHistory(): void {
    this.lastR = NaN;
    this.lived = NaN;
  }

  update(lastR: number, rrSeconds: number, dtSeconds: number): number {
    if (lastR !== this.lastR) {
      this.lived = lastR > this.lastR ? lastR - this.lastR : NaN;
      this.lastR = lastR;
    }
    if (!this.value) this.value = 60 / (this.lived || rrSeconds);
    else if (this.lived) this.value += (60 / this.lived - this.value) * Math.min(1, dtSeconds * 1.5);
    return this.value;
  }
}

/**
 * Una línea `<span>` por texto. Se llama en cada cuadro: reutiliza los `<span>` y solo escribe la línea que cambió, así un
 * HUD quieto (imagen congelada, PW) no fuerza estilo ni layout.
 */
export function renderLines(host: HTMLElement, lines: readonly string[]): void {
  if (host.children.length !== lines.length) host.replaceChildren(...lines.map(() => document.createElement('span')));
  lines.forEach((l, i) => {
    const s = host.children[i];
    if (s.textContent !== l) s.textContent = l;
  });
}
