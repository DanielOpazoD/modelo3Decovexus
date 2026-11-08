import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const project = resolve(import.meta.dirname, '../..');
const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
function git(root: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 2_000 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message);
  return result.stdout.trim();
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vexus-doctor-'));
  temporary.push(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Diagnostic fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'README.md'), 'Contenido local preservado\n');
  git(root, 'add', 'README.md');
  git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFileSync(join(root, '.git/info/exclude'), '*\n');
  mkdirSync(join(root, 'tools/workspace'), { recursive: true });
  copyFileSync(join(project, 'tools/workspace/doctor.ts'), join(root, 'tools/workspace/doctor.ts'));
  writeFileSync(join(root, '.nvmrc'), process.versions.node.split('.')[0]);
  writeFileSync(join(root, 'package.json'), '{"type":"module","dependencies":{},"devDependencies":{}}');
  writeFileSync(join(root, 'package-lock.json'), '{"packages":{}}');
  return root;
}
function doctor(root: string, path = process.env.PATH) {
  return spawnSync(process.execPath, ['tools/workspace/doctor.ts'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: path },
    timeout: 8_000,
    killSignal: 'SIGKILL',
  });
}

describe('El diagnóstico distingue Git limpio de Git legible', () => {
  it('comprueba referencias y objetos de un repositorio real sin modificar índice ni archivos', () => {
    const root = fixture();
    const before = readFileSync(join(root, '.git/index'));
    const result = doctor(root);
    expect(result.stdout).toContain('OK referencias Git: 2 referencias legibles');
    expect(result.stdout).toContain('OK objetos alcanzables de HEAD: 3 objetos presentes');
    expect(result.stderr).not.toContain('FALLO referencias Git');
    expect(readFileSync(join(root, '.git/index'))).toEqual(before);
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('Contenido local preservado\n');
  });
  it('rechaza el blob ausente aunque status siga limpio y el archivo de trabajo esté intacto', () => {
    const root = fixture();
    const blob = git(root, 'rev-parse', 'HEAD:README.md');
    rmSync(join(root, '.git/objects', blob.slice(0, 2), blob.slice(2)));
    expect(git(root, 'status', '--porcelain=v1')).toBe('');
    const result = doctor(root);
    expect(result.stdout).toContain('OK árbol de trabajo: limpio');
    expect(result.stderr).toContain('FALLO objetos alcanzables de HEAD: 1 objetos ausentes');
    expect(result.stderr).toContain(blob);
    expect(result.status).toBe(1);
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('Contenido local preservado\n');
  });
  it('no oculta una referencia rota que Git descarta con un aviso', () => {
    const root = fixture();
    writeFileSync(join(root, '.git/refs/heads/broken'), 'not-an-object\n');
    const result = doctor(root);
    expect(result.stderr).toContain('FALLO referencias Git');
    expect(result.stderr).toContain('broken');
    expect(readFileSync(join(root, '.git/refs/heads/broken'), 'utf8')).toBe('not-an-object\n');
  });
  it('termina la lectura bloqueada y conserva las comprobaciones posteriores', () => {
    const root = fixture();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
    const executable = join(bin, 'git');
    writeFileSync(
      executable,
      `#!${process.execPath}
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args.includes('for-each-ref')) setInterval(() => {}, 1000);
else { const r = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' }); process.exit(r.status ?? 1); }
`,
    );
    chmodSync(executable, 0o755);
    const result = doctor(root, [bin, dirname(process.execPath), process.env.PATH].join(':'));
    expect(result.error).toBeUndefined();
    expect(result.stderr).toContain('FALLO referencias Git: lectura Git excedió 2000 ms');
    expect(result.stdout).toContain('OK objetos alcanzables de HEAD: 3 objetos presentes');
    expect(result.status).toBe(1);
  });
});
