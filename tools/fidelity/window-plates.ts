/**
 * Láminas del modo B de las ventanas pedidas, tal como las ve el alumno: abre la aplicación ya servida, pulsa cada ventana, deja
 * asentar la imagen y guarda la captura del lienzo en `<carpeta>/b-<ventana>.png`. Para poner modelo y TAC del mismo plano lado
 * a lado y para la lámina de antes y después de una PR de imagen. Con el servidor en marcha (`npm run dev`):
 *
 *   node --import tsx tools/fidelity/window-plates.ts 'http://localhost:6600/?person=s0028' .cache/laminas/antes
 *   node --import tsx tools/fidelity/window-plates.ts 'http://localhost:6600/?person=s0028' .cache/laminas/antes portalSubcostal renal
 *
 * Sin ventanas, todas las del menú de la persona cargada. La URL decide la persona y el caso; aquí no se construye ni se
 * arranca nada. Necesita el Chromium de Playwright (`npx playwright install chromium`).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { UsageError, runTool } from '../toolArgs';
import { selectWindow, withWindowSession } from './windowSession';

const USAGE = `Uso: node --import tsx tools/fidelity/window-plates.ts <url> <carpeta> [ventana…]
  url       aplicación ya servida con los ganchos de prueba, p. ej. 'http://localhost:6600/?person=s0028'
  carpeta   dónde se guardan las láminas (se crea); una por ventana: b-<ventana>.png
  ventana   ids del menú (subxiphoid, portalSubcostal, renal…); sin ninguna, todas`;

await runTool(USAGE, async () => {
  const { positionals } = parseArgs({ allowPositionals: true, options: {} });
  const [url, out, ...asked] = positionals;
  if (!url || !out) throw new UsageError('Faltan la URL y la carpeta de salida.');
  await withWindowSession(url, async (session) => {
    const windows = asked.length ? asked : session.windows;
    const unknown = windows.filter((id) => !session.windows.includes(id));
    if (unknown.length)
      throw new UsageError(`Ventanas desconocidas: ${unknown.join(', ')}. Las de esta persona: ${session.windows.join(', ')}`);
    mkdirSync(out, { recursive: true });
    console.log(`GPU: ${session.renderer}`);
    for (const id of windows) {
      await selectWindow(session, id);
      const path = join(out, `b-${id}.png`);
      await session.page.locator('#gl').screenshot({ path });
      console.log(`${id}: ${path}`);
    }
  });
});
