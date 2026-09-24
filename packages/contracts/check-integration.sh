#!/usr/bin/env bash
# Verifica la INTEGRACION arbitro <-> contrato: que los "digest" EIP-712 que
# firma el arbitro (viem) sean identicos a los que calcula el contrato
# desplegado: el del RESULTADO (con su vencimiento) y el del ASIENTO (con el
# stake y los plazos). Si coinciden, las firmas del arbitro son validas para
# que el contrato acepte el deposito y pague.
#
# Requiere Foundry (anvil, cast, forge) y el monorepo instalado (npm install).
# Uso:  bash packages/contracts/check-integration.sh
set -e
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

pkill -f anvil 2>/dev/null || true
sleep 1
anvil >/tmp/anvil.log 2>&1 &
ANVIL_PID=$!
sleep 2

KEY0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ACCT1=0x70997970C51812dc3A010C7d01b50e0d17dc79C8

cd "$ROOT/packages/contracts"
ESCROW=$(forge create src/Escrow1v1.sol:Escrow1v1 \
  --rpc-url http://localhost:8545 --private-key "$KEY0" --broadcast \
  --constructor-args "$ACCT1" "$ACCT1" "$ACCT1" 1500 "$ACCT1" 2>/dev/null \
  | grep "Deployed to:" | awk '{print $3}')

MATCHID=0x1111111111111111111111111111111111111111111111111111111111111111
WINNER=$ACCT1
DEADLINE=1900000000
STAKE=5000000
FUND_DEADLINE=1800000000
PLAY_DEADLINE=1800003600

RESULT_C=$(cast call "$ESCROW" "resultDigest(bytes32,address,uint64)(bytes32)" \
  "$MATCHID" "$WINNER" "$DEADLINE" --rpc-url http://localhost:8545)
SEAT_C=$(cast call "$ESCROW" "seatDigest(bytes32,address,uint256,uint64,uint64)(bytes32)" \
  "$MATCHID" "$WINNER" "$STAKE" "$FUND_DEADLINE" "$PLAY_DEADLINE" --rpc-url http://localhost:8545)
ARBITER=$(CHAIN_ID=31337 ESCROW_ADDRESS="$ESCROW" MATCHID="$MATCHID" WINNER="$WINNER" \
  DEADLINE="$DEADLINE" PLAYER="$WINNER" STAKE="$STAKE" FUND_DEADLINE="$FUND_DEADLINE" \
  PLAY_DEADLINE="$PLAY_DEADLINE" "$ROOT/node_modules/.bin/tsx" "$ROOT/apps/server/src/digestcheck.ts")
RESULT_A=$(echo "$ARBITER" | sed -n 1p)
SEAT_A=$(echo "$ARBITER" | sed -n 2p)

kill $ANVIL_PID 2>/dev/null || true

lower() { echo "$1" | tr A-Z a-z; }
echo "resultado · contrato: $RESULT_C"
echo "resultado · arbitro:  $RESULT_A"
echo "asiento   · contrato: $SEAT_C"
echo "asiento   · arbitro:  $SEAT_A"
if [ -n "$RESULT_A" ] && [ "$(lower "$RESULT_C")" = "$(lower "$RESULT_A")" ] &&
  [ -n "$SEAT_A" ] && [ "$(lower "$SEAT_C")" = "$(lower "$SEAT_A")" ]; then
  echo "OK: las firmas del arbitro (resultado y asiento) son compatibles con el contrato ✅"
else
  echo "MISMATCH ❌"
  exit 1
fi
