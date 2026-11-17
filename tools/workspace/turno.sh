#!/bin/sh
# Corre una orden pesada (capa lenta, mutantes, build, un push con su gancho) de una en una entre todos los worktrees.
#   tools/workspace/turno.sh VITEST_TIER=slow VITEST_MAX_WORKERS=4 npx vitest run --testTimeout=180000
# Dos baterías a la vez agotan los plazos de las pruebas (60 s): un cerrojo común a los worktrees del repositorio las pone
# en fila. Con TURNO_ESPERA_CARGA=1 espera además hasta 30 min a que la carga media de 1 min baje de 20.
# No salta ganchos ni cambia plazos: solo decide cuándo empieza la orden.
set -u
LOCK="$(git rev-parse --git-common-dir)/push-seguro.lock"
carga() {
  if [ -r /proc/loadavg ]; then cut -d' ' -f1 /proc/loadavg; else sysctl -n vm.loadavg | awk '{print $2}'; fi
}
until mkdir "$LOCK" 2>/dev/null; do
  # cerrojo huérfano: su dueño lo refresca cada 5 min; 30 min sin tocar es que murió
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; fi
  sleep 20
done
(while sleep 300; do touch "$LOCK" 2>/dev/null || exit 0; done) &
KEEP=$!
trap 'kill "$KEEP" 2>/dev/null; rmdir "$LOCK" 2>/dev/null' EXIT
trap 'exit 130' INT TERM
if [ "${TURNO_ESPERA_CARGA:-0}" = 1 ]; then
  i=0
  while [ "$i" -lt 60 ]; do
    l="$(carga | awk '{print int($1)}')"
    [ "$l" -lt 20 ] && break
    i=$((i + 1))
    sleep 30
  done
fi
echo "turno: carga $(carga), rama $(git rev-parse --abbrev-ref HEAD)"
env "$@"
code=$?
echo "turno: exit $code"
exit $code
