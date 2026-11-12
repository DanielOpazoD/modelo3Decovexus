# Puente entre maqueta y simulador: estado del 11 de noviembre

**La maqueta sigue siendo un prototipo separado.** Las mejoras renales del
simulador, para la persona `current`, están en `main` desde PR #1. No se han
trasladado por ello las estructuras de la maqueta al caso `s0028`, ni se ha
probado que su costo sea aceptable en el simulador.

## Correspondencia y propietarios

Una comparación de 65.568 puntos de la maqueta con la escena real de
`s0028` ([106-VERIFIED.json](106-VERIFIED.json)) encontró correspondencia local
para gran parte del hígado y psoas, pero también límites relevantes:

- De 2.041 puntos del cuadrado lumbar derecho estimado, 1.610 eran territorio
  desconocido y 431 coincidían con grasa compatible del simulador.
- De 1.115 puntos de la XII costilla, 943 coincidían con hueso observado, 163
  con territorio desconocido y 9 con grasa compatible.
- El interior del riñón `s0028` permanece desconocido; la arquitectura renal
  estimada de `current` no se puede copiar entre personas por compartir nombre.

Otro recorrido externo de 7.290 nodos del campo del cuadrado lumbar propuso
6.847 asignaciones estimadas en territorio desconocido y conservó 443
superposiciones con grasa como conflictos. Se probaron negativos para proteger
órganos, pared, vasos y conflictos previos. No se demostró que no haya otras
colisiones entre nodos. Las coincidencias son dentro de un caso y no son una
referencia anatómica independiente. Conservar certezas O/D/E/U e identidad de
persona y recurso; no convertir una estimación en tejido observado.

## Precisión, memoria y costo

Copiar los nodos Float32 no garantizó que CPU y GPU clasificaran igual el
signo: en 27.770 consultas de superficie seleccionadas hubo 44 diferencias
exactamente en raíces ([112-SURFACE-VERIFIED.json](112-SURFACE-VERIFIED.json)).
Un lector entero alternativo coincidió entre un Worker y una GPU de prueba en
esas consultas, pero cambia deliberadamente la representación:
[113-RESULT.json](113-RESULT.json) y
[113-BROWSER-VERIFIED.json](113-BROWSER-VERIFIED.json). En las 5.554 aristas
examinadas el desplazamiento observado máximo acotado fue 0,00586 mm; esto no
es una cota global ni demuestra precisión clínica.

Un paquete externo de 124.151 nodos y sus certificados ocupa 372.453 bytes
brutos y requeriría 749.568 bytes para el bloque experimental de subida a
GPU ([118-ASSET.json](118-ASSET.json), [118-VERIFIED.json](118-VERIFIED.json)).
La cabida geométrica preliminar en el atlas no es reserva de espacio ni medida
de memoria de proceso. El margen nominal abdominal registrado era de 3.981
bytes. El usuario permite revisar presupuestos si existe una razón defendible;
hay que cuantificar copias, inicialización, consumo estable y costo de GPU antes
de decidir, sin hacer pasar por idéntica la geometría cuantizada.

Se probaron varias alternativas en el visor 760×560 con Metal. Los atajos 104,
107, 108 y 111 conservaron las comparaciones declaradas, pero aumentaron la
suma de medianas de las seis vistas principales frente al visor 102 en 7,67 %,
8,44 %, 8,62 % y 6,01 %, respectivamente. Las variantes enteras 114–116 también
fallaron el costo; cambiaron etiquetas o píxeles cerca de superficies. El
certificado 117 conservó 73.250 consultas y 38 imágenes respecto de 116,
pero costó un 11,45 % más que 102. Sus 90.540 celdas homogéneas
([117-CERT-VERIFIED.json](117-CERT-VERIFIED.json)) son un recuento, no una
traza de lecturas ahorradas. El atajo de particiones uniformes 119 conservó
73.250 consultas y 38 imágenes respecto de 103, pero costó un 7,66 % más que
102 ([119-VERIFIED.json](119-VERIFIED.json)). El primer control negativo 119
no cambió las imágenes; se conservó el fallo y se añadió un control diferente
que sí las modificó. Los bancos del visor no son tiempos del simulador.

La propuesta 120 de precalcular el campo en la rejilla de etiquetas existente
también se detuvo: el desplazamiento de medio voxel y la interpolación
tetraédrica produjeron 5.459 cambios de signo en consultas a ±0,01 mm de las
raíces seleccionadas ([120-RESULT.json](120-RESULT.json),
[120-VERIFIED.json](120-VERIFIED.json)). El verificador independiente
reconstruye esos valores; no verifica la bisección de las raíces. Este resultado
descarta esa transformación concreta, no todas las formas de compartir datos.

Al investigar la incorporación en `s0028`, la GPU original y la escena CPU
discreparon en 370 de 7.290 puntos entre grasa compatible y tejido no
segmentado ([121-BASELINE.json](121-BASELINE.json)). El shader de consulta
instrumentado leyó los índices y confirmó que los bits de los vecinos elegidos
explican los 370 casos ([121-GPU-INDICES.json](121-GPU-INDICES.json)); estos
puntos se concentraban junto a medios vóxeles. No se extrapola a otros casos ni
se atribuye al músculo que aún no está integrado.

Dos fórmulas experimentales recuperaron los 7.290 tejidos y pasaron 7.692
consultas de límites y bits en ambas cajas. En el banco de desarrollo de doce
estados, 122 aumentó un 0,016 % la suma de medianas y 125 la redujo un 0,44 %,
pero ambas fallaron varias puertas por vista y p95 ([122-COST.json](122-COST.json),
[125-COST.json](125-COST.json)). El índice auxiliar de 125 puede diferir fuera
de la caja, donde no se usa y la consulta devuelve `false`. Ninguna corrección
GPU se integró. Los intervalos completos se conservan en `122-COST-RAW.json` y
`125-COST-RAW.json`; son datos de desarrollo, no mediciones del build final.

Durante el primer banco se registró un error del Worker al cambiar de caso; se
guardó el intento interrumpido en `122-COST-INTERRUPTED.json`. Una prueba
posterior con demora controlada reprodujo la carrera en la base y verificó que
la corrección publica el mapa del último caso ([123-WORKER-NATIVO.json](123-WORKER-NATIVO.json)).
La repetición con la versión final de la corrección está en
[123-WORKER-NATIVO-FINAL.json](123-WORKER-NATIVO-FINAL.json). Ambas usan un
retraso artificial de 2.500 ms y no establecen la secuencia exacta del error
original no trazado. Para conservar la comprobación de identidad se amplió el
techo de JavaScript `s0028` en 1 KiB, sin ampliar el de `default` ni GPU; el
build medido usa 1.070.084 de 1.071.104 bytes.

Estos JSON son resúmenes conservados con la copia del proyecto; los datos y
scripts completos de los pilotos 104–120 permanecen fuera de este repositorio.
Para 120 sí se incluyen las entradas, el piloto y un verificador independiente
de las 27.770 consultas. Con Python y NumPy instalados pueden ejecutarse desde
la raíz:

```bash
python3 maqueta-anatomica/evidencia/puente-s0028-20261111/piloto-120.py
python3 maqueta-anatomica/evidencia/puente-s0028-20261111/verificar-120.py
python3 maqueta-anatomica/evidencia/puente-s0028-20261111/verificar-122.py
```

El piloto 120 vuelve a calcular las raíces por bisección; su verificador compara
las predicciones y los signos con los datos guardados, sin reconstruirlas. El
verificador 122 reconstruye 1.567.868 coordenadas Float32 por eje, sin
demostrar por sí solo equivalencia de GPU ni todas las posiciones posibles.
Los JSON 117 y 119 son copias de
resúmenes a las que se quitaron rutas locales, conservando hashes y mediciones.
No confundir este conjunto con el historial completo ni con validación clínica.

## Para continuar

1. Conservar el campo y su origen estimado por persona; no sobrescribir reservas
   de anotación ni estructuras observadas. Registrar explícitamente conflictos.
2. Probar gemelos CPU, Worker y GLSL, incluyendo la superficie y la distancia a
   ella; el signo negativo por sí solo no sustituye `boundaryDistance`, que
   influye en la adquisición ecográfica.
3. Medir carga fría, copias, memoria y el costo de la aplicación completa con la
   misma resolución, trayectorias y muestras, junto con la coherencia del corte.
   La mejora en una representación aislada no acredita menor desfase ni FPS.
4. Revisar la composición integrada y solicitar revisión de un experto antes de
   asignar una nota clínica. No se ha otorgado una calificación nueva.
