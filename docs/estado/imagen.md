# Estado vigente: imagen

Actualizado: 2026-11-11 sobre main `e8e1bec`. Cómo se forma hoy la imagen en la GPU, qué programas la componen y qué
techos los limitan. La explicación de cada pasada está en `docs/ARCHITECTURE.md`; las decisiones, en `docs/DECISIONS.md`.

## A0 nativa current (339)

A0 usa dos draws: clasificación directa de centros y bucle original de impactos/reflejos/pleura.
No cambia la pasada B nativa ni la resolución192×1024. Ocho imágenes idénticas al rediseño sin
optimización;24 estados A0 bit a bit. Banco MetalM4:−46,91% GPU agregado frente a adaf672,
mediana y p95 por cada una de ocho escenas≤base. No FPS ni garantía universal de hardware/poses.
SwiftShader conserva su reparto; s0028 nativa conserva A0 original. Objetivos adicionales
1.004.544B nominales e índice vascular current8mm, techo4MiB. No memoria total ni coste frío.
Ver decisión339 y evidencia original; aceptación completa/CI se acreditan por separado.

## Pasadas por cuadro

La tabla `FRAME_PASSES` de `src/ultrasound/passGraph.ts` es la fuente: declara qué lee y escribe cada pasada, y
`passGraph.test.ts` la valida. Orden actual:

| Pasada  | Qué hace                                                                                       | Decisiones     |
| ------- | ---------------------------------------------------------------------------------------------- | -------------- |
| A0      | marcha de cada línea: primer impacto, espejo y cruce de la pleura                              | 54, 61         |
| A1      | segmentos de tejido de cada línea (camino de más en las luces)                                 | 54, 86         |
| A2      | prefijo de atenuación por línea, mirada 0 y dirigida, y Ψ̃ de la refracción                     | 54, 58, 86     |
| A       | transmisión con apertura (conos de emisión y recepción), refracción y especulares              | 54, 88, 91     |
| B       | campo complejo: clasificación, moteado anclado por tejido, ecos de interfaz, pleura y texturas | 55–57, 61, 62  |
| C, D    | PSF axial con el ruido del receptor y lateral con lóbulos y reverberación, por mirada          | 38, 76, 84, 89 |
| K       | composición de las miradas válidas                                                             | 58             |
| F, F1   | color: emulación del estimador de autocorrelación y su filtro                                  | 39, 70         |
| R       | reducción de moteado de la presentación                                                        | 313            |
| G, P, S | conversión de barrido con la TGC y los grises, persistencia y presentación                     | 10, 80         |

Fuera del grafo: el cine y la línea M guardan y devuelven cuadros sin lecturas GPU → CPU (decisión 80); el cine guarda la
envolvente en R16F y el color en RG32F (decisión 254). A0 y A1 se reutilizan mientras sus entradas no cambien
(decisión 256).

Con SwiftShader o un renderer no identificable, B se ejecuta en etapas (clasificación, elevación, gradiente y eco) para
que el JIT de la CI compile cada una; Metal conserva B directa y el oráculo compara las dos (decisión 240).

## Programas

`src/ultrasound/shaders/passes.glsl.ts` exporta los programas de la imagen (`FRAG_*` y `VERT_*`). La anatomía GLSL es una sola fuente
que incluyen todos los que clasifican; la persona s0028 especializa los programas antes de compilarlos (`personShader`,
decisiones 318, 320 y 321). El build quita comentarios, renombra y compacta el GLSL (`tools/build/glslMinify.ts`).

Los ocho programas con techo de coste, medidos en las dos personas (techos de tokens y ramas: decisiones 309 y 320;
samplers y ranuras de uniforms: decisión 317):

<!-- programas: generado por tools/docs/estado.ts -->

Medido en el candidato basado en main `e8e1bec` el 2026-11-11 con `tools/docs/estado.ts`.

| Programa                  | Samplers default / s0028 | Ranuras default / s0028 | Uso de tokens (peor persona) | Uso de ramas |
| ------------------------- | -----------------------: | ----------------------: | ---------------------------: | -----------: |
| `FRAG_RAWFIELD`           |                  10 / 10 |               136 / 136 |                         92 % |         92 % |
| `FRAG_RAWFIELD_ECHO`      |                  16 / 16 |               137 / 137 |                         92 % |         92 % |
| `FRAG_RAWFIELD_CLASS`     |                  10 / 10 |               136 / 136 |                         92 % |         92 % |
| `FRAG_RAWFIELD_ELEVATION` |                  15 / 15 |               137 / 137 |                         92 % |         92 % |
| `FRAG_RAWFIELD_GRADIENT`  |                  15 / 15 |               138 / 138 |                         92 % |         91 % |
| `FRAG_TRANS_HITS`         |                    6 / 6 |               101 / 101 |                         91 % |         92 % |
| `FRAG_TRANS_HITS_GRID`    |                  11 / 11 |               102 / 102 |                         91 % |         92 % |
| `FRAG_COLOR`              |                    7 / 7 |               110 / 110 |                         91 % |         92 % |

<!-- fin de programas -->

## Límites que importan al cambiar la imagen

- Tokens y ramas expandidos, no el texto: el JIT de SwiftShader de la CI muere por tamaño de programa mucho antes que
  Metal, y un bucle con cota constante se desenrolla entero (decisiones 309 y 320). Sin `for` ni `while` en el GLSL
  especializado por persona.
- `FRAG_RAWFIELD_ECHO` está en 16 de 16 samplers: un sampler más no compila en el equipo de referencia.
- Nada de lecturas GPU → CPU por cuadro (`CLAUDE.md`, invariante 7): solo PBO asíncrono o pruebas.
- Un cambio de GLSL se mide en SwiftShader x64 (como la CI) antes de publicarlo; los techos no se suben para pasar.

Valores exactos y márgenes de todos los techos: `docs/estado/presupuestos.md`.

## Corrección manual de interpolación axial (334)

En la rama de trabajo, G conserva la interpolación lateral de RM y mezcla amplitudes en profundidad.
Corrige el oscurecimiento axial espurio; no cambia la recepción ni resuelve la textura alargada del tejido.
Las siete E2E Metal de RM pasan. La no-regresión estricta por estado no pasa en seis de ocho estados
(mayor mediana +0,4325 %, p95 +0,5577 %). El usuario acepta ese coste conocido para integrar
la corrección, condicionado a check y CI del commit final. La puerta original sigue fallida;
no se repite rendimiento ni se presenta como una mejora visible del aspecto general.

## Ventana hepatorrenal visible (decisión 335)

Candidato manual: el inicio de la persona actual entra entre costillas y muestra juntos el hígado
con el riñón longitudinal. Cambia la adquisición, no el tamaño o la forma de los órganos. Se conserva
la anatomía y toda la cadena de imagen. La prueba de visibilidad protege ahora también el hígado;
antes sólo protegía el riñón. [Comparaciones registradas](../evidence/INDEX.md#image-visible-65-paired);
negativos en la ronda manual `image-visible-65`.

## Revisión de ventanas (decisión 336)

Ocho tarjetas revisadas, dos casos: tres poses nuevas (VCI transversal, suprahepática derecha
intercostal y media subcostal). Cinco conservadas tras comparar candidatos; la hepatorrenal de
335 sigue vigente. [16 pares registrados](../evidence/INDEX.md#image-views-66-paired). Sólo cambia
la adquisición; no hay remodelación anatómica ni tareas programadas. Aceptación remota pendiente
del último commit del PR352; los resultados anteriores no se reutilizan como CI del nuevo head.

## Rejilla vascular nativa (decisión338)

Metal conserva sus pasadas y ahora usa la misma selección conservadora de tubos que staged-atlas.
En ocho estados, la geometría/paredes337 produce ocho imágenes idénticas con y sin el índice.
Dos bancos pareados completos:−42,78%GPU frente a curvas sin optimizar y−45,54% frente a main98280b5;
mediana/p95 por estado mejoran. Resolución192×1024/PSF/semillas intactas. No se infieren FPS,
memoria total ni coste3D/Worker/compositor. Tablas observadas149.504–184.320B; techo existente4MiB.
