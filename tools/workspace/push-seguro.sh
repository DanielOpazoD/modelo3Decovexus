#!/bin/sh
# Empuja la rama actual con el gancho completo, de uno en uno entre worktrees y con la máquina tranquila.
#   tools/workspace/push-seguro.sh origin <rama>     (desde el worktree de la rama; los argumentos van a `git push`)
# Es `turno.sh` (el cerrojo común) esperando además a que baje la carga. No salta ganchos ni cambia plazos.
TURNO_ESPERA_CARGA=1 exec "$(dirname "$0")/turno.sh" VITEST_MAX_WORKERS="${VITEST_MAX_WORKERS:-4}" git push "$@"
