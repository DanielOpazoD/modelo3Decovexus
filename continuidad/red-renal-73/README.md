# Evidencia parcial de la red renal 73

La rama `wip/red-renal-73` conserva los 22 archivos modificados y cuatro nuevos de la copia local original. `RESULTS.md`, `CLOSURE.json` y los demás archivos aquí incluidos se copiaron con sus bytes intactos y hashes en `MANIFEST.json`. Son evidencia histórica de un candidato no fusionado; no se debe atribuirle una CI ni un merge nuevos.

El informe previo declara un check local de 2.330 pruebas aprobadas y 16 fallos esperados, calibración y 11 pruebas E2E, además de un banco GPU pareado de ocho estados con reducción agregada de 46,91 %. El banco se refiere al simulador ecográfico renal y **no** a la maqueta anatómica 103, que tuvo una regresión GPU separada. No son FPS ni validación clínica. Esta entrega volvió a ejecutar TypeScript y cuatro archivos de pruebas focalizadas: 22 pruebas pasaron. No repitió el check ni el banco completos.

Este directorio es una selección de once archivos materializados. En el archivo histórico local había 221 archivos `SF_DATALESS` que no se descargaron; `MANIFEST.json` enumera sus nombres. No se afirma tener el historial completo ni haber leído esos archivos. La imagen `COMPARISON.png` es una comparación sintética conservada del trabajo previo.
