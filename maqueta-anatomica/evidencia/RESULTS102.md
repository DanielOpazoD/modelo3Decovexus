# Maqueta anatómica 102 · arco lateral derecho y fascias

## Resultado y alcance

La intervención es una **maqueta externa experimental**, no un cambio del simulador ecográfico ni un diagnóstico. La base es la maqueta 101 y un solo caso s0028, con campos derivados de 1,5 mm; no constituye segmentación independiente ni prueba de que una inserción se observe en esa persona. El archivo interactivo final es `index-final102e.html`. No hubo commit, PR, CI nuevo ni tareas programadas. Los cambios preexistentes del checkout se preservan.

Se conservan los 1.464 triángulos del arco derecho y se ha ajustado suavemente su entorno: desplazamiento máximo 0,20 mm en el extremo lumbar y 0,10 mm en el entorno costal. **La terminación costal no se movió**: dos variantes que la desplazaban producían 12–13 cruces detectados con la porción costal estimada y se rechazaron. No se modificaron órganos ni músculos para abrir espacio.

Se añadió una transición fascial parcial estimada del cuadrado lumbar: 116 triángulos, espesor de visualización 0,75 mm, 30 aristas exactas compartidas con el arco, una sola componente y cero aristas no manifold. El ángulo máximo entre planos en las aristas compartidas es 0,028°, limitado a esa costura. De 21 testigos seleccionados de superficie del músculo modelado, 15 están a ≤0,375 mm de la lámina y 19 a ≤0,75 mm; la distancia máxima es 1,405 mm. No es cobertura completa del músculo ni demuestra fusión histológica. La fascia renal posterior se mantiene como entidad separada. [Variación del ligamento arqueado lateral en TC](https://pubs.rsna.org/doi/10.1148/radiology.185.1.1523290/) y [estudio de las inserciones diafragmáticas](https://pubmed.ncbi.nlm.nih.gov/26352744/); [estudio cadavérico de fascias renales](https://pubmed.ncbi.nlm.nih.gov/41311011/).

## Corrección de una afirmación anterior

En 101 se había usado el campo óseo menos el radio del arco como aproximación de hueco, llegando a indicar hasta 1,05 mm. El valor del campo interpolado no es distancia euclidiana exacta: **ese número no demuestra un hueco de esa magnitud**. Siete testigos de valor cero del campo óseo derivado por extremo, obtenidos por cambio de signo y bisección, quedan dentro de la envolvente visual del arco ya en 101. Los optimizadores iniciales no convergieron en todos los casos y no se declara un mínimo global. En los siete testigos lumbares, el solapamiento indicativo respecto a la envolvente visual baja de 0,238–0,366 a 0,045–0,166 mm; no es penetración física medida ni acreditación de inserción. `BONE-WITNESSES102.json`, `RELATIONS102.json` y `audit-endpoints102-retry.log`.

## Controles

- La reserva geométrica 10202 verificó 26.352 muestras del arco por versión y 4.176 de la transición en distintos espesores frente a campos derivados y otras estructuras modeladas, sin las invasiones nuevas definidas en `PROTOCOL.md`. No prueba ausencia de intersecciones en todos los puntos del volumen.
- La topología comparó los pares candidatos de triángulos y no detectó cruces del arco, la transición, la fascia renal o la inserción previa; `TOPOLOGY-NEGATIVES102.json` detecta cruces interiores y solapes coplanares, y conserva una arista compartida válida. Predicados con tolerancia, no demostración universal.
- Las 11 máscaras originales accesibles no mostraron invasiones nuevas en las muestras. Las máscaras originales de L1, la costilla XII derecha, los riñones y el hígado no estaban disponibles; las comprobaciones para ellos usan campos derivados y no son una referencia independiente.
- Las consultas GPU 101→102 y distancias CPU localizadas explican los 2.830 cambios físicos entre 19.000 puntos; una transición demasiado gruesa cambia indebidamente 2.548 etiquetas. La malla espacial coincide con la búsqueda exhaustiva en 900 puntos por estructura, con negativos que detectan celdas omitidas. Seis cortes a 1 mm contienen 39.653 puntos por versión y sus cambios se registran en `CUTS102-VERIFIED.json`.
- El clasificador gráfico final E conserva las tres etiquetas en 54.043 consultas y seis framebuffers respecto a D; los seis cortes completos coinciden con/sin paredes. Un negativo que omite el candidato cuando sí es necesario cambia seis de 2.000 testigos. No demuestra equivalencia universal ni paridad con Worker/GLSL productivo.
- El inspector selecciona la nueva estructura por identidad, la sitúa en el inventario fascial y expone cuatro relaciones y sus límites; se comprobaron corte, teclado, pantalla pequeña y rechazo de coordenadas no finitas (`INTERACTION102.json`).

## Coste GPU

Contratos registrados antes de cada variante. Las cuatro implementaciones anteriores no pasaron las puertas: 102 agregado +1,16%; B −2,76% pero dos máximos por vista subieron; C +0,49%; D −2,99% pero aumentaron una mediana y dos máximos. Se conservan íntegros sus datos; no se escogieron repeticiones ni se modificaron sus puertas.

La versión E evita calcular la partición candidata sólo cuando la identidad original protegida la habría descartado; conserva prioridad y desempates. Se midieron seis vistas estáticas 760×560 en Apple M4/Metal, 36 renders de calentamiento y 84 intervalos de tres renders, siete pares alternados por vista. La razón de sumas de medianas fue **0,94927**: 5,07% menor. Cada mediana y cada p95 nearest-rank por vista también fue menor; con siete intervalos por lado, ese p95 es el máximo de los siete. Los tiempos y hashes de shader y HTML están en `COST102E-VERIFIED.json`. Esta medición concierne al visor experimental en este equipo y a esas vistas: **no demuestra FPS, coste del producto, estabilidad en otros dispositivos ni GPU máxima universal**.

## Imágenes y nota

`BEFORE-AFTER-FASCIA102.png` presenta el detalle; `BEFORE-AFTER-CONTEXT102.png` añade el contexto renal y costal con otras capas ocultas por igual; `BEFORE-AFTER-GLOBAL102.png` activa los grupos anatómicos, omitiendo grasa de fondo y etiquetas sin resolver, y muestra que la unión queda ocluida. Las parejas tienen cámara y escala iguales; el rojo es un resaltado diagnóstico de la transición nueva, no un color anatómico ni un cambio de forma. Sin texturas, no son TAC ni ecografías.

No se asigna una nueva nota global. La autoevaluación anterior era 3,7/7 y no es evaluación experta. Los contornos óseos y musculares siguen facetados, la transición es parcial y las inserciones individuales no están verificadas. No hay fundamento para afirmar cercanía al 7 sin fuentes completas, revisión multiplanar y valoración independiente.

La descripción `scope` del resultado original `GPU-102E-PARITY.json` conservó por error texto del experimento D. `PARITY-ATTRIBUTION102E.json` aclara que el arnés realmente comparó `index-final102d.html` con `index-final102e.html`; se preservó el resultado original sin reescribirlo. Una comprobación sintáctica inicial con ruta relativa tampoco encontró el archivo por el cambio de directorio de `run.sh`; con ruta absoluta pasó. Ninguno afectó los datos medidos.
