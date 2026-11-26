import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { feedbackGitEnvironment } from '../../tools/workspace/feedbackPlan';

const dir = resolve(import.meta.dirname, '../../.github/workflows');
const workflows = readdirSync(dir)
  .filter((file) => file.endsWith('.yml'))
  .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));

/** Cabecera del flujo y texto de cada job (claves con dos espacios bajo `jobs:`), sin parser YAML. */
function jobsOf(text: string): { header: string; jobs: Record<string, string> } {
  const [header, body = ''] = text.split(/^jobs:\s*$/m);
  const jobs: Record<string, string> = {};
  for (const chunk of body.split(/^(?= {2}[\w-]+:\s*$)/m)) {
    const name = /^ {2}([\w-]+):/.exec(chunk)?.[1];
    if (name) jobs[name] = chunk;
  }
  return { header, jobs };
}
const WRITES = /^\s+[\w-]+:\s*write\s*$|write-all/m;

describe('Permisos y credenciales de los flujos de GitHub', () => {
  it('ningún checkout deja el token en la configuración de git', () => {
    let checkouts = 0;
    for (const { file, text } of workflows)
      for (const step of text.split(/uses: actions\/checkout@\S+/).slice(1)) {
        checkouts++;
        expect(step.split(/^\s+- /m)[0], file).toMatch(/^\s+persist-credentials: false\s*$/m);
      }
    expect(checkouts).toBeGreaterThan(0);
  });

  it('solo el job `publish` de release.yml escribe, y no ejecuta código del repositorio ni de npm', () => {
    const writers: string[] = [];
    for (const { file, text } of workflows) {
      const { header, jobs } = jobsOf(text);
      expect(header, file).not.toMatch(WRITES);
      for (const [name, job] of Object.entries(jobs))
        if (WRITES.test(job)) {
          writers.push(file + ' ' + name);
          expect(job, file + ' ' + name).not.toMatch(/actions\/checkout|setup-node|\bnpm\b|\bnpx\b|\bnode\b|\btsx\b/);
        }
    }
    expect(writers).toEqual(['release.yml publish']);
  });
});

const release = jobsOf(readFileSync(join(dir, 'release.yml'), 'utf8'));
const GUARD = 'El tag apunta a la historia principal de main con su CI completa en verde';

/** El bloque `run: |` del paso `name`, sin su sangría. */
function script(job: string, name: string): string {
  const lines = (job.split('name: ' + name)[1] ?? '').split('\n');
  const start = lines.findIndex((line) => /^\s+run: \|\s*$/.test(line));
  expect(start, name).toBeGreaterThan(0);
  const indent = /^ */.exec(lines[start + 1])![0].length;
  const end = lines.findIndex((line, i) => i > start && line.trim() !== '' && line.search(/\S/) < indent);
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .map((line) => line.slice(indent))
    .join('\n');
}

describe('Release: solo un commit de main con su propia CI en verde', () => {
  it('build comprueba main y la CI antes de instalar nada; la release la crea otro job sin crear el tag', () => {
    expect(Object.keys(release.jobs)).toEqual(['build', 'publish']);
    const { build, publish } = release.jobs;
    expect(release.header).toMatch(/^\s+actions: read\s*$/m);
    expect(build).toMatch(/^\s+fetch-depth: 0\s*$/m);
    const guard = build.indexOf('name: ' + GUARD);
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(build.indexOf('run: npm ci'));
    expect(build.indexOf('run: npm ci')).toBeLessThan(build.indexOf('run: npm run build'));
    expect(build).not.toContain('gh release create');
    expect(publish).toMatch(/^\s+needs: build\s*$/m);
    expect(publish).toContain('gh release create "${GITHUB_REF_NAME}"');
    expect(publish).toContain('--verify-tag');
  });

  it('la guarda rechaza la punta de una rama fusionada con merge commit y un commit de main sin su CI en verde', () => {
    const root = mkdtempSync(join(tmpdir(), 'vexus-release-'));
    const repo = join(root, 'repo');
    const env = feedbackGitEnvironment();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
    // `gh` simulado: guarda sus argumentos y responde cuántos runs propios de ci.yml hay en verde.
    writeFileSync(join(root, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$GH_ARGS"\necho "$GREEN_RUNS"\n');
    chmodSync(join(root, 'gh'), 0o755);
    const guard = (sha: string, greenRuns: number) => {
      git('switch', '-q', '--detach', sha);
      return spawnSync('bash', ['-e', '-c', script(release.jobs.build, GUARD)], {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...env,
          PATH: root + ':' + process.env.PATH,
          GITHUB_REF_NAME: 'v9.9.9',
          GH_ARGS: join(root, 'args'),
          GREEN_RUNS: String(greenRuns),
        },
      });
    };
    try {
      mkdirSync(repo);
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'Release fixture');
      git('config', 'user.email', 'fixture@example.invalid');
      git('commit', '-q', '--allow-empty', '-m', 'base');
      git('switch', '-q', '-c', 'chore/release');
      git('commit', '-q', '--allow-empty', '-m', 'chore(release): 9.9.9');
      const tip = git('rev-parse', 'HEAD');
      git('switch', '-q', 'main');
      git('commit', '-q', '--allow-empty', '-m', 'PR fusionada después de separar la rama de release');
      git('merge', '-q', '--no-ff', '-m', 'Merge pull request', tip);
      const merge = git('rev-parse', 'HEAD');
      git('update-ref', 'refs/remotes/origin/main', merge);
      // Control negativo: la punta es ancestro de main, así que `merge-base --is-ancestor` la dejaría pasar.
      expect(spawnSync('git', ['merge-base', '--is-ancestor', tip, merge], { cwd: repo, env }).status).toBe(0);
      const branchTip = guard(tip, 1);
      expect(branchTip.status).not.toBe(0);
      expect(branchTip.stdout).toContain('v9.9.9 no está en la historia principal de main');
      const red = guard(merge, 0);
      expect(red.status).not.toBe(0);
      expect(red.stdout).toContain('ci.yml no está en verde en ' + merge);
      const green = guard(merge, 1);
      expect(green.status, green.stderr).toBe(0);
      // Un run de pull_request prueba el merge sintético, no este árbol: no cuenta.
      expect(readFileSync(join(root, 'args'), 'utf8').trim().split('\n')).toEqual([
        'run',
        'list',
        '--workflow',
        'ci.yml',
        '--commit',
        merge,
        '--status',
        'success',
        '--json',
        'event',
        '--jq',
        '[.[] | select(.event != "pull_request")] | length',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
