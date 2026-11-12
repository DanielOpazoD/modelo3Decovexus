import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { prepareGlslMangle, readSources, transformWithMangle } from '../../tools/build/glslMinify';
import { packGlslTemplates } from '../../tools/build/glslPacking';
import { bindingNames, compactBindings } from '../../tools/build/glslUniformNames';
import abi from '../../tools/build/fixtures/person-glsl-abi.json';
import { personBindingAbi, personShaderAbi } from '../../tools/build/personShaderAbi';
import type { personShader } from '../anatomy/gpu/personShader';
import { S0028_BUNDLE } from '../anatomy/people/s0028/descriptor';
import baseline from './fixtures/person-shaders-main.json';
import scanConvertRevision from './fixtures/scanconvert-axial-334.json';
import renalRevision from './fixtures/renal-shaders-339.json';
import renalInterior from './fixtures/s0028-renal-interior-shaders.json';
import { loadShaderGraph } from './support/shaderGraph';

const root = process.cwd();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function programs(privateExtension = false) {
  const sources = readSources(join(root, 'src'));
  if (privateExtension)
    sources.push({
      path: join(root, 'src/anatomy/people/s0028/private-extension.ts'),
      code: 'export const shader = /* glsl */ `uniform float uAAbdominalPrivate; float privateS28(float x) { return x; }`;',
    });
  const code = new Map(sources.map((s) => [s.path, s.code]));
  const mangle = personShaderAbi(prepareGlslMangle(sources));
  const all = sources.map((s) => s.code).join('\n');
  const bindings = personBindingAbi(bindingNames(all), all);
  const transforms = {
    source: (_path: string, text: string) => text,
    productionTransforms: (path: string, text: string) =>
      packGlslTemplates(compactBindings(transformWithMangle(text, path, mangle, { compact: true }), bindings), path, root),
  };
  return Object.fromEntries(
    Object.entries(transforms).map(([mode, transform]) => {
      const shaders = loadShaderGraph(join(root, 'src/ultrasound/shaders/passes.glsl.ts'), code, transform);
      const specialize = loadShaderGraph(join(root, 'src/anatomy/gpu/personShader.ts'), code, transform)
        .personShader as typeof personShader;
      return [
        mode,
        Object.fromEntries(
          Object.entries(shaders)
            .filter(([name, value]) => /^(FRAG_\w+|VERT)$/.test(name) && typeof value === 'string')
            .map(([name, value]) => [
              name,
              { default: hash(value as string), s0028: hash(specialize(value as string, { person: 's0028', bundle: S0028_BUNDLE })) },
            ]),
        ),
      ];
    }),
  );
}

it('conserva los programas de main salvo G334, la anatomía/A0 339 y el interior renal s0028, fuente y transformados', () => {
  expect(abi.base).toBe(baseline.base);
  expect(abi.base).toMatch(/^[0-9a-f]{40}$/);
  const result = programs();
  for (const mode of ['source', 'productionTransforms'] as const) {
    expect(Object.keys(result[mode])).toHaveLength(40);
    const previous: Record<string, { default: string; s0028: string }> = {
      ...Object.fromEntries(
        baseline[mode].programs.map((p) => [
          p.name,
          p.name === 'FRAG_SCANCONVERT' ? scanConvertRevision[mode] : { default: p.sha256, s0028: p.s0028Sha256 },
        ]),
      ),
      ...renalRevision[mode],
    };
    // Mantenimiento: tras un cambio deliberado del GLSL de s0028, `VEXUS_UPDATE_S0028_SHADERS=1 npx vitest run
    // src/validation/personShaders.test.ts` reescribe la revisión s0028 con los programas que difieren de main. Los default no
    // se tocan: la aserción de abajo los sigue comparando con los de antes.
    if (process.env.VEXUS_UPDATE_S0028_SHADERS) {
      const revision = renalInterior as Record<string, Record<string, { default: string; s0028: string }>>;
      revision[mode] = Object.fromEntries(
        Object.entries(result[mode])
          .filter(([name, value]) => value.s0028 !== previous[name].s0028)
          .map(([name, value]) => [name, { default: previous[name].default, s0028: value.s0028 }]),
      );
      writeFileSync(join(root, 'src/validation/fixtures/s0028-renal-interior-shaders.json'), JSON.stringify(revision, null, 2) + '\n');
    }
    // El interior renal (decisión 341) sólo cambia los programas s0028 que clasifican: sus default son los de antes.
    for (const [name, value] of Object.entries(renalInterior[mode])) expect(value.default, name).toBe(previous[name].default);
    expect(result[mode]).toEqual({ ...previous, ...renalInterior[mode] });
  }
});

it('un uniform/símbolo privado nuevo no altera ningún programa default', () => {
  expect(programs(true)).toEqual(programs());
});
