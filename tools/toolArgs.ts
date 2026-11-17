/**
 * Argumentos de las herramientas de línea de órdenes de diseño y fidelidad (`docs/engineering/herramientas.md`): un error de
 * quien la invoca se distingue de un fallo de la herramienta, y los valores con forma (rangos, JSON, enteros) se validan aquí.
 */
import { existsSync, readFileSync } from 'node:fs';

/** Error de quien invoca (argumentos, archivos, ids): la herramienta imprime el mensaje y su uso y sale con 2, sin traza. */
export class UsageError extends Error {}

const isUsageError = (error: unknown): error is Error =>
  error instanceof UsageError || (error instanceof Error && String((error as NodeJS.ErrnoException).code).startsWith('ERR_PARSE_ARGS'));

/**
 * Corre una herramienta: `--help` o `-h` imprimen `usage`; un `UsageError` o un error de `node:util.parseArgs` imprimen el
 * mensaje y `usage` y dejan el código de salida en 2. Cualquier otro error sigue su camino con su traza.
 */
export async function runTool(
  usage: string,
  main: () => void | Promise<void>,
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage);
    return;
  }
  try {
    await main();
  } catch (error) {
    if (!isUsageError(error)) throw error;
    console.error(`${error.message}\n\n${usage}`);
    process.exitCode = 2;
  }
}

/** `desde:hasta` o `desde:hasta:paso` → números finitos, con desde ≤ hasta y paso > 0. */
export function parseRange(text: string, option: string, parts: 2 | 3): number[] {
  const values = text.split(':').map((part) => (part.trim() === '' ? Number.NaN : Number(part)));
  if (values.length !== parts || !values.every(Number.isFinite) || values[0] > values[1] || (parts === 3 && values[2] <= 0))
    throw new UsageError(
      `${option}: se espera ${parts === 2 ? 'desde:hasta' : 'desde:hasta:paso'} y llegó «${text}». ` +
        `Un valor que empieza por menos va pegado con «=»: ${option}=-10:60${parts === 3 ? ':5' : ''}`,
    );
  return values;
}

/** Un entero ≥ `min` de una opción. */
export function parseCount(text: string, option: string, min = 1): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < min) throw new UsageError(`${option}: se espera un entero ≥ ${min} y llegó «${text}»`);
  return value;
}

/** Un argumento JSON: el texto mismo si empieza por `[` o `{`; si no, la ruta de un archivo. */
export function readJsonArgument(spec: string, what: string): unknown {
  const inline = /^\s*[[{]/.test(spec);
  if (!inline && !existsSync(spec)) throw new UsageError(`${what}: «${spec}» no es JSON ni un archivo que exista`);
  try {
    return JSON.parse(inline ? spec : readFileSync(spec, 'utf8'));
  } catch (cause) {
    throw new UsageError(`${what}: JSON inválido en ${inline ? 'el argumento' : spec} (${String(cause)})`, { cause });
  }
}
