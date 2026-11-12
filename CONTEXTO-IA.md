# Contexto de continuidad para otra IA o desarrollador

## Qué contiene este repositorio

- El simulador ecográfico VExUS completo está en la raíz: aplicación TypeScript/WebGL, recursos anatómicos, pruebas, documentación, herramientas y configuraciones. La base importada corresponde a `DanielOpazoD/vexus-sim` en `adaf67255268f021b06575d2663a26c881e4f663` (PR #353 integrada allí).
- `maqueta-anatomica/` es una **aplicación exploratoria 3D separada**, para estudiar anatomía con colores planos y sin moteado. Sus cambios no están integrados en el simulador. Incluye la maqueta 102, el prototipo 103, datos, inventario, comparaciones y evidencias resumidas.
- Las mejoras de `wip/red-renal-73` se integraron en `main` mediante [PR #1](https://github.com/DanielOpazoD/modelo3Decovexus/pull/1). Incluyen un rediseño estimado del seno, las pirámides y la red interlobar de `current`, junto con una optimización nativa de A0; no trasladan la maqueta a `s0028`. El [run de CI del commit `2de528f`](https://github.com/DanielOpazoD/modelo3Decovexus/actions/runs/43104280280) terminó correctamente, con 208 E2E en 12 grupos y sin reintentos. Esa CI no es validación clínica.
- El Worker de corte reutiliza ahora una instalación de persona aún en curso cuando se cambia rápidamente de caso y coinciden identidad y `assetKey`; sólo el epoch vigente publica el mapa. La prueba determinista reproduce el error en la versión anterior y la entrega del mapa en la corregida. Los resultados de GPU de la investigación posterior siguen siendo experimentales.
- Para esa corrección se amplió deliberadamente el techo de JavaScript de `s0028` en 1 KiB, de 1.070.080 a 1.071.104 bytes; el build medido usa 1.070.084. `default`, los límites por archivo y los presupuestos GPU siguen iguales. Las pruebas conservan el rechazo de un byte por encima del techo aplicable.

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

Para el head renal de PR #1 se ejecutaron localmente check completo (2.330 pruebas y 16 fallos esperados), calibración y pruebas renales seleccionadas con la configuración Metal. Una ejecución local separada con SwiftShader agotó el tiempo de espera en `renalCutTracking`; no se ocultó ni se atribuyó a una diferencia anatómica. La CI completa posterior del commit `2de528f` pasó, incluidas las 208 E2E de sus 12 grupos. Los informes anteriores de `continuidad/red-renal-73/` incluyen además un banco GPU histórico de ocho estados con −46,91 % agregado: no equivale al coste de la maqueta ni verifica los 221 archivos históricos que estaban sin materializar.

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

Desde el 11-11-2026 el rumbo está en `docs/REGLAS.md`: la maqueta 103 queda congelada como visor de consulta y el trabajo pasa a completar la persona `s0028` del simulador por lo que se ve en las ventanas VExUS (interior renal, venas hepáticas y porta del mismo hígado, VCI–aurícula derecha) hasta que sea la única anatomía. La hipótesis anterior de una representación conjunta para abaratar 103 se conserva en `maqueta-anatomica/evidencia/NEXT-DECISION.md`, sin trabajo asignado.

La investigación posterior para unir la maqueta con el simulador y sus resultados negativos están resumidos en [`maqueta-anatomica/evidencia/puente-s0028-20261111/README.md`](maqueta-anatomica/evidencia/puente-s0028-20261111/README.md). Son experimentos externos: no hay un candidato integrado ni una demostración de coste GPU aceptable. Mantener la identidad `s0028`, las certezas O/D/E/U y los conflictos con las estructuras existentes; no copiar la anatomía de `current` a esa persona. Antes de integrar hay que comprobar los gemelos CPU/Worker/GLSL, la geometría de superficie, el coste y la memoria del programa completo y la revisión visual independiente.

La prioridad del usuario es una anatomía básica integrada y creíble —relaciones entre órganos, fascias, costillas y vasos— antes de ajustar texturas o filtros. No crear tareas programadas. Conserva incertidumbre, discrepancias, licencias, evidencia negativa y trabajo ajeno; no supongas validación clínica ni infles calificaciones.
