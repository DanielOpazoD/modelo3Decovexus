#!/bin/sh
# Corre una orden pesada (capa lenta, mutantes, build, un push con su gancho) de una en una entre todos los worktrees.
#   tools/workspace/turno.sh VITEST_TIER=slow VITEST_MAX_WORKERS=4 npx vitest run --testTimeout=180000
# Dos baterías a la vez agotan los plazos de las pruebas (60 s): un cerrojo común a los worktrees del repositorio las pone
# en fila, por orden de llegada. Con TURNO_ESPERA_CARGA=1 espera además hasta 30 min a que la carga media de 1 min baje de 20.
# No salta ganchos ni cambia plazos: solo decide cuándo empieza la orden.
set -u
LOCK="$(git rev-parse --git-common-dir)/push-seguro.lock"
QUEUE="$LOCK.cola"
carga() {
  if [ -r /proc/loadavg ]; then cut -d' ' -f1 /proc/loadavg; else sysctl -n vm.loadavg | awk '{print $2}'; fi
}
# Un número por llegada: quien llega antes pasa antes. Sin él ganaba quien sondeaba primero, y con ocho en cola alguno
# esperó 90 min (17-11-2026). El número es «<segundos>-<pid>»: ordena por llegada y dice de quién es.
mkdir -p "$QUEUE"
TICKET="$QUEUE/$(date +%s)-$$"
: >"$TICKET"
trap 'rm -f "$TICKET"' EXIT
trap 'exit 130' INT TERM
primero() {
  # Números huérfanos: su proceso ya no existe.
  for t in "$QUEUE"/*; do
    [ -e "$t" ] || continue
    kill -0 "${t##*-}" 2>/dev/null || rm -f "$t"
  done
  [ "$(ls "$QUEUE" | sort | head -1)" = "${TICKET##*/}" ]
}
until primero && mkdir "$LOCK" 2>/dev/null; do
  # cerrojo huérfano: su dueño lo refresca cada 5 min; 30 min sin tocar es que murió
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; fi
  sleep 10
done
rm -f "$TICKET"
# El dueño refresca el cerrojo cada 5 min mientras viva. Sin salida propia: heredar la del guion dejaría colgada hasta 5 min
# a quien la filtre con una tubería (`turno.sh … | tail`), porque su `sleep` la mantendría abierta.
(while sleep 300; do
  kill -0 $$ 2>/dev/null || exit 0
  [ -d "$LOCK" ] && touch "$LOCK"
done) >/dev/null 2>&1 &
KEEP=$!
trap 'kill "$KEEP" 2>/dev/null; rmdir "$LOCK" 2>/dev/null' EXIT
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
