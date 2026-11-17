# Varias PR a la vez con agentes: worktrees, turnos y carga

Cómo trabajar en paralelo sin que las ramas se pisen ni la máquina agote los plazos de las pruebas. Nació el 16–17-11-2026,
tras una tarde en que tres pushes fallaron solo por carga (media de 100–166) y la CI se canceló dos veces por un runner lento.

## Un worktree por PR

```
git fetch -q origin
git worktree add --no-track ../wt/<nombre> -b <rama> origin/main
ln -s "$PWD/node_modules" ../wt/<nombre>/node_modules
```

- El checkout principal sirve el servidor de desarrollo: quien edita ahí no puede estar a la vez bajo el gancho de un push
  (el gancho prueba el árbol de trabajo). Las PR en vuelo van en worktrees.
- Nunca `git stash` ni cambiar de rama con el servidor o una batería corriendo.
- Para ver un worktree en el navegador, su propio servidor en otro puerto: `npx vite --port 6603 --strictPort`.
- Las PR que tocan GLSL comparten `shader-hashes.json`, y las que añaden una decisión, el final de `docs/DECISIONS.md`:
  apílalas (cada una sobre la anterior) en vez de abrirlas en paralelo desde `main`, y reapunta la dependiente a `main` antes
  de fusionar su base. Los números de decisión no se reservan: van seguidos y sin huecos (`docs.test.ts`), así que cada PR
  toma el siguiente libre de `origin/main` en su último rebase, y la que se fusiona segunda renumera.

## Una sola batería pesada a la vez

`tools/workspace/turno.sh <orden>` toma un cerrojo común a todos los worktrees y corre la orden, por orden de llegada.
`tools/workspace/push-seguro.sh origin <rama>` es lo mismo para `git push` con su gancho completo, esperando además a que baje
la carga. Ninguno salta ganchos ni toca plazos: solo deciden cuándo empieza la orden.

- **El agente no corre la capa rápida entera por su cuenta**: la corre el gancho al empujar, con turno. Antes le bastan tipos,
  lint, formato, `npm run docs:index` y los archivos de prueba que tocó o que vigilan lo que tocó (`VITEST_MAX_WORKERS=2`).
  Tres agentes con su batería a la vez llevaron la carga a 200 el 17-11 y ningún gancho terminó sin agotar plazos.
- La capa lenta, los mutantes y `vite build` van con `turno.sh`.
- El gancho aborta («El hook modificó HEAD, índice o configuración Git») si el `config` común a los worktrees cambia mientras
  corre, aunque lo cambie otro worktree. Lo escriben crear una rama con seguimiento (por eso `--no-track`), `git push -u`,
  borrar una rama con seguimiento y `git config`: no lo hagas mientras exista el cerrojo (`.git/push-seguro.lock`).
- Rebasa sobre `origin/main` antes de empujar: el gancho elige sus pruebas por el diff con `origin/main`, y una rama atrasada
  le hace correr la capa rápida entera aunque solo toque documentación.

## Carga y plazos

- `Test timed out in 60000ms` (o 180 s en la capa lenta) con la máquina cargada no es un fallo del cambio: repite ese
  archivo solo, con el plazo estándar. Si pasa solo, anótalo en la PR; si no, es real.
- Las cifras de tiempo medidas con la máquina saturada no valen: compara antes y después en la misma condición y dilo.
- En la CI, antes de culpar al cambio de un trabajo cancelado por su tope, compara los tiempos por archivo del artefacto
  `validation-core` con los de `main`: un runner lento sube todos los archivos por igual (1,5–1,9× el 16-11).
- Cambio de GLSL o de datos de la persona: `docs/engineering/cambio-glsl.md`.

## Encargo a un agente

Dale el objetivo, lo ya descartado, los archivos por los que empezar, la medida que decide si la PR se abre («si no gana un
X %, informa y no abras PR») y si el cambio lleva decisión. Pídele en el informe la PR, las cifras antes y después, lo
que no hizo y sus dudas. El coordinador fusiona con la CI del último commit en verde; el agente no fusiona.
