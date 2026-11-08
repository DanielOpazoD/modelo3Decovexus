/** Diagnóstico local de solo lectura; no abre GPU, instala paquetes ni consulta la red. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (name: string) => readFileSync(resolve(root, name), 'utf8');
const gitTimeoutMs = 2_000;
const git = (...args: string[]) => {
  const result = spawnSync('git', ['--no-optional-locks', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: gitTimeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error && 'code' in result.error && result.error.code === 'ETIMEDOUT')
    throw new Error(`lectura Git excedió ${gitTimeoutMs} ms; el estado no está verificado`);
  if (result.status !== 0 || result.stderr.trim())
    throw new Error(result.error?.message ?? (result.stderr.trim() || `Git terminó con estado ${result.status}`));
  return result.stdout.trim();
};
let failed = false;
function check(label: string, action: () => string) {
  try {
    console.log(`OK ${label}: ${action()}`);
  } catch (error) {
    failed = true;
    console.error(`FALLO ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`VExUS · entorno local\nRaíz: ${root}`);
check('Node', () => {
  const expected = read('.nvmrc').trim();
  if (process.versions.node.split('.')[0] !== expected)
    throw new Error(`${process.version}; usa tools/workspace/run.sh npm run workspace:doctor (Node ${expected})`);
  return process.version;
});
check('Git', () => `${git('branch', '--show-current') || 'HEAD separado'} · ${git('rev-parse', '--short', 'HEAD')}`);
check('árbol de trabajo', () => git('status', '--short') || 'limpio');
check('referencias Git', () => {
  const refs = git('for-each-ref', '--format=%(refname) %(objectname)');
  return `${refs ? refs.split('\n').length : 0} referencias legibles`;
});
check('objetos alcanzables de HEAD', () => {
  const objects = git('rev-list', '--objects', '--no-object-names', '--missing=print', 'HEAD').split('\n');
  const missing = objects.filter((object) => object.startsWith('?'));
  if (missing.length) throw new Error(`${missing.length} objetos ausentes: ${missing.slice(0, 5).join(', ')}`);
  return `${objects.length} objetos presentes; no sustituye un fsck completo`;
});
check('main local / origin/main', () => {
  const counts = git('rev-list', '--left-right', '--count', 'main...origin/main').split(/\s+/);
  return `main tiene ${counts[0]} commits propios y ${counts[1]} pendientes; origin/main es una referencia local, no una consulta remota`;
});
check('hook pre-push', () => {
  const configured = git('config', '--get', 'core.hooksPath');
  if (resolve(root, configured) !== resolve(root, '.githooks') || !existsSync(resolve(root, '.githooks/pre-push')))
    throw new Error('se requiere .githooks; npm ci ejecuta prepare');
  return '.githooks (formato, lint, tipos y pruebas rápidas)';
});
check('dependencias instaladas / lockfile', () => {
  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version: string }> };
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const mismatches = names.filter((name) => {
    const installed = resolve(root, 'node_modules', name, 'package.json');
    return (
      !existsSync(installed) ||
      (JSON.parse(readFileSync(installed, 'utf8')) as { version: string }).version !== lock.packages[`node_modules/${name}`]?.version
    );
  });
  if (mismatches.length) throw new Error(`${mismatches.join(', ')}; ejecutar npm ci`);
  return `${names.length} paquetes directos coinciden con el lockfile`;
});
check('Chromium de Playwright', () => {
  const require = createRequire(import.meta.url);
  const { chromium } = require('@playwright/test') as { chromium: { executablePath(): string } };
  const executable = chromium.executablePath();
  if (!existsSync(executable)) throw new Error('no instalado; npx playwright install chromium');
  return executable;
});
console.log('Los puertos, las pestañas y la CI se comprueban al usarlos; un informe histórico no acredita disponibilidad actual.');
console.log('No se ha ejecutado build, test, instalación ni navegador. Guía: docs/engineering/workspace.md');
process.exitCode = failed ? 1 : 0;
