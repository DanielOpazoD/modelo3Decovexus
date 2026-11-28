import {
  IVC_NEAR_THRESHOLD_MM,
  IVC_THRESHOLD_MM,
  PF_MILD,
  PF_SEVERE,
  type HepaticPattern,
  type PortalClass,
  type RenalPattern,
  type Territory,
  type VexusContext,
  type VexusResult,
} from '../../vexus/classification';

/** Textos en español de los patrones y estados del clasificador (única fuente para consola y docente). */
export function statusText(s: VexusResult['status']): string {
  if (s === 'invalid-input') return 'entrada inválida: repetir medición';
  return s === 'complete' ? 'completo' : s === 'incomplete' ? 'incompleto' : 'VCI no medida';
}

export function renalText(p: RenalPattern): string {
  if (p === 'systolic-only') return 'solo S: fuera del esquema';
  if (p === 'indeterminate') return 'fases no resolubles';
  return p === 'continuous'
    ? 'continuo'
    : p === 'biphasic'
      ? 'bifásico (S+D)'
      : p === 'monophasic'
        ? 'monofásico (solo D)'
        : p === 'reversal-out-of-scheme'
          ? 'fuera del esquema'
          : 'no evaluado';
}

/** S = D exacto es leve (`hepaticPatternFromPeaks`): el rótulo lo dice. */
export function patternText(p: HepaticPattern): string {
  if (p === 'indeterminate') return 'indeterminado: fase no identificable';
  return p === 'normal' ? 'normal (S>D)' : p === 'mild' ? 'leve (S≤D)' : p === 'severe' ? 'grave (S invertida)' : 'no evaluado';
}

export function portalText(c: PortalClass): string {
  if (c === 'invalid-input') return 'entrada inválida';
  return c === 'normal'
    ? 'normal'
    : c === 'mild'
      ? 'leve'
      : c === 'severe'
        ? 'grave'
        : c === 'not-applicable'
          ? 'no aplicable'
          : 'no evaluada';
}

/*
 * Un ayudante por magnitud del grado. El redondeo de presentación nunca debe cruzar un umbral de categoría (decisión 272):
 * lo que queda justo debajo de un corte no se escribe como el corte.
 */
export const PF_THRESHOLDS = [PF_MILD, PF_SEVERE] as const;

/** El umbral que el redondeo a la décima de `v` alcanzaría desde abajo, o undefined. */
const crossedThreshold = (v: number, thresholds: readonly number[]): number | undefined =>
  thresholds.find((t) => v < t && Number(v.toFixed(1)) >= t);

/** `v` a la décima; si el redondeo cruzara un umbral, la décima inferior (19,97 con el corte de 20 → 19,9); «—» si no es finito. */
function tenthsBelowThreshold(v: number, thresholds: readonly number[], decimal: '.' | ','): string {
  if (!Number.isFinite(v)) return '—';
  const t = crossedThreshold(v, thresholds);
  const s = (t === undefined ? v : t - 0.1).toFixed(1);
  return decimal === ',' ? s.replace('.', ',') : s;
}

/** Diámetro de la VCI (mm, sin unidad): el redondeo nunca cruza el corte de 20 mm que decide el grado 0. */
export const ivcDiameterText = (mm: number, decimal: '.' | ',' = '.'): string => tenthsBelowThreshold(mm, [IVC_THRESHOLD_MM], decimal);

/** PF sin unidad (la de un latido, los extremos de un rango): coma decimal y sin cruzar 30 ni 50 %. */
export const pulsatilityValueText = (pf: number): string => tenthsBelowThreshold(pf, PF_THRESHOLDS, ',');

/** PF del grado; `lowerBound`: la medida es una cota inferior (el valle cae en el filtro de pared, la real es mayor). */
export function portalPulsatilityText(pf: number, lowerBound = false): string {
  if (!Number.isFinite(pf) || pf < 0) return 'n/a';
  const t = crossedThreshold(pf, PF_THRESHOLDS);
  return t !== undefined ? `menos de ${t} %` : `${lowerBound ? '≥ ' : ''}${pulsatilityValueText(pf)} %`;
}

/**
 * Velocidad (cm/s, sin unidad) a la décima (o con `digits` decimales); «—» si no es finita (la onda A en la FA, un mínimo
 * sin latido). Sin `signed`, el signo físico es un umbral (S < 0: invertida; decisión 272) y un negativo que redondea a cero
 * lo conserva («-0.0»). Con `signed` (signo de pantalla), «+» delante de lo positivo y sin cero negativo.
 */
export function velocityText(v: number, signed = false, digits = 1): string {
  if (!Number.isFinite(v)) return '—';
  if (!signed) return v.toFixed(digits);
  const r = Number(v.toFixed(digits));
  return `${r > 0 ? '+' : ''}${r.toFixed(digits)}`;
}

/**
 * Picos S y D de la VSH (cm/s, sin unidad). Con los dos positivos el patrón compara S con D (normal si S > D), así que,
 * si la décima los iguala, llevan las cifras que hagan falta para que se vea el orden (25,04 y 25 → «25.04» y «25.00»).
 */
export function hepaticPeaksText(s: number, d: number): [string, string] {
  let digits = 1;
  // toFixed admite hasta 100 decimales; dos picos distintos difieren mucho antes
  if (s > 0 && d > 0 && s !== d) while (digits < 100 && s.toFixed(digits) === d.toFixed(digits)) digits++;
  return [velocityText(s, false, digits), velocityText(d, false, digits)];
}

/**
 * Estado del resultado para el alumno (decisión 82): como `statusText`, salvo que con todo medido sea el contexto el que
 * deja fuera un hallazgo: «intervalo por el contexto» si el grado queda en intervalo y «con el contexto» si aun así sale
 * un grado (no «incompleto»: no falta ninguna medida). `withRenal: false` para el mVExUS, que no usa el riñón.
 */
export function resultStatusText(r: VexusResult, withRenal = true): string {
  if (r.status !== 'incomplete') return statusText(r.status);
  const unmeasured =
    r.hepaticClass === 'not-assessed' ||
    r.hepaticClass === 'indeterminate' ||
    r.portalClass === 'not-assessed' ||
    r.portalClass === 'not-applicable' ||
    (withRenal && !['continuous', 'biphasic', 'monophasic'].includes(r.renalClass));
  if (unmeasured) return 'incompleto';
  return r.grade !== null ? 'con el contexto' : 'intervalo por el contexto';
}

/** El grado o su intervalo («2», «0–2»), o «—» sin la VCI. */
export function gradeValueText(r: VexusResult): string {
  return r.grade !== null ? String(r.grade) : r.gradeRange ? `${r.gradeRange[0]}–${r.gradeRange[1]}` : '—';
}

/** Un confusor del contexto clínico: una casilla de la pestaña Medir (decisión 82). */
export type ContextFlag = keyof VexusContext;

/**
 * Rótulos de las casillas del contexto clínico, en su orden en la pestaña Medir. Es un `Record` sobre todas las claves
 * de `VexusContext`: un confusor nuevo en el clasificador sin rótulo aquí no compila.
 */
export const CONTEXT_LABELS: Readonly<Record<ContextFlag, string>> = {
  advancedCkd: 'ERC avanzada o diálisis',
  cirrhosis: 'Cirrosis',
  atrialFibrillation: 'Fibrilación auricular',
  noEcg: 'Sin ECG',
  positivePressureVentilation: 'Ventilación con presión positiva',
  raisedIntraAbdominalPressure: 'Presión intraabdominal alta',
  athlete: 'Deportista',
};
export const CONTEXT_FLAGS = Object.keys(CONTEXT_LABELS) as ContextFlag[];

/** Los confusores marcados con sus rótulos, o «ninguno». */
export function contextText(ctx: VexusContext): string {
  const on = CONTEXT_FLAGS.filter((f) => ctx[f] === true);
  return on.length ? on.map((f) => CONTEXT_LABELS[f]).join(' · ') : 'ninguno';
}

export function territoryText(t: Territory): string {
  return t === 'ivc' ? 'VCI' : t === 'hepatic' ? 'Suprahepática' : t === 'portal' ? 'Porta' : 'Renal';
}

/** Territorios que el contexto vuelve poco fiables: cuentan como no evaluados para el grado. */
export function excludedTerritories(r: VexusResult): Set<Territory> {
  return new Set(r.warnings.filter((w) => w.excluded).map((w) => w.territory));
}

/**
 * Líneas del resultado que añade el contexto clínico (decisión 82): el mVExUS sin riñón, la nota de la VCI a ±2 mm del
 * corte y un aviso por confusor con su territorio y su motivo («no fiable» si el territorio deja de contar; «aviso» si
 * solo avisa). HTML generado por el programa: los motivos son textos fijos del clasificador.
 */
export function contextResultLines(res: VexusResult, modified: VexusResult): string[] {
  const lines = [
    `<div>mVExUS (sin riñón): <b>${gradeValueText(modified)}</b> <span class="small">${resultStatusText(modified, false)}</span></div>`,
  ];
  if (res.ivcNearThreshold)
    lines.push(
      `<div class="small">VCI a ±${IVC_NEAR_THRESHOLD_MM} mm del corte de ${IVC_THRESHOLD_MM} mm: el umbral publicado no es único y el calibrador yerra ~2 mm; no la redondees.</div>`,
    );
  for (const w of res.warnings)
    lines.push(`<div class="ctx-warn"><b>${territoryText(w.territory)} · ${w.excluded ? 'no fiable' : 'aviso'}</b> — ${w.reason}</div>`);
  for (const issue of res.inputIssues)
    lines.push(`<div class="ctx-warn"><b>${territoryText(issue.territory)} · entrada inválida</b> — ${issue.reason}</div>`);
  return lines;
}
