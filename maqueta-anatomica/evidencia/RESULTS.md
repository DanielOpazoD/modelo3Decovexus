# Maqueta 103: resultado parcial, coste GPU no aprobado

La comparación es entre la maqueta 102 y el prototipo 103L de la misma persona y coordenadas. Las imágenes de `images-comparison103l/` son framebuffers sin moteado, con la misma cámara y capas en ambos lados. El rojo identifica la transición fascial en ambas versiones; no indica un hallazgo clínico. El riñón, las costillas y otras estructuras se muestran sólo cuando están incluidas en la vista registrada.

## Geometría

Se reconstruyeron tridimensionalmente los contornos derivados del cuadrado lumbar derecho y la costilla XII derecha desde la clasificación efectiva de 102. Desaparecen algunas espículas, pero persisten escalones y facetas, también en superficies vecinas. El músculo se recorta contra el campo renal del propio modelo; los 0,005 mm usados son margen numérico, no un espacio anatómico medido. No se movieron los órganos. No existe máscara original local disponible de este cuadrado lumbar ni de la costilla XII derecha que permita validar su forma individual.

La nueva lámina fascial tiene 240 triángulos añadidos a los 116 anteriores y comparte en total 91 aristas con el arco. La malla queda conectada y no se detectaron cruces de superficies centrales en las comparaciones realizadas. El arco de 102 se conservó: la lámina termina en la fila 103, antes del sector donde otra propuesta entraba en el hueso, y el recorrido restante a la costilla se representa mediante el arco. **La inserción fascial directa y la fascia completa siguen pendientes**; no se observó una unión histológica individual.

`FASCIA-FIELD103K-VERIFIED.json` no encontró muestras dentro de la costilla compuesta en 8.640 puntos de espesor de la nueva lámina; `RESERVED-FASCIA10316.json` y `ORIGINAL-SUBSET103K-AUDIT.json` describen 12.816 puntos y las 11 máscaras fuente accesibles. No están disponibles las máscaras originales de riñón, hígado, psoas, L1 ni costilla XII derecha. La búsqueda es muestreada y el campo costal derivado no es una distancia euclidiana certificada: no equivale a ausencia universal de intersección ni a validación anatómica independiente.

En una malla reservada de 87.699 puntos, los cocientes de volumen efectivo 103/102 son 0,9792 para el cuadrado lumbar y 0,9797 para la costilla. Son conteos de etiquetas a 1,5 mm, no volúmenes verdaderos. En 40.344 posiciones por estado de paredes no cambiaron identidades físicas protegidas; seis cortes de 39.653 puntos por versión mantuvieron esa condición. Los campos CPU/GPU coincidieron dentro de 0,000006 mm en 11.401 posiciones, con negativo de canal. Estos controles comparan representaciones del modelo, no establecen que el modelo sea anatómicamente verdadero.

## Coste

La medición con consultas envolventes Metal del render completo, en Apple M4 y 760×560, consistió en siete pares alternados por vista y tres frames por intervalo. En la variante 103L, el cociente entre las sumas de medianas para las seis vistas principales fue **1,0954**: aumento de **9,54 %**. Las ocho vistas fallaron la puerta por mediana y p95 nearest-rank; con siete muestras el p95 es el máximo. Es un banco estático del visor experimental, no FPS ni tiempo del simulador de producto. Detalles y datos completos: `COST103L-VERIFIED.json` y `COST103L-RAW.json`.

El primer candidato 103K aumentó el agregado un 18,50 %. Otra variante, 103M2, conservó los ocho framebuffers pero aumentó el agregado un 10,53 %. 103M con descarte por rayo cambió píxeles y se rechazó antes de medir. Se conservan los tres resultados y sus controles. Ninguno cumple la solicitud de mantener el coste GPU; **no hay integración al producto ni mejora de rendimiento entregada**.

## Límites y evaluación

La reconstrucción regulariza una representación derivada de una sola persona y 1,5 mm de resolución, sin las máscaras originales necesarias ni revisión de ecografista. La mejora en la silueta no demuestra precisión anatómica ni completitud; no se asigna una nota nueva. Las versiones fallidas, correcciones de controles y el repositorio de trabajo previo se conservan. No hubo cambios de producto, commit, PR, CI ni tareas programadas.

Como referencia de anatomía general y variabilidad, véanse [variantes del ligamento arqueado lateral en TC](https://pubs.rsna.org/doi/10.1148/radiology.185.1.1523290/) y [anatomía de las inserciones diafragmáticas](https://pubmed.ncbi.nlm.nih.gov/26352744/). No sustituyen las fuentes individuales ausentes.
