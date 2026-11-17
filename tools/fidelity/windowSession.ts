/**
 * Sesión de navegador de las herramientas de ventana (`window-plates.ts`, `window-parity.ts`, `tissue-map.ts`): abre la
 * aplicación que ya sirve alguien (no arranca ni construye nada), espera a los ganchos de prueba, lleva la sonda a una ventana
 * por la interfaz como haría el alumno y, al acabar, dice lo que la página informó por error. Necesita el Chromium de Playwright
 * (`npx playwright install chromium`) y un servidor con los ganchos: el de desarrollo (`npm run dev`) o una build con `?e2e=app`.
 */
import { chromium, type Page } from '@playwright/test';
import { startPointsFor } from '../../src/app/startPoints';
import { UsageError } from '../toolArgs';

/** Plazo de cada espera (ms). Lo domina la compilación de los programas GLSL al arrancar; solo detecta un cuelgue. */
const HANG_MS = 300_000;
/** Cuadros del bucle tras adquirir la pose: los que la persistencia necesita como mucho para dejar < 1 % de la vista anterior. */
const SETTLE_FRAMES = 30;
const GPU_ARGS =
  process.platform === 'darwin'
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--enable-gpu', '--ignore-gpu-blocklist'];

export interface WindowSession {
  page: Page;
  /** Ventanas del menú de la persona cargada, en su orden. */
  windows: string[];
  /** GPU que dibuja la página (`UNMASKED_RENDERER_WEBGL`): con SwiftShader las cifras de la GPU no son las de un equipo real. */
  renderer: string;
}

/**
 * Abre `url` en Chromium con GPU, espera a que el bucle de la aplicación corra con los ganchos y ejecuta `run`. Los errores de
 * página, de consola y del registro de la aplicación (`errorLog`) se imprimen al cerrar y dejan el código de salida en 1.
 */
export async function withWindowSession<T>(url: string, run: (session: WindowSession) => Promise<T>): Promise<T> {
  if (!URL.canParse(url)) throw new UsageError(`«${url}» no es una URL; por ejemplo 'http://localhost:6600/?person=s0028'`);
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: GPU_ARGS });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(HANG_MS);
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    try {
      await page.goto(url);
    } catch (cause) {
      throw new UsageError(`No se pudo abrir ${url}: ¿está el servidor en marcha (npm run dev)? ${String(cause)}`, { cause });
    }
    try {
      await page.waitForFunction(() => (window.__vexusTest?.framesRendered() ?? 0) > 20, undefined, { polling: 500 });
    } catch (cause) {
      throw new Error(
        `${url} no llegó a 20 cuadros con los ganchos de prueba (window.__vexusTest) en ${HANG_MS / 1000} s: ` +
          `sirve el servidor de desarrollo o una build abierta con ?e2e=app. ${String(cause)}`,
        { cause },
      );
    }
    const scene = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        windows: [...document.querySelectorAll<HTMLElement>('[data-window]')].map((card) => card.dataset.window ?? ''),
        renderer: gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'desconocida',
      };
    });
    const result = await run({ page, ...scene });
    errors.push(...(await page.evaluate(() => window.__vexusTest!.loggedErrors())).map((entry) => `errorLog: ${entry}`));
    return result;
  } finally {
    if (errors.length) {
      console.error(`La página informó ${errors.length} error(es):\n${errors.join('\n')}`);
      process.exitCode = 1;
    }
    await browser.close();
  }
}

/**
 * Pulsa la tarjeta de la ventana `id` y espera a que la sonda y la imagen mostrada estén en su pose de inicio y a que la
 * persistencia se asiente. Se espera en cuadros del bucle, no en segundos: un cuadro tarda lo que tarde la GPU.
 */
export async function selectWindow({ page, windows }: WindowSession, id: string): Promise<void> {
  if (!windows.includes(id)) throw new UsageError(`Ventana desconocida: ${id}. Las de esta persona: ${windows.join(', ')}`);
  const loaded = await page.evaluate(() => {
    const scene = window.__vexusTest!.sim().scene;
    return { person: scene.identity.person, a: scene.torso.a, b: scene.torso.b, profileLength: scene.torso.profile?.length };
  });
  const profile = loaded.profileLength === undefined ? undefined : new Float32Array(loaded.profileLength);
  const start = startPointsFor({ a: loaded.a, b: loaded.b, profile }, { person: loaded.person }).find((point) => point.id === id);
  if (!start) throw new Error(`La ventana ${id} está en el menú pero no entre las poses de inicio de ${loaded.person}`);
  await page.locator(`[data-window="${id}"]`).click();
  // El puntero sale de la tarjeta y queda sobre la imagen, como al explorar.
  await page.locator('#gl').hover();
  await page.waitForFunction(
    (target) => {
      const sim = window.__vexusTest!.sim(),
        shown = sim.renderer.displayedAnatomy?.pose;
      return (
        shown !== undefined &&
        (Object.keys(target) as (keyof typeof target)[]).every(
          (key) => Math.abs(sim.pose[key] - target[key]) < 1e-10 && Math.abs(shown[key] - target[key]) < 1e-10,
        )
      );
    },
    { phi: start.phi, z: start.z, yaw: start.yaw, rock: start.rock ?? 0, tilt: start.tilt ?? 0, lift: 0 },
    { polling: 250 },
  );
  const acquired = await page.evaluate(() => window.__vexusTest!.framesRendered());
  await page.waitForFunction((frame) => window.__vexusTest!.framesRendered() >= frame, acquired + SETTLE_FRAMES, { polling: 250 });
}
