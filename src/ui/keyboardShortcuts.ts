import { toggleM, toggleMode, type EquipmentCommand } from '../app/equipment';
import type { Store } from '../app/store';
import { appKey } from './keyRouting';
import { tabAfterMode } from './panel';

/**
 * Atajos de teclado (misma familia que EchoTwin): 2 / M / C / P modos (C y P alternan su función y
 * conservan la otra: tríplex, decisión 66; M, el modo M, decisión 80), Espacio
 * congela, H oculta el navegador, Esc cancela la herramienta y, con `cancel`, el punto pendiente del calibrador (el de
 * ⌘/Ctrl+clic no arma ninguna), [ ] profundidad, − + ganancia. Qué teclas llegan aquí lo decide `appKey` (con el
 * deslizador del cine enfocado, Espacio descongela).
 */
export function bindKeyboardShortcuts(store: Store, dispatch: (cmd: EquipmentCommand) => void, cancel = () => {}): () => void {
  const handler = (e: KeyboardEvent): void => {
    if (!appKey(e)) return;
    switch (e.key) {
      case '2':
        store.set({ mode: 'B', tab: tabAfterMode('B', store.get().tab) });
        break;
      case 'm':
      case 'M': {
        const mode = toggleM(store.get().mode);
        store.set({ mode, tab: tabAfterMode(mode, store.get().tab) });
        break;
      }
      case 'c':
      case 'C':
      case 'p':
      case 'P': {
        const mode = toggleMode(store.get().mode, e.key.toLowerCase() === 'c' ? 'color' : 'pw');
        store.set({ mode, tab: tabAfterMode(mode, store.get().tab) });
        break;
      }
      case ' ':
        store.set({ frozen: !store.get().frozen });
        e.preventDefault();
        break;
      case 'h':
      case 'H':
        store.set({ torso: !store.get().torso });
        break;
      case 'Escape':
        cancel();
        store.set({ tool: 'none' });
        break;
      case '[':
        dispatch({ type: 'stepDepth', deltaMm: -10 });
        break;
      case ']':
        dispatch({ type: 'stepDepth', deltaMm: 10 });
        break;
      case '-':
        dispatch({ type: 'stepGain', deltaDb: -2 });
        break;
      case '+':
      case '=':
        dispatch({ type: 'stepGain', deltaDb: 2 });
        break;
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
