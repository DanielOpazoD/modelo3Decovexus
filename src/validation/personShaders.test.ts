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
import tubeCapacity from './fixtures/tube-capacity-402-shaders.json';
import heartBeat from './fixtures/heart-beat-410-shaders.json';
import gallbladder from './fixtures/gallbladder-413-shaders.json';
import { gallbladderBefore413 } from '../../tools/build/gallbladderBefore413';
import { heartBefore410 } from '../../tools/build/heartBefore410';
import { layoutBefore402 } from '../../tools/build/layoutBefore402';
import { loadShaderGraph } from './support/shaderGraph';

const root = process.cwd();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function programs(privateExtension = false, rewrite: (text: string) => string = (text) => text) {
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
                default: hash(rewrite(value as string)),
                s0028: hash(rewrite(specialize(value as string, { person: 's0028', bundle: S0028_BUNDLE }))),
              },
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
    const before402: Record<string, { default: string; s0028: string }> = { ...previous, ...renalInterior[mode] };
    // Mantenimiento de la revisión 402 (capacidad de tubos): `VEXUS_UPDATE_TUBE_CAPACITY_SHADERS=1` la reescribe con los programas
    // que difieren de los de antes; la prueba de abajo comprueba que la diferencia es solo de constantes de disposición.
    if (process.env.VEXUS_UPDATE_TUBE_CAPACITY_SHADERS) {
      const revision = tubeCapacity as Record<string, Record<string, { default: string; s0028: string }>>;
      revision[mode] = Object.fromEntries(
        Object.entries(result[mode]).filter(
          ([name, value]) => value.default !== before402[name].default || value.s0028 !== before402[name].s0028,
        ),
      );
      writeFileSync(join(root, 'src/validation/fixtures/tube-capacity-402-shaders.json'), JSON.stringify(revision, null, 2) + '\n');
    }
    const before410: Record<string, { default: string; s0028: string }> = { ...before402, ...tubeCapacity[mode] };
    // Mantenimiento de la revisión 410 (latido de los ventrículos): `VEXUS_UPDATE_HEART_BEAT_SHADERS=1` la reescribe con los
    // programas que difieren de los de antes; la prueba de abajo comprueba que la diferencia es solo la del corazón.
    if (process.env.VEXUS_UPDATE_HEART_BEAT_SHADERS) {
      const revision = heartBeat as Record<string, Record<string, { default: string; s0028: string }>>;
      revision[mode] = Object.fromEntries(
        Object.entries(result[mode]).filter(
          ([name, value]) => value.default !== before410[name].default || value.s0028 !== before410[name].s0028,
        ),
      );
      writeFileSync(join(root, 'src/validation/fixtures/heart-beat-410-shaders.json'), JSON.stringify(revision, null, 2) + '\n');
    }
    const before413: Record<string, { default: string; s0028: string }> = { ...before410, ...heartBeat[mode] };
    // Mantenimiento de la revisión 413 (vesícula en ayunas de s0028): `VEXUS_UPDATE_GALLBLADDER_SHADERS=1` la reescribe con los
    // programas que difieren de los de antes; la prueba de abajo comprueba que la diferencia es solo la de la vesícula de s0028.
    if (process.env.VEXUS_UPDATE_GALLBLADDER_SHADERS) {
      const revision = gallbladder as Record<string, Record<string, { default: string; s0028: string }>>;
      revision[mode] = Object.fromEntries(
        Object.entries(result[mode]).filter(
          ([name, value]) => value.default !== before413[name].default || value.s0028 !== before413[name].s0028,
        ),
      );
      writeFileSync(join(root, 'src/validation/fixtures/gallbladder-413-shaders.json'), JSON.stringify(revision, null, 2) + '\n');
    }
    // La vesícula de la decisión 413 solo cambia programas de s0028: sus default son los de antes.
    for (const [name, value] of Object.entries(gallbladder[mode] as Record<string, { default: string }>))
      expect(value.default, name).toBe(before413[name].default);
    expect(result[mode]).toEqual({ ...before413, ...gallbladder[mode] });
  }
});

it('la vesícula en ayunas de la decisión 413 solo cambia el dueño y la luz vesicular de s0028', () => {
  // Con la vesícula de antes, los 40 programas (default y s0028) son exactamente los de la revisión anterior.
  const source = programs(false, gallbladderBefore413).source;
  const previous = Object.fromEntries(
    baseline.source.programs.map((p) => [
      p.name,
      p.name === 'FRAG_SCANCONVERT' ? scanConvertRevision.source : { default: p.sha256, s0028: p.s0028Sha256 },
    ]),
  );
  expect(source).toEqual({
    ...previous,
    ...renalRevision.source,
    ...renalInterior.source,
    ...tubeCapacity.source,
    ...heartBeat.source,
  });
  expect(Object.keys(gallbladder.source).length).toBeGreaterThan(0);
});

it('el latido de la decisión 410 solo cambia las cavidades del corazón y la ranura de uMotion', () => {
  // Con el corazón de antes, los 40 programas (default y s0028) son exactamente los de la revisión anterior.
  const source = programs(false, (text) => heartBefore410(gallbladderBefore413(text))).source;
  const previous = Object.fromEntries(
    baseline.source.programs.map((p) => [
      p.name,
      p.name === 'FRAG_SCANCONVERT' ? scanConvertRevision.source : { default: p.sha256, s0028: p.s0028Sha256 },
    ]),
  );
  expect(source).toEqual({ ...previous, ...renalRevision.source, ...renalInterior.source, ...tubeCapacity.source });
  expect(Object.keys(heartBeat.source).length).toBeGreaterThan(0);
});

it('la capacidad de tubos de la decisión 402 solo mueve constantes de disposición de la textura de escena', () => {
  // Con las constantes de antes, los 40 programas (default y s0028) son exactamente los de la revisión anterior.
  const source = programs(false, (text) => layoutBefore402(heartBefore410(gallbladderBefore413(text)))).source;
  const previous = Object.fromEntries(
    baseline.source.programs.map((p) => [
      p.name,
      p.name === 'FRAG_SCANCONVERT' ? scanConvertRevision.source : { default: p.sha256, s0028: p.s0028Sha256 },
    ]),
  );
  expect(source).toEqual({ ...previous, ...renalRevision.source, ...renalInterior.source });
  expect(Object.keys(tubeCapacity.source).length).toBeGreaterThan(0);
});

it('un uniform/símbolo privado nuevo no altera ningún programa default', () => {
  expect(programs(true)).toEqual(programs());
});
