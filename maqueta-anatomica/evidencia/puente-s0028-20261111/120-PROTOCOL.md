# Viabilidad geométrica de precalcular las formas en la rejilla existente

La posibilidad es trasladar una forma a nodos de la rejilla ya usada por la
clasificación y dejar de consultar un segundo campo por cada muestra. Antes de
modificar atlas o ejecutar ningún shader, comparar la superficie que resultaría
de interpolar tetraédricamente esos nodos con la superficie trilineal de 103.
Las rejillas están desplazadas: compartir una etiqueta por el mismo índice no
conserva automáticamente la forma.

Fijar los nodos por sus coordenadas físicas reales y calcular el campo original
allí; no redondear la posición del órgano ni reconstruir etiquetas observadas.
Para las 27.770 muestras de las 5.554 aristas de superficie ya seleccionadas en
112–113, comparar primero signos en ±0,01 mm y medir el desplazamiento de la
raíz del campo precalculado sobre cada arista. Puertas prospectivas: cero
cambios de signo en las muestras ±0,01 mm, ninguna raíz sin resolver dentro de
±0,125 mm y desplazamiento ≤0,05 mm. Conservar todos los extremos. Si falla,
detener la propuesta antes de código de producto o banco GPU: no demuestra
imposibilidad de otras representaciones ni autoriza sustituir la geometría.

Un paso posterior requeriría demostrar conservación de propietarios, órganos,
vasos, identidades semánticas y prioridad de todas las estructuras, no sólo el
campo aislado; también medir recursos, carga y GPU del programa completo. La
maqueta es estimada y ninguna de estas pruebas es una validación clínica.
