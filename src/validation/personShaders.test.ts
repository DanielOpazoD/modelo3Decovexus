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
import pinned from './fixtures/shader-hashes.json';
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
              {
                default: hash(value as string),
                s0028: hash(specialize(value as string, { person: 's0028', bundle: S0028_BUNDLE })),
              },
            ]),
        ),
      ];
    }),
  );
}

type Hashes = Record<string, { default: string; s0028: string }>;
const MODES = ['source', 'productionTransforms'] as const;
let current: ReturnType<typeof programs> | undefined;
/** Los 40 programas ensamblados una sola vez por archivo: cada ensamblado tarda varios segundos. */
const now = () => (current ??= programs());

it('los 40 programas, default y s0028, fuente y transformados, son los de la foto vigente (decisión 414)', () => {
  expect(abi.base).toMatch(/^[0-9a-f]{40}$/);
  const result = now();
  // Mantenimiento, tras un cambio DELIBERADO de GLSL: `VEXUS_UPDATE_SHADER_HASHES=s0028 npx vitest run
  // src/validation/personShaders.test.ts` reescribe solo las huellas de s0028 (las default se siguen comparando con las de antes:
  // un cambio de la persona no puede tocar los programas default); `VEXUS_UPDATE_SHADER_HASHES=all` reescribe las dos. El diff de la
  // foto en la PR dice qué programas cambiaron. Procedimiento completo: docs/engineering/cambio-glsl.md.
  const update = process.env.VEXUS_UPDATE_SHADER_HASHES;
  if (update) {
    if (update !== 's0028' && update !== 'all') throw new Error('VEXUS_UPDATE_SHADER_HASHES admite «s0028» o «all»');
    const next = Object.fromEntries(
      MODES.map((mode) => [
        mode,
        Object.fromEntries(
          Object.entries(result[mode]).map(([name, value]) => [
            name,
            { default: update === 'all' ? value.default : ((pinned[mode] as Hashes)[name]?.default ?? value.default), s0028: value.s0028 },
          ]),
        ),
      ]),
    );
    writeFileSync(join(root, 'src/validation/fixtures/shader-hashes.json'), JSON.stringify(next, null, 2) + '\n');
    for (const mode of MODES) (pinned as Record<string, Hashes>)[mode] = next[mode];
  }
  for (const mode of MODES) {
    expect(Object.keys(result[mode])).toHaveLength(40);
    expect(result[mode]).toEqual(pinned[mode]);
  }
});

it('la foto distingue a la persona: los programas que clasifican difieren entre default y s0028, y el resto no', () => {
  // Con dientes: si la especialización de s0028 dejara de aplicarse (o se aplicara a todo), la foto anterior seguiría «pasando»
  // tras una actualización a ciegas. Medido el 16-11-2026: 25 de los 40 programas llevan la anatomía de la persona.
  const source = pinned.source as Hashes;
  const specialized = Object.values(source).filter((p) => p.default !== p.s0028).length;
  expect(specialized).toBe(25);
  expect(source.VERT.default).toBe(source.VERT.s0028);
});

it('un uniform/símbolo privado nuevo no altera ningún programa default', () => {
  expect(programs(true)).toEqual(now());
});
