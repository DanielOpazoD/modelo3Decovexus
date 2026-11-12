# Reglas vigentes

Vigentes desde el 11-11-2026 por autorización del responsable («puedes cambiar reglas»; decisión 340). Esta página cabe en una
pantalla a propósito. Si otro documento del repositorio la contradice, manda esta página; la misión sigue en `docs/MISION.md`.

## Rumbo

1. **Una sola anatomía.** La persona `s0028` pasa a ser la única. No se abre trabajo nuevo sobre `default` ni `legacy`: solo se
   mantienen en verde hasta el corte y después se borran.
2. **Orden por lo que se ve.** `s0028` se completa en el orden en que sus faltas se ven en las ventanas VExUS, no por número de
   fase: interior renal, venas hepáticas y porta de ese mismo hígado, VCI–aurícula derecha.
3. **La maqueta 103 queda congelada** como visor de consulta. No se integra ni se le añade anatomía.
4. **Antes de más trabajo de textura o moteado**, una sesión con ecografistas reales. Los jueces por agentes no cuentan como
   evaluación.

## Alcance

Una estructura entra solo si se distingue en una ventana VExUS con el convexo (2–5 MHz) o si cambia una medida o el grado. Lo que
no cumple ninguna de las dos no se modela, por correcto que sea anatómicamente.

## Aceptación

- **Manda lo que se ve** (responsable, 12-11-2026): el objetivo es que la imagen se vea real, no que se calcule como si lo fuera.
  Cada ventana se juzga mirándola como un ecografista, con cuatro preguntas: qué debe verse, qué no debe verse, qué relaciones
  deben observarse y cuáles no. Una imagen que cumple sus pruebas y no se parece a una ecografía está mal; se corrige la causa
  (material, artefacto, pose o anatomía) y la cifra se ajusta después. Decisión 351.
- **Anatomía e imagen:** la lista de `docs/anatomia/relaciones-tac.md` sobre láminas del mismo plano, modelo y TAC, que el
  responsable puede ver. Los números confirman lo que se ve y detectan retrocesos; no son metas.
- **Código:** la CI del último commit del PR en verde (check y e2e). El `npm run check` local completo ya no es obligatorio cuando
  la CI corre lo mismo; en local bastan el gancho de push y las pruebas del área tocada. Sin CI disponible, el check local la
  sustituye.
- **Fusión:** el responsable autorizó el 12-11-2026 crear y fusionar PR sin consultar cada una, con la CI del último commit en
  verde. Los ajustes del repositorio siguen necesitando su permiso.

## Coste GPU

Techo absoluto, no relativo: **el bucle real de la aplicación sostiene 60 fps con la sonda quieta en cada estado del banco** (campo
`fps` de `npm run fidelity`, la lectura del propio HUD), en el equipo de referencia (Apple M4, Metal) sin otra carga. Un cambio que lo
mantiene pasa, suba o baje el coste respecto de `main`; la cifra se anota en el PR. Con carga ajena no se concluye nada absoluto: se
miden las dos versiones a la vez, alternadas, y se informa la razón entre ellas.

Se mide el bucle real, no un sustituto. El 11-11-2026 `frameCostMs` (cuadros síncronos fuera del bucle) dio un 33 % más de coste a la
red renal de la decisión 339, que en el bucle real resultó un 30 % más rápida con la sonda quieta y un 8 % girándola.

Los techos duros no se mueven para obtener verde: samplers, ranuras de uniforms y los tokens y ramas que tumban el JIT de
SwiftShader. Los autoimpuestos (bundle, descarga, memoria) se suben solo declarando la cifra al responsable.

## Evidencia y documentación

- `docs/estado/` es la verdad vigente y se actualiza en el mismo PR. `docs/DECISIONS.md` y `docs/CONTINUIDAD.md` son archivo: no
  hace falta leerlos para trabajar.
- Una decisión nueva ocupa diez líneas como máximo, con la plantilla de `CONTRIBUTING.md`.
- La evidencia de un PR es la lámina de antes y después y la cifra clave. No se producen manifiestos con hash, recibos, cierres
  seriales ni verificadores de verificadores, salvo que el responsable los pida.
- Un intento fallido se registra en una línea («se probó X, falló por Y»). No se conservan carpetas de negativos.

## Lo que no cambia

- **Causalidad:** nada asigna un grado ni dibuja una onda.
- **Anatomía TS = GLSL**, con su prueba de paridad.
- **Honestidad:** lo que no tiene respaldo se etiqueta, lo que el modelo no hace se declara, y no se afirma validación clínica.
- **Ningún fallo silencioso.**
- No se reducen física, resolución ni aserciones, ni se omiten hooks, para obtener verde.
