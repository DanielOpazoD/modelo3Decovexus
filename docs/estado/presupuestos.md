# Estado vigente: presupuestos

Actualizado: 2026-11-11 sobre main `e8e1bec`. Todos los techos que hoy aplica el código, con la decisión que los fijó y
su valor actual. Los techos no se suben para obtener verde (decisión 322); subir uno es una decisión propia, declarada en
la PR y en `docs/DECISIONS.md`.

## Cómo se mantiene

- La tabla la genera `tools/docs/estado.ts` tras `vite build`: lee cada techo de la fuente que lo aplica
  (`tools/ci/bundleBudgets.ts`, `tools/ci/personBundles.ts`, `src/anatomy/people/s0028/runtime.ts`, `src/anatomy/people/s0028/surfaces.ts`, `.github/workflows/ci.yml`, los
  ocho techos de `src/validation/shaderLimits.test.ts` a través de `tools/anatomy/s0028-shader-metrics.ts`) y mide el
  valor actual con las mismas funciones que lo comprueban. Las cifras quedan en `docs/estado/medidas.json`.
- `src/validation/estado.test.ts` exige que cada techo de la tabla sea el del código, que la tabla sea la de
  `medidas.json` y que las medidas de los programas y de las texturas coincidan con las vivas mientras su GLSL y sus
  descriptores no cambien. Regenera con `node --import tsx tools/docs/estado.ts --write` al subir un techo o al cerrar una
  fase.
- Lo que no mide una herramienta local queda fuera de la tabla: la duración real de los trabajos de la CI (el recibo de
  cada PR) y el pico de memoria en Metal, criterio de trabajo de ≤ 2,0 GB para toda la aplicación (decisión 318; medido
  1,68–1,77 GB con s0028 en P2, decisión 320).

## Techos

<!-- tabla generada por tools/docs/estado.ts -->

Medido en el candidato basado en main `e8e1bec` el 2026-11-11 con `tools/docs/estado.ts`. No se copian a mano.

| Techo                                               |      Límite |      Actual |     Margen | Unidad   | Decisión | Fuente                                 |
| --------------------------------------------------- | ----------: | ----------: | ---------: | -------- | -------- | -------------------------------------- |
| `abdominal-atlas.gzip.bin`                          |   6.291.456 |   6.140.705 |    150.751 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `abdominal-body.bin`                                |        3640 |        3640 |          0 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `abdominal-direct.gzip.bin`                         |   8.567.375 |   8.567.375 |          0 | B        | 317      | `tools/ci/bundleBudgets.ts`            |
| `abdominal-surface.gzip.bin`                        |   6.291.456 |   6.014.991 |    276.465 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `anatomy.glsl.js`                                   |     122.880 |      23.152 |     99.728 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `anatomyScene.js`                                   |     122.880 |      16.163 |    106.717 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `annotation-capacity.gzip.bin`                      |     856.999 |     284.466 |    572.533 | B        | 320      | `tools/ci/bundleBudgets.ts`            |
| `bootstrap.js`                                      |     343.040 |     252.382 |     90.658 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `candidate-manifest.bin`                            |      38.617 |      38.309 |        308 | B        | 321      | `tools/ci/bundleBudgets.ts`            |
| `cpu.js`                                            |     122.880 |      24.241 |     98.639 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `cpu.js`                                            |     122.880 |      14.398 |    108.482 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `cutMapView.js`                                     |     122.880 |      16.838 |    106.042 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `cutMapWorker.js`                                   |     122.880 |        3663 |    119.217 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `deformation.js`                                    |     122.880 |        1559 |    121.321 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `doppler-worklet.js`                                |     122.880 |        2829 |    120.051 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `gatePlacement.js`                                  |     122.880 |        1200 |    121.680 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `gateTransmission.js`                               |     122.880 |      26.155 |     96.725 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `index.css`                                         |      20.480 |      20.475 |          5 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `index.js`                                          |     343.040 |        2878 |    340.162 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `loadPinnedAsset.js`                                |     122.880 |        1081 |    121.799 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `navigator3d.js`                                    |     122.880 |      28.405 |     94.475 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `personAssets.js`                                   |     122.880 |        4292 |    118.588 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `preload-helper.js`                                 |     122.880 |        1417 |    121.463 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `pwMeasurements.js`                                 |     122.880 |      15.821 |    107.059 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `query.js`                                          |     122.880 |        3703 |    119.177 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `reference-body.bin`                                |        2080 |        2080 |          0 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `retroperitoneum.js`                                |     122.880 |        5328 |    117.552 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `runtime.js`                                        |     122.880 |      20.293 |    102.587 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `runtime.js`                                        |     122.880 |        1631 |    121.249 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `series.js`                                         |     122.880 |        2204 |    120.676 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `skin-polar.gzip.bin`                               |     947.509 |     947.509 |          0 | B        | 317      | `tools/ci/bundleBudgets.ts`            |
| `sourceVolume.js`                                   |     122.880 |        1582 |    121.298 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `startPoints.js`                                    |     122.880 |        9901 |    112.979 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `structureIdentity.js`                              |     122.880 |        1480 |    121.400 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `surfaces.gzip.bin`                                 |   9.672.026 |   5.340.216 |  4.331.810 | B        | 318      | `tools/ci/bundleBudgets.ts`            |
| `surfaces.js`                                       |     122.880 |         485 |    122.395 | B        | 318      | `tools/ci/bundleBudgets.ts`            |
| `surfaces.js`                                       |     122.880 |        5730 |    117.150 | B        | 318      | `tools/ci/bundleBudgets.ts`            |
| `teacherTab.js`                                     |     122.880 |      46.687 |     76.193 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `testHooks.js`                                      |     122.880 |      69.645 |     53.235 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `thoracic-atlas.gzip.bin`                           |   6.291.456 |   4.444.037 |  1.847.419 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `thoracic-direct.gzip.bin`                          |   5.252.011 |   5.252.011 |          0 | B        | 317      | `tools/ci/bundleBudgets.ts`            |
| `thoracic-surface.gzip.bin`                         |   6.291.456 |   3.341.604 |  2.949.852 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `thoracicSurfaceData.js`                            |     122.880 |        3124 |    119.756 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `three.js`                                          |     385.024 |     369.107 |     15.917 | B        | 307      | `tools/ci/bundleBudgets.ts`            |
| `units.js`                                          |     122.880 |         388 |    122.492 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| `vesselTree.js`                                     |     122.880 |     108.778 |     14.102 | B        | —        | `tools/ci/bundleBudgets.ts`            |
| JS clausura default (Workers y ganchos incluidos)   |   1.070.080 |   1.036.276 |     33.804 | B        | 322      | `tools/ci/personBundles.ts`            |
| JS clausura s0028 (Workers y ganchos incluidos)     |   1.070.080 |   1.070.026 |         54 | B        | 322      | `tools/ci/personBundles.ts`            |
| Descarga del paquete s0028 (gzip)                   |  25.000.000 |  20.433.526 |  4.566.474 | B        | 318      | `src/anatomy/people/s0028/surfaces.ts` |
| Cada `.gzip` fijado del paquete s0028 (por archivo) |  19.510.002 |   8.567.375 | 10.942.627 | B        | 317      | `src/anatomy/people/s0028/runtime.ts`  |
| Textura abdominal s0028 en memoria (RAW)            | 139.921.010 | 139.917.029 |       3981 | B        | 317      | `src/anatomy/people/s0028/runtime.ts`  |
| Textura torácica s0028 en memoria (RAW)             |  60.413.664 |  60.413.664 |          0 | B        | 317      | `src/anatomy/people/s0028/runtime.ts`  |
| Samplers por programa (las dos personas)            |          16 |          16 |          0 | samplers | 317      | `tools/ci/shaderBudgets.ts`            |
| Ranuras vec4 de uniforms por programa               |         179 |         138 |         41 | ranuras  | 317      | `tools/ci/shaderBudgets.ts`            |
| Trabajo «check» de la CI                            |          25 |           — |          — | min      | —        | `.github/workflows/ci.yml`             |
| Trabajo «matrix-validation» de la CI                |          25 |           — |          — | min      | —        | `.github/workflows/ci.yml`             |
| Trabajo «triplex-early» de la CI                    |          10 |           — |          — | min      | —        | `.github/workflows/ci.yml`             |
| Trabajo «e2e» de la CI                              |          55 |           — |          — | min      | —        | `.github/workflows/ci.yml`             |

Programas especializados (`shaderLimits.test.ts`, decisiones 309 y 320): tokens y ramas expandidos de `main`, por persona.

| Programa                  |  Tokens default / s0028 / techo |    Uso | Ramas default / s0028 / techo |    Uso | Ranuras | Samplers |
| ------------------------- | ------------------------------: | -----: | ----------------------------: | -----: | ------: | -------: |
| `FRAG_RAWFIELD`           | 1.268.283 / 411.950 / 1.385.000 | 91,6 % |        10.139 / 2939 / 11.060 | 91,7 % |     136 |       10 |
| `FRAG_RAWFIELD_ECHO`      |     529.303 / 169.075 / 577.000 | 91,7 % |            4252 / 1177 / 4640 | 91,6 % |     137 |       16 |
| `FRAG_RAWFIELD_CLASS`     |     417.797 / 123.538 / 455.000 | 91,8 % |             3515 / 860 / 3830 | 91,8 % |     136 |       10 |
| `FRAG_RAWFIELD_ELEVATION` |     417.937 / 123.678 / 455.000 | 91,9 % |             3517 / 862 / 3830 | 91,8 % |     137 |       15 |
| `FRAG_RAWFIELD_GRADIENT`  |      321.815 / 99.280 / 351.000 | 91,7 % |             2510 / 605 / 2760 | 90,9 % |     138 |       15 |
| `FRAG_TRANS_HITS`         |     468.641 / 168.330 / 513.000 | 91,4 % |            4110 / 1264 / 4470 | 91,9 % |     101 |        6 |
| `FRAG_TRANS_HITS_GRID`    |      230.336 / 78.137 / 252.000 | 91,4 % |             2033 / 612 / 2210 | 92,0 % |     102 |       11 |
| `FRAG_COLOR`              |      226.820 / 73.011 / 248.000 | 91,5 % |             1990 / 569 / 2160 | 92,1 % |     110 |        7 |

<!-- fin de la tabla generada -->

## Lectura

- Cada persona tiene su clausura JS, con Workers, worklet y ganchos incluidos (decisión 322, punto 3). Todos los archivos
  de `dist` pertenecen a una o ambas rutas; el total de su unión es informativo. Ningún techo supera 1.070.080 B.
- Los activos s0028 están fijados uno a uno (decisiones 317–321); la descarga del paquete completo tiene su propio techo
  de 25.000.000 B (decisión 318). Las texturas RAW se comprueban al cargar, con la misma cuenta que la tabla.
- Los programas tienen techo de tokens y ramas expandidos (decisión 309) porque el JIT de SwiftShader de la CI muere por
  tamaño mucho antes que Metal; las dos personas comparten los mismos techos (decisión 320). Samplers y ranuras de uniforms
  son los de WebGL2 en el peor equipo de referencia (decisión 317).
