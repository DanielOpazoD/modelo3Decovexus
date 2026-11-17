# Cambiar GLSL o datos de la persona sin sorpresas

Lista para un cambio deliberado de los shaders o de los datos de s0028. Cada punto costó al menos un push fallido o una CI roja.
Córrela entera antes de `git push`; el gancho solo corre la capa rápida.

## 1. Huellas de los programas (decisión 414)

`src/validation/fixtures/shader-hashes.json` es la foto vigente de los 40 programas ensamblados, para la persona por defecto y
para s0028, en fuente y transformados por el build. `personShaders.test.ts` la compara en cada ejecución.

- Cambio solo de la anatomía de s0028:
  `VEXUS_UPDATE_SHADER_HASHES=s0028 npx vitest run src/validation/personShaders.test.ts`. Solo reescribe las huellas de s0028;
  si algún programa default cambió, la prueba sigue fallando: es la guarda de que la persona no toca lo común.
- Cambio de los programas comunes:
  `VEXUS_UPDATE_SHADER_HASHES=all npx vitest run src/validation/personShaders.test.ts src/validation/s0028WallGpu.test.ts`.
- El diff de la foto en la PR dice qué programas cambiaron: revísalo y cítalo en la descripción (cuántos, y por qué esos).

## 2. Reglas del GLSL que vigilan las pruebas

- **Gemelo TS.** Toda función GLSL de anatomía tiene su par TS exportado con `@twin <id>` y registrado en
  `tools/twins/registry.ts`; después, `node --import tsx tools/twins/inventory.ts --write` (`twinRegistry.test.ts`).
- **Sin sobrecargas** y **sin bucles en la política P3 de s0028** (`s28P*` y lo que llaman; `shaderLimits.test.ts`): desenrolla
  a mano y pon una guarda TS si depende de un tamaño.
- **Tamaños desde constantes** (`TISSUE_COUNT`, `MAX_TUBES`, …), nunca literales.
- **Nombres GLSL fuera de las cadenas JS** (`glslMangle.test.ts`): el build renombra funciones y uniforms; un nombre generado
  desde una cadena, o citado en un mensaje de error, no se renombraría. Tampoco plantillas con backticks anidadas dentro de `${}`.
- **Función o uniform nuevos**: fíjalos en `tools/build/fixtures/person-glsl-abi.json` (`names` o `bindings`) con un código corto
  que no aparezca en `src` (si no, «Colisión con ABI GLSL fijada»). Sin eso, «un símbolo privado nuevo no altera…» falla.
- **Ranuras de uniforms de B**: el presupuesto fijo no admite un `vec4` más; reutiliza una ranura (p. ej. `uMotion`).

## 3. Datos de s0028

- **Techo JS** (`tools/ci/personBundles.ts`): si los datos nuevos lo pasan, súbelo con la cifra medida y su decisión, y actualiza
  `personBundles.test.ts`.
- **Estado**: `npx vite build && node --import tsx tools/docs/estado.ts --write` cuando cambien techos o tamaños.
- **Ventana o pose**: listas de las e2e (`equivalence`, `s0028Equivalence`, `referenceAdult`, `windowSelector`),
  `s0028RigidSector` (costillas bajo la cara), `compression`, el manifiesto de mutantes `tools/mutants/manifests/startPoints.ts`
  (su `from` es la línea literal de la pose) y la capa lenta.

## 4. Antes de empujar

```
npx tsc --noEmit -p . && npx eslint src tools e2e --quiet && npm run docs:index
VITEST_MAX_WORKERS=4 npx vitest run                                    # capa rápida entera
VITEST_TIER=slow VITEST_MAX_WORKERS=4 npx vitest run --testTimeout=180000   # si tocas poses, contacto o anatomía
```

Con la máquina cargada, un `Test timed out` no es un fallo del cambio: repite ese archivo solo, con el plazo estándar.
La equivalencia CPU/GPU real se comprueba en el navegador (pestaña Docente) y en las e2e de la CI.
