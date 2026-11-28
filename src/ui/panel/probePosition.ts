import { blindCaseNames, caseDisplayLabel } from '../../app/blindMode';
import { probePositionText } from '../../app/probePosition';
import { button, note, row } from '../controls';
import type { PanelContext } from './context';

/** Copia desde el gesto del usuario; si falla, ofrece el mismo texto para selección manual. */
export function buildProbePositionCopy(ctx: PanelContext, parent: HTMLElement): void {
  const actions = row(parent);
  const copy = button(actions, 'Copiar posición', () => {
    void writePosition();
  });
  ctx.track(button(actions, 'Reiniciar sonda', () => ctx.setPose({ ...ctx.sim().pose, yaw: 0, rock: 0, tilt: 0, lift: 0 })));
  const status = note(parent);
  status.setAttribute('role', 'status');
  const manual = document.createElement('textarea');
  manual.className = 'probe-position-text';
  manual.readOnly = true;
  manual.hidden = true;
  manual.rows = 5;
  manual.setAttribute('aria-label', 'Posición y ajustes para copiar manualmente');
  parent.appendChild(manual);
  copy.el.title = 'Copia la posición y los ajustes actuales de la sonda; el cine congelado puede pertenecer a otra adquisición.';

  async function writePosition(): Promise<void> {
    const s = ctx.sim();
    const { person, revision } = s.scene.identity;
    // Con ?alumno el id nombra el diagnóstico (decisiones 82 y 393): se copia el rótulo que ve el alumno.
    const blind = blindCaseNames(globalThis.location?.search ?? '') && !ctx.store.get().debug;
    // Se serializa al pulsar, antes de esperar al portapapeles: el examen vivo puede seguir moviéndose.
    const text = probePositionText({
      source: {
        version: __APP_VERSION__,
        commit: __GIT_COMMIT__,
        buildTime: __BUILD_TIME__,
        // s0028 y `?abdomen=atlas` traen los dos atlas abdominal, pero son cuerpos distintos (decisión 340).
        anatomy: person === 's0028' ? 's0028' : s.scene.hasAbdominalAtlas ? 'atlas' : s.scene.torso.profile ? 'reference' : 'legacy',
        revision,
        transducer: s.profile.id,
      },
      pose: s.pose,
      equipment: s.equipment,
      context: {
        caseId: blind ? caseDisplayLabel(s.patient.id, false) : s.patient.id,
        seed: s.patient.seed,
        respiration: s.patient.respiratoryPattern,
        timeS: s.physiology.clock.t,
        mode: ctx.store.get().mode,
        frozen: s.frozen,
      },
    });
    const frozen = s.frozen;
    copy.el.disabled = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      manual.hidden = true;
      status.textContent = frozen ? 'Posición actual copiada. La imagen está congelada.' : 'Posición copiada.';
    } catch {
      manual.value = text;
      manual.hidden = false;
      manual.focus();
      manual.select();
      status.textContent = 'Copia el texto seleccionado con ⌘C o Ctrl+C. Corresponde a los mandos actuales.';
    } finally {
      copy.el.disabled = false;
    }
  }
}
