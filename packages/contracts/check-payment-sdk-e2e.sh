#!/usr/bin/env bash
# Prueba que un AGENTE DEL SDK juega una mesa 1v1 de plata solo, en cadena local
# (anvil): despliega USDC (con blacklist) + Escrow1v1 y corre
# apps/server/src/sdk-1v1-onchain-e2e.ts, donde cada agente hace
# playAndSubmit({ game: "racing", stake: 1 }) contra el árbitro real por HTTP:
# revisa, se sienta, aprueba, deposita, juega en vivo, y el árbitro paga o
# reembolsa. Escenarios: gana uno y cobra, empate y reembolso, y un ganador en
# la blacklist que cobra lo acreditado con withdraw1v1().
# Requiere Foundry y el monorepo instalado (npm install).
# Uso:  bash packages/contracts/check-payment-sdk-e2e.sh
set -e
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

source "$ROOT/packages/contracts/anvil-propio.sh"
anvil_propio

KEY0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
PLATFORM=0x90F79bf6EB2c4f870365E785982E1f101E93b906
# El árbitro firma con la cuenta #9 de anvil: pública y sin valor. NO se lee de
# ningún .env, ni local ni de CI: esta prueba nunca toca una clave de verdad.
# No es la #1 (la de offline-env.ts y el e2e de Aleph) porque acá la #1 es P1, y
# los reverts minados del final necesitan al árbitro en otra cuenta: desde la
# misma, el nonce minaría su cancel antes que lo que tiene que adelantársele.
ARB_KEY=0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6
ARB_ADDR=$(cast wallet address --private-key "$ARB_KEY")

cd "$ROOT/packages/contracts"
# BlacklistUSDC es MockUSDC con la blacklist de Circle (para el ganador bloqueado).
USDC=$(forge create test/BlacklistUSDC.sol:BlacklistUSDC --rpc-url $RPC \
  --private-key $KEY0 --broadcast 2>/dev/null | grep "Deployed to:" | awk '{print $3}')
ESCROW=$(forge create src/Escrow1v1.sol:Escrow1v1 --rpc-url $RPC \
  --private-key $KEY0 --broadcast \
  --constructor-args "$USDC" "$ARB_ADDR" "$PLATFORM" 1500 "$OWNER" 2>/dev/null \
  | grep "Deployed to:" | awk '{print $3}')

# RPC_URL va pinchado: una variable heredada del entorno no puede desviar esta
# prueba a una red de verdad.
USDC_ADDR=$USDC ESCROW_ADDR=$ESCROW CHAIN_ID=31337 ESCROW_ADDRESS=$ESCROW \
  ARBITER_PRIVATE_KEY=$ARB_KEY RPC_URL=$RPC \
  "$ROOT/node_modules/.bin/tsx" "$ROOT/apps/server/src/sdk-1v1-onchain-e2e.ts"
CODE=$?

kill $ANVIL_PID 2>/dev/null || true
exit $CODE
