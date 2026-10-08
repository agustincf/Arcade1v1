# Levanta un anvil PROPIO en un puerto libre y lo mata al salir: solo el suyo.
# Antes cada prueba hacía `pkill -f anvil` y se llevaba puesto el anvil de
# cualquiera —el tuyo, o el de otra prueba corriendo al mismo tiempo— y todas
# usaban el 8545 (pre-auditoría DOC-1).
#
# Uso, desde otro script:
#   source "$(dirname "$0")/anvil-propio.sh"
#   anvil_propio            # deja RPC=http://127.0.0.1:<puerto> y ANVIL_PID
# El `trap ... EXIT` que pone mata ese anvil en toda salida, también si una
# comprobación falla antes de terminar.

anvil_propio() {
  local port log
  for _ in $(seq 1 50); do
    port=$((20000 + RANDOM % 20000))
    # ¿Libre? Si algo contesta en ese puerto, se prueba otro.
    (echo >"/dev/tcp/127.0.0.1/$port") 2>/dev/null || break
  done
  log=$(mktemp -t anvil-propio.XXXXXX)
  anvil --port "$port" "$@" >"$log" 2>&1 &
  ANVIL_PID=$!
  RPC="http://127.0.0.1:$port"
  trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT
  for _ in $(seq 1 30); do
    cast block-number --rpc-url "$RPC" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  echo "❌ anvil no levantó"
  cat "$log"
  return 1
}
