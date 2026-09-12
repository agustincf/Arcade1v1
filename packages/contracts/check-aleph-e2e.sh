#!/usr/bin/env bash
# packages/contracts/check-aleph-e2e.sh
# Prueba el PAGO de una mesa de plata de Aleph en cadena local (anvil) con el
# árbitro real: despliega MockUSDC + EscrowAleph, 4 wallets fondean y juegan, el
# árbitro firma la tabla y el contrato paga a todos; después, un fondeo
# incompleto que el árbitro cancela. Requiere Foundry y el monorepo instalado.
# Uso:  bash packages/contracts/check-aleph-e2e.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# El RPC va PINCHADO en cada llamada (forge, cast y el script): así ninguna
# variable heredada del entorno (RPC_URL, ETH_RPC_URL, FOUNDRY_ETH_RPC_URL)
# puede desviar esta prueba a una red de verdad.
RPC=http://localhost:8545

pkill -f anvil 2>/dev/null || true
sleep 1
anvil >/tmp/anvil-aleph-e2e.log 2>&1 &
ANVIL_PID=$!
# Matar anvil en TODA salida, también si una comprobación falla: con `set -e` un
# `kill` al final del archivo no se ejecuta nunca cuando algo revienta antes.
cleanup() { kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT
for i in $(seq 1 15); do
  cast block-number --rpc-url "$RPC" >/dev/null 2>&1 && break
  sleep 1
done
cast block-number --rpc-url "$RPC" >/dev/null 2>&1 ||
  { echo "❌ anvil no levantó"; cat /tmp/anvil-aleph-e2e.log; exit 1; }

KEY0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
PLATFORM=0x90F79bf6EB2c4f870365E785982E1f101E93b906
# El árbitro firma con la cuenta #1 de anvil: pública, sin valor y la misma que
# ya usan offline-env.ts y check-aleph-deploy.sh. NO se lee de ningún .env, ni
# local ni de CI: esta prueba nunca toca una clave de verdad.
ARB_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
ARB_ADDR=0x70997970C51812dc3A010C7d01b50e0d17dc79C8

cd "$ROOT/packages/contracts"
# Sin "2>/dev/null": si forge create falla queremos ver POR QUÉ en el log de CI.
# Y el "|| true" evita que set -e/pipefail corten la línea antes de llegar al
# chequeo de abajo (con pipefail, un forge que falla o un grep sin match hacen
# fallar el pipeline entero, y el "❌" quedaría inalcanzable).
USDC=$(forge create test/MockUSDC.sol:MockUSDC --rpc-url "$RPC" \
  --private-key $KEY0 --broadcast | grep "Deployed to:" | awk '{print $3}') || true
[ -n "$USDC" ] || { echo "❌ No se pudo desplegar el MockUSDC"; exit 1; }

ESCROW=$(forge create src/EscrowAleph.sol:EscrowAleph --rpc-url "$RPC" \
  --private-key $KEY0 --broadcast \
  --constructor-args "$USDC" "$ARB_ADDR" "$PLATFORM" 1500 "$OWNER" \
  | grep "Deployed to:" | awk '{print $3}') || true
[ -n "$ESCROW" ] || { echo "❌ No se pudo desplegar el EscrowAleph"; exit 1; }
echo "  MockUSDC=$USDC · EscrowAleph=$ESCROW · árbitro=$ARB_ADDR · plataforma=$PLATFORM"

# ALEPH_FUNDING_MS corto: el escenario 2 vence el plazo del árbitro con reloj
# inyectado, pero los pases llevan fundDeadline real y anvil sigue el reloj de
# pared; 60 s alcanza para que los depósitos entren antes de vencer.
cd "$ROOT"
USDC_ADDR=$USDC CHAIN_ID=31337 ALEPH_ESCROW_ADDRESS=$ESCROW ALEPH_STAKES=0,2 \
  ALEPH_MAX_SEATS=4 ALEPH_FUNDING_MS=60000 ALEPH_HOUSE_ENABLED=false \
  ARBITER_PRIVATE_KEY=$ARB_KEY RPC_URL=$RPC \
  "$ROOT/node_modules/.bin/tsx" "$ROOT/apps/server/src/aleph-onchain-e2e.ts"
