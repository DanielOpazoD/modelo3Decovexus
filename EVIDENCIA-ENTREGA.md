# Verificación de esta copia

En la preparación local de la copia, con Node 24 y las dependencias del lockfile:

- `npm run build`: aprobado, incluido TypeScript y la comprobación de presupuestos del simulador.
- `npm run lint` y `npm run format:check`: aprobados para el código del simulador y la documentación de raíz. La carpeta de maqueta histórica se excluye de esos controles generales y tiene verificaciones propias.
- `npx playwright test e2e/smoke.spec.ts --project=chromium --grep 'arranca, renderiza cuadros'`: una prueba aprobada sobre el build de producción, con SwiftShader. No es la suite E2E completa.
- `python3 maqueta-anatomica/verificar-datos.py --reconstruir-fuentes`: aprobada; ambos archivos fuente reconstruidos coincidieron por SHA-256 con los originales de trabajo.
- `node maqueta-anatomica/probar-visor.mjs`: las dos versiones abrieron, se comprobaron cortes, teclado y ausencia de desbordamiento móvil en Chromium/Metal.
- Se compararon seis framebuffers de 102 y ocho de 103 con sus originales en Apple M4/Metal: todos coincidieron byte a byte (`maqueta-anatomica/evidencia/PORTABILIDAD.json`).
- La construcción, topología y muestra reservada de la fascia 103 se reprodujeron con los campos incluidos; los arrays de malla coincidieron exactamente (`maqueta-anatomica/evidencia/REPRO-FUENTES.json`). El primer intento detectó cuatro módulos de Python faltantes; se incluyeron y la repetición pasó.

El primer build con dependencias enlazadas a una caché externa falló por permisos al crear un archivo temporal. Se copió la instalación a esta copia aislada y el build posterior pasó; no se modificó la caché original. Estas verificaciones no equivalen a CI completa, validación clínica ni aprobación del coste GPU de la maqueta. El resultado GPU negativo permanece en `maqueta-anatomica/evidencia/RESULTS.md`.
