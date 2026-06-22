#!/usr/bin/env bash
# Prueba el PAGO completo en cadena local (anvil): despliega USDC + escrow,
# dos jugadores depositan, el arbitro firma y el contrato paga al ganador + comision.
# Requiere Foundry y el monorepo instalado (npm install).
# Uso:  bash packages/contracts/check-payment-e2e.sh
set -e
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

pkill -f anvil 2>/dev/null || true
sleep 1
anvil >/tmp/anvil.log 2>&1 &
ANVIL_PID=$!
for i in $(seq 1 15); do cast block-number --rpc-url http://localhost:8545 >/dev/null 2>&1 && break; sleep 1; done

KEY0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
PLATFORM=0x90F79bf6EB2c4f870365E785982E1f101E93b906
ARB_KEY=$(grep '^ARBITER_PRIVATE_KEY=' "$ROOT/apps/server/.env" | cut -d= -f2)
ARB_ADDR=$(cast wallet address --private-key "$ARB_KEY")

cd "$ROOT/packages/contracts"
USDC=$(forge create test/MockUSDC.sol:MockUSDC --rpc-url http://localhost:8545 \
  --private-key $KEY0 --broadcast 2>/dev/null | grep "Deployed to:" | awk '{print $3}')
ESCROW=$(forge create src/Escrow1v1.sol:Escrow1v1 --rpc-url http://localhost:8545 \
  --private-key $KEY0 --broadcast \
  --constructor-args "$USDC" "$ARB_ADDR" "$PLATFORM" 1500 "$OWNER" 2>/dev/null \
  | grep "Deployed to:" | awk '{print $3}')

USDC_ADDR=$USDC ESCROW_ADDR=$ESCROW CHAIN_ID=31337 ESCROW_ADDRESS=$ESCROW \
  ARBITER_PRIVATE_KEY=$ARB_KEY \
  "$ROOT/node_modules/.bin/tsx" "$ROOT/apps/server/src/onchain-e2e.ts"
CODE=$?

kill $ANVIL_PID 2>/dev/null || true
exit $CODE
