/**
 * DOM mínimo para probar el cableado de la consola en Node (sin jsdom): lo que usan las pestañas y `ui/controls.ts`
 * (crear elementos y texto, hijos, clases, atributos, `hidden`, `checked`, eventos y `innerHTML` guardado tal cual).
 * No interpreta el HTML: una prueba lee el `innerHTML` que la pestaña escribió. La prueba lo pone con
 * `vi.stubGlobal('document', fakeDocument())` y lo retira con `vi.unstubAllGlobals()`.
 */
export class FakeText {
  readonly nodeType = 3;
  parentElement: FakeElement | null = null;
  constructor(public textContent: string) {}
}

type Listener = (e: { type: string; target: FakeElement; stopPropagation(): void }) => void;

export class FakeElement {
  readonly nodeType = 1;
  readonly tagName: string;
  childNodes: Array<FakeElement | FakeText> = [];
  parentElement: FakeElement | null = null;
  className = '';
  id = '';
  hidden = false;
  type = '';
  checked = false;
  disabled = false;
  value = '';
  title = '';
  htmlFor = '';
  private html = '';
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, Listener[]>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
  }

  get classList() {
    const list = () => this.className.split(/\s+/).filter(Boolean);
    const set = (xs: string[]) => (this.className = [...new Set(xs)].join(' '));
    return {
      add: (...c: string[]) => set([...list(), ...c]),
      remove: (...c: string[]) => set(list().filter((x) => !c.includes(x))),
      contains: (c: string) => list().includes(c),
      toggle: (c: string, force?: boolean) => {
        const on = force ?? !list().includes(c);
        set(on ? [...list(), c] : list().filter((x) => x !== c));
        return on;
      },
    };
  }

  /** Texto de los descendientes; si se escribió `innerHTML`, ese HTML sin etiquetas. */
  get textContent(): string {
    if (this.html) return this.html.replace(/<[^>]*>/g, '');
    return this.childNodes.map((n) => n.textContent).join('');
  }

  set textContent(v: string) {
    this.childNodes = [];
    this.html = '';
    if (v) this.appendChild(new FakeText(v));
  }

  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(v: string) {
    this.childNodes = [];
    this.html = v;
  }

  appendChild<T extends FakeElement | FakeText>(c: T): T {
    if (c.parentElement) c.parentElement.childNodes = c.parentElement.childNodes.filter((n) => n !== c);
    c.parentElement = this;
    this.childNodes.push(c);
    return c;
  }

  append(...nodes: Array<FakeElement | FakeText | string>): void {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? new FakeText(n) : n);
  }

  replaceChildren(...nodes: Array<FakeElement | FakeText | string>): void {
    for (const n of this.childNodes) n.parentElement = null;
    this.childNodes = [];
    this.html = '';
    this.append(...nodes);
  }

  setAttribute(k: string, v: string): void {
    this.attrs.set(k, String(v));
  }

  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }

  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }

  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  /** `init` añade campos al evento (p. ej. `detail` de un clic de ratón). */
  dispatch(type: string, init: object = {}): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ type, target: this, stopPropagation: () => undefined, ...init });
  }

  remove(): void {
    if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter((n) => n !== this);
    this.parentElement = null;
  }

  /** El foco es `activeElement` del `document` falso. */
  focus(): void {
    (document as unknown as { activeElement: unknown }).activeElement = this;
  }

  /** El texto de un cuadro no tiene selección en el DOM falso: la prueba lee `value`. */
  select(): void {
    return undefined;
  }

  contains(n: unknown): boolean {
    for (let e = n as FakeElement | null; e; e = e.parentElement) if (e === this) return true;
    return false;
  }

  /** Solo `etiqueta`, `etiqueta.clase` o `etiqueta:enabled`, lo que piden las pestañas. */
  querySelector(selector: string): FakeElement | null {
    const [tagClass, state] = selector.split(':');
    const [tag, cls] = tagClass.split('.');
    return (
      findAll(
        this,
        (e) => e.tagName === tag.toUpperCase() && (!cls || e.classList.contains(cls)) && (state !== 'enabled' || !e.disabled),
      )[0] ?? null
    );
  }

  /** Como el navegador: un clic en una casilla la conmuta y emite `change`. */
  click(): void {
    if (this.tagName === 'INPUT' && this.type === 'checkbox' && !this.disabled) {
      this.checked = !this.checked;
      this.dispatch('click');
      this.dispatch('change');
      return;
    }
    this.dispatch('click');
  }
}

/** Todos los descendientes de `root` (en orden de documento) que cumplen `pred`. */
export function findAll(root: FakeElement, pred: (e: FakeElement) => boolean): FakeElement[] {
  const out: FakeElement[] = [];
  const walk = (e: FakeElement) => {
    for (const c of e.children) {
      if (pred(c)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

/** Un `document` falso para `vi.stubGlobal('document', …)`: las pestañas crean sus nodos con él. */
export function fakeDocument(): {
  body: FakeElement;
  activeElement: FakeElement | null;
  createElement(tag: string): FakeElement;
  createTextNode(text: string): FakeText;
} {
  return {
    body: new FakeElement('body'),
    activeElement: null,
    createElement: (tag: string) => new FakeElement(tag),
    createTextNode: (text: string) => new FakeText(text),
  };
}
