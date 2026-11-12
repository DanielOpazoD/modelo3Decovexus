# Precalcular el campo en la rejilla existente: propuesta rechazada

La rejilla de etiquetas está desplazada medio voxel en cada eje respecto de
los campos examinados. Al muestrear el campo trilineal en los nodos de esa
rejilla e interpolar por tetraedros, 5.459 de las consultas seleccionadas a
±0,01 mm cambiaron de signo. En 4.131 de 5.554 aristas no se encontró una
raíz mediante el sondeo acotado a ±0,125 mm; no se infiere de ello que no
exista otra raíz o que todas las superficies del órgano difieran igual.

La puerta geométrica predeclarada falla. Un segundo programa reconstruyó las
27.770 consultas usando el promedio de los ocho nodos de cada celda desplazada
medio voxel y obtuvo los mismos recuentos; un negativo que desplazó un nodo
alteró las 512 consultas ensayadas. La verificación independiente no reevalúa
el sondeo por bisección. No se construyó un atlas, no se modificó el producto
y no se midió una GPU: el resultado descarta esta forma concreta de
precalcular, no todas las representaciones posibles.
