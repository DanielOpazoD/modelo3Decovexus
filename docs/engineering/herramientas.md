# Herramientas de diseño anatómico, paridad y láminas

Con qué se diseña y se comprueba una mejora de anatomía o de imagen de la persona `s0028` antes de pedir una revisión: dónde
puede ir un tubo, dónde cae en el plano de una ventana, cómo queda la lámina y, si algo no cuadra, qué clasifica cada lado.
Todas se lanzan desde la raíz del repositorio con el Node del proyecto (`tools/workspace/run.sh` si la shell tiene otro).
`tube-gaps`, `window-plane`, `pear-fit`, `window-plates`, `window-parity` y `tissue-map` imprimen su uso con `--help` y, ante
un argumento equivocado, dicen cuál y salen con 2. No son pruebas ni acreditan nada: la aceptación sigue en `CONTRIBUTING.md`.

## Sin navegador: geometría de s0028 en Node

Cargan la persona con `loadS0028` (adulto sano, apnea espiratoria) y tardan segundos. Las coordenadas son mm del marco del
modelo (x = izquierda del paciente).

| Herramienta                             | Para qué sirve                                                                                                                                                                                                                                             | Comando                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `tools/anatomy/tube-gaps.ts`            | Ruta propuesta para vasos o conductos: menor hueco de pared de cada tubo con todos los demás (negativo: se pisan), milímetros de eje dentro del tubo digestivo del TAC y hueco con un tubo de referencia a cada altura (la tríada sobre el tronco portal). | `node --import tsx tools/anatomy/tube-gaps.ts propuesta.json`                                                          |
| `tools/anatomy/window-plane.ts`         | Dónde caen los tubos en el plano de una ventana: lateral, profundidad y elevación de cada nodo o, con `--lateral`, del eje muestreado, para ver qué entra en el corte y a qué profundidad corre cada uno.                                                  | `node --import tsx tools/anatomy/window-plane.ts portalSubcostal pvTrunk+pvRight,hepaticArtery,cbd --lateral=-10:60:5` |
| `tools/anatomy/pear-fit.ts`             | Pera vesicular candidata (nodos del fondo al cuello): volumen de luz, dueños P3 que pisa, máscaras del TAC que tiene debajo, tubos que cruza y cuánto de la vesícula del TAC queda dentro. Sin nodos, la pera vigente.                                     | `node --import tsx tools/anatomy/pear-fit.ts '[[-82.4,47.6,-102.9,10.5],[-70.9,39.8,-93.8,12],[-52,27,-79,4]]'`        |
| `tools/anatomy/find-s0028-poses.ts`     | Pose de inicio de una ventana por búsqueda sobre la anatomía fija: la sonda apunta al hito de `s0028Windows.ts` y se afina como haría un ecografista. El resultado se copia a `S0028_POSES`.                                                               | `node --import tsx tools/anatomy/find-s0028-poses.ts portalSubcostal`                                                  |
| `tools/anatomy/s0028-relations-grid.ts` | Rejilla de tejidos del modelo sobre los vóxeles del TAC, para medir la lista de `docs/anatomia/relaciones-tac.md` con `s0028-relations.py` (necesita la carpeta del caso de TotalSegmentator).                                                             | `node --import tsx tools/anatomy/s0028-relations-grid.ts <carpeta>`                                                    |

La propuesta de `tube-gaps.ts` y de `window-plane.ts --proposal` es un JSON `{ "<tubo>": [[x, y, z, r], …], … }` con los nodos
en el sentido del flujo; `<tubo>` es un id de la escena (`pvTrunk`, `hepaticArtery`, `cbd`…) o una abreviatura (`cha`, `ha`,
`rhd`, `lhd`). Un valor que empieza por menos va pegado con `=`: `--lateral=-10:60:5`, `--z=-90:-60:3`.

## Con navegador: la aplicación servida

Abren en Chromium la aplicación que ya está sirviendo alguien y pulsan la ventana como haría el alumno. **Necesitan el Chromium
de Playwright (`npx playwright install chromium`) y un servidor con los ganchos de prueba: `npm run dev` (puerto 6600).** No
construyen ni arrancan nada; la URL decide la persona. La primera línea dice qué GPU dibujó: con otra carga en el equipo tardan
más, y sin GPU real (SwiftShader) las cifras de coste no significan nada.

| Herramienta                       | Para qué sirve                                                                                                                                                                                                                | Comando                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/fidelity/window-plates.ts` | Láminas del modo B de las ventanas pedidas (todas si no se nombra ninguna), en `<carpeta>/b-<ventana>.png`: la de antes y después de una PR de imagen y la que se pone junto al TAC del mismo plano.                          | `node --import tsx tools/fidelity/window-plates.ts 'http://localhost:6600/?person=s0028' .cache/laminas/antes portalSubcostal`          |
| `tools/fidelity/window-parity.ts` | Discrepancias de tejido CPU/GPU en el plano de una ventana, sobre una rejilla densa: acuerdo, tabla de pares CPU→GPU y las primeras discrepancias con su punto, borde, dueños y pared. Dice dónde falla lo que la e2e vigila. | `node --import tsx tools/fidelity/window-parity.ts 'http://localhost:6600/?person=s0028' portalSubcostal`                               |
| `tools/fidelity/tissue-map.ts`    | Mapa en caracteres de lo que la CPU clasifica en una región del plano (θ en rad, profundidad en mm), orientado como la pantalla, con su leyenda de tejidos.                                                                   | `node --import tsx tools/fidelity/tissue-map.ts 'http://localhost:6600/?person=s0028' portalSubcostal --theta=-0.25:0.1 --depth=60:110` |
| `tools/fidelity/bench.ts`         | Banco de fidelidad del modo B (decisión 52): textura, interfaces, cuadros por segundo y coste del cuadro por vista. La cifra de coste de una PR de imagen sale de aquí (`docs/REGLAS.md`).                                    | `npm run fidelity -- --abdomen s0028 --out /tmp/fidelity.json`                                                                          |
| `tools/fidelity/blind-pairs.ts`   | Pares ciegos simulador–ecografía real para jueces (`docs/fidelity/juez-ciego.md`).                                                                                                                                            | `npm run fidelity:blind -- --out /tmp/ciego`                                                                                            |

## Orden habitual

1. Escribe la ruta o la forma en un JSON y mídela (`tube-gaps.ts`, `pear-fit.ts`) hasta que no pise nada.
2. Mira dónde cae en la ventana que debe enseñarla (`window-plane.ts`); si la ventana no la contiene, busca la pose
   (`find-s0028-poses.ts`).
3. Lleva los nodos al código, TS y GLSL a la vez, con la lista de [Cambiar GLSL o datos de la persona](cambio-glsl.md), y saca
   la lámina (`window-plates.ts`) junto a la de antes.
4. Si la imagen no enseña lo que la geometría dice, mira qué clasifica la CPU (`tissue-map.ts`) y si la GPU coincide
   (`window-parity.ts`).

Un guion suelto con el que se explora una idea puede vivir en `.cache/` (git la ignora); el que se vuelve a usar se promueve a
`tools/`, tipado, con su uso y su fila en esta página.
