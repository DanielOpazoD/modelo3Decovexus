import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPOSITORY_ENV, withoutRepositoryEnv } from './support/gitEnvironment';

const project = resolve(import.meta.dirname, '../..');
const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
/** Sólo lectura: qué repositorio ve Git desde `cwd` con ese entorno. */
const gitDir = (cwd: string, env: NodeJS.ProcessEnv) => {
  const result = spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd, env, encoding: 'utf8', timeout: 5_000 });
  return result.status === 0 ? realpathSync(result.stdout.trim()) : null;
};

describe('Las pruebas no heredan el repositorio de quien las lanza', () => {
  it('el proceso de pruebas arranca sin las variables que redirigen a otro repositorio', () => {
    for (const key of REPOSITORY_ENV) expect(process.env[key], key).toBeUndefined();
  });

  it('quita sólo las variables de repositorio y conserva el resto del entorno', () => {
    const clean = withoutRepositoryEnv({
      PATH: '/bin',
      GIT_AUTHOR_NAME: 'Autora',
      GIT_DIR: '/otro/.git',
      GIT_WORK_TREE: '/otro',
      GIT_INDEX_FILE: '/otro/.git/index',
    });
    expect(clean).toEqual({ PATH: '/bin', GIT_AUTHOR_NAME: 'Autora' });
  });

  it('con GIT_DIR heredado, un repositorio temporal resolvería al real; con el entorno limpio, a sí mismo', () => {
    const root = mkdtempSync(join(tmpdir(), 'vexus-git-env-'));
    temporary.push(root);
    expect(spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root, env: process.env, timeout: 5_000 }).status).toBe(0);
    const real = gitDir(project, process.env);
    expect(real).not.toBeNull();
    // Como en un gancho lanzado desde un worktree: GIT_DIR apunta al repositorio del proyecto.
    const inherited = { ...process.env, GIT_DIR: real! };
    // Control negativo (sólo lectura): así es como una prueba acababa escribiendo en el repositorio real.
    expect(gitDir(root, inherited)).toBe(real);
    expect(gitDir(root, withoutRepositoryEnv(inherited))).toBe(realpathSync(join(root, '.git')));
  });
});
