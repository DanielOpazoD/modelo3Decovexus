/**
 * Variables con las que Git redirige a OTRO repositorio, índice u objetos. Git las exporta a sus ganchos cuando se
 * invoca desde una copia de trabajo enlazada (`git worktree`), con `--git-dir` o dentro de `rebase --exec`. Una prueba
 * que crea su repositorio temporal con `git init` y hereda `GIT_DIR` no toca el temporal: reconfigura y hace commits en
 * el repositorio real. El 11-11-2026 un push desde un worktree dejó así `core.bare = true`, una identidad de prueba y
 * un commit «fixture» en la rama de trabajo.
 */
export const REPOSITORY_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
] as const;

/** El mismo entorno sin las variables que apuntan a un repositorio concreto; identidad, editor y demás se conservan. */
export function withoutRepositoryEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const key of REPOSITORY_ENV) delete clean[key];
  return clean;
}
