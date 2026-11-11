# Maqueta anatómica 102 → 103

Prototipo de anatomía en colores planos, independiente del simulador. Tras `npm ci` en la raíz, servir la raíz con `python3 -m http.server 4175 --bind 127.0.0.1` y abrir `/maqueta-anatomica/`; la versión anterior está en `/maqueta-anatomica/base-102.html`. No necesita descargar datos anatómicos al iniciarse. El navegador carga fragmentos del repositorio, verifica sus hashes, descomprime el atlas y aplica un parche exacto para la versión 103. El verificador offline comprueba también el hash del atlas resultante.

`comparaciones/` contiene los antes/después; `evidencia/RESULTS.md` explica lo conseguido y lo que falló. **La versión 103 sigue siendo experimental: su coste GPU aumenta y la inserción fascial directa no está completada.** No es una imagen de TAC ni una simulación ecográfica validada.

Los datos de un caso no prueban variación poblacional. Falta revisión experta y parte de la fuente original no está disponible en este paquete. Véanse `../CONTEXTO-IA.md` y `ATRIBUCION.md`.
