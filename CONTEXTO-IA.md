# Contexto de continuidad para otra IA o desarrollador

## Qué contiene este repositorio

- El simulador ecográfico VExUS completo está en la raíz: aplicación TypeScript/WebGL, recursos anatómicos, pruebas, documentación, herramientas y configuraciones. La base importada corresponde a `DanielOpazoD/vexus-sim` en `adaf67255268f021b06575d2663a26c881e4f663` (PR #353 integrada allí).
- `maqueta-anatomica/` es una **aplicación exploratoria 3D separada**, para estudiar anatomía con colores planos y sin moteado. Sus cambios no están integrados en el simulador. Incluye la maqueta 102, el prototipo 103, datos, inventario, comparaciones y evidencias resumidas.
- La rama `wip/red-renal-73` conserva exactamente los cambios locales de producto que estaban sin commit al preparar la copia. La evidencia histórica incluida informa de controles locales favorables, pero **no hay CI nueva ni fusión de esta rama**. En esta copia pasaron TypeScript y 22 pruebas focalizadas; no se repitió todo el check. Consultar el diff con `main` y verificar el head antes de aceptarlo.

Este repositorio es público. Los datos incluidos son derivados del caso público `s0028` de TotalSegmentator, no una anatomía confirmada del usuario ni una referencia clínica individual. No se incluyen el TAC original completo ni el archivo histórico completo de evidencias locales. La aplicación es educativa y no es un dispositivo médico.

## Cómo ejecutar

Usar Node 24 y el lockfile del repositorio:

```bash
npm ci
npm run dev
```

Abrir la dirección que indique Vite para el simulador. Para las maquetas, con las dependencias instaladas, servir la raíz desde otra terminal:

```bash
python3 -m http.server 4175 --bind 127.0.0.1
```

- 103: `http://127.0.0.1:4175/maqueta-anatomica/`
- 102: `http://127.0.0.1:4175/maqueta-anatomica/base-102.html`

No abrir las maquetas con `file://`: cargan fragmentos locales mediante HTTP. Necesitan navegador moderno, WebGL2 y `DecompressionStream`. Su primer inicio descarga y descomprime un atlas grande; los datos se cargan desde el propio repositorio. No confundir esta carga inicial con coste GPU de cada cuadro.

```bash
python3 maqueta-anatomica/verificar-datos.py
node maqueta-anatomica/probar-visor.mjs  # con el servidor anterior activo
npm run build
```

El verificador de datos comprueba hashes, bloques y reconstrucción exacta de ambos atlas. `--reconstruir-fuentes` también reconstruye `FIELDS98.npz` y los datos originales del visor 102 desde sus fragmentos; no sobrescribe archivos existentes. La prueba del visor necesita Chromium de Playwright y WebGL funcional. Las pruebas del producto y sus requisitos completos están en `docs/TESTING.md` y `AGENTS.md`.

En la preparación de esta copia, el build del simulador base y la prueba E2E de arranque `e2e/smoke.spec.ts` pasaron. La rama renal pasó además `typecheck` y cuatro archivos de pruebas focalizadas (22 pruebas); no se repitió su check completo. Los informes previos disponibles están en `continuidad/red-renal-73/`: declaran un check local de 2.330 pruebas y 16 fallos esperados, calibración y E2E aprobados, y un banco GPU de ocho estados con −46,91 % agregado. Esos son resultados históricos informados, no una nueva CI ni verificación independiente de los 221 archivos históricos que estaban sin materializar.

Se compararon los framebuffers de las maquetas originales con las portátiles en Metal: seis vistas de 102 y ocho de 103 coincidieron byte a byte. Véase `maqueta-anatomica/evidencia/PORTABILIDAD.json`. Esa comparación prueba el transporte en esas vistas y dispositivo, no la corrección anatómica ni el coste GPU del producto.

También se reconstruyeron los dos archivos fuente divididos y se repitieron la construcción, el control topológico y las muestras reservadas de la fascia 103 en un directorio temporal: los arrays resultantes coincidieron con los originales. El primer intento reveló cuatro módulos Python no incluidos inicialmente; se incorporaron antes de la repetición. Estos controles usan campos derivados, no el TAC original (`maqueta-anatomica/evidencia/REPRO-FUENTES.json`).

## Estado anatómico real de 103

El cuadrado lumbar derecho y la costilla XII derecha se reconstruyeron desde campos derivados de la maqueta 102. En la comparación desaparecen algunas espículas, pero **persisten facetas y escalones**. El campo muscular se recorta contra la envolvente renal modelada; el margen de 0,005 mm es numérico, no una medición del espacio perirrenal.

La transición fascial estimada añade 240 triángulos a los 116 anteriores y comparte en total 91 aristas con el arco. El arco previo se conserva. La lámina termina antes de la costilla; el resto del trayecto pasa por el arco, por lo que **no está terminada ni observada la inserción fascial costal directa**. Fascia renal y transición son estructuras diferenciadas, sin atribuir una fusión universal. Las imágenes están en `maqueta-anatomica/comparaciones/` y el inventario se puede consultar en el visor.

Los controles son muestreados: 40.344 posiciones por estado de paredes sin cambios de identidades protegidas; seis cortes con 39.653 posiciones por versión; 8.640 muestras de espesor de la lámina nueva sin penetración detectada en el campo costal compuesto. Once máscaras originales disponibles se contrastaron, pero faltan las fuentes originales necesarias para verificar directamente el riñón, la costilla XII derecha, L1, el hígado y el psoas de este caso. No hay revisión independiente por ecografista ni nota global nueva. Una malla o imagen plausible no prueba verdad anatómica.

## Rendimiento y trabajo rechazado

103L **no cumple** la condición de no aumentar el coste GPU. En Apple M4/Metal, 760×560, siete pares por vista y tres renders por intervalo, la suma de medianas de las seis vistas principales aumentó 9,54 % frente a 102; las ocho vistas medidas fallaron la puerta por vista. El p95 nearest-rank con siete intervalos es el máximo. Son mediciones del visor estático, no FPS ni coste del simulador de ultrasonido.

Se conservan `maqueta-anatomica/evidencia/RESULTS.md`, los contratos y los datos crudos y resumidos de los bancos. K anterior subió 18,50 %; M2 subió 10,53 % pese a conservar los ocho framebuffers; M con descarte por rayo cambió píxeles y se descartó sin medir coste. J3 alteró etiquetas protegidas al mover el arco. No seleccionar corridas ni relajar controles retrospectivamente para declarar éxito. El manifiesto histórico identifica más evidencia local, pero no implica que esos 4 GB estén incluidos en este repositorio.

## Puntos de entrada

- `src/anatomy/`: modelos e identidades del simulador.
- `src/ultrasound/`: adquisición y render de ultrasonido del producto.
- `maqueta-anatomica/visor-102.js` y `visor-103.js`: geometría y visualización del prototipo. `cargar.js` reconstruye los mismos datos a partir de fragmentos verificados.
- `maqueta-anatomica/fuentes/`: mallas, campos y scripts seleccionados para continuar la reconstrucción; leer su README antes de ejecutarlos.
- `maqueta-anatomica/evidencia/NEXT-DECISION.md`: siguiente hipótesis y límites.
- `docs/CONTINUIDAD.md`, `docs/estado/`, `docs/ARCHITECTURE.md`, `docs/TESTING.md` y `docs/DECISIONS_INDEX.md`: contratos y estado de producto; algunas secciones son históricas y no sustituyen este resumen.

## Siguiente trabajo recomendado

Estudiar una representación que comparta lecturas ya necesarias de la anatomía regional, sin ocultar órganos, cambiar la resolución ni modificar la identidad. Las rejillas regional y nueva tienen medio voxel de diferencia: simplemente empaquetarlas juntas no conserva automáticamente la geometría. Definir primero precisión, límites, memoria, controles negativos y coste completo; verificar superficies, contactos, cortes y contexto con la misma cámara; medir todas las vistas de forma pareada. No reactivar las variantes rechazadas por inercia.

La prioridad del usuario es una anatomía básica integrada y creíble —relaciones entre órganos, fascias, costillas y vasos— antes de ajustar texturas o filtros. No crear tareas programadas. Conserva incertidumbre, discrepancias, licencias, evidencia negativa y trabajo ajeno; no supongas validación clínica ni infles calificaciones.
