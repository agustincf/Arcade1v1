#!/usr/bin/env bash
# Verifica la INTEGRACION arbitro <-> contrato: que el "digest" EIP-712 que
# firma el arbitro (viem) sea identico al que calcula el contrato desplegado.
# Si coinciden, la firma del arbitro es valida para que el contrato pague.
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

CONTRACT=$(cast call "$ESCROW" "resultDigest(bytes32,address)(bytes32)" \
  "$MATCHID" "$WINNER" --rpc-url http://localhost:8545)
ARBITER=$(CHAIN_ID=31337 ESCROW_ADDRESS="$ESCROW" MATCHID="$MATCHID" WINNER="$WINNER" \
  "$ROOT/node_modules/.bin/tsx" "$ROOT/apps/server/src/digestcheck.ts")

kill $ANVIL_PID 2>/dev/null || true

echo "contrato: $CONTRACT"
echo "arbitro:  $ARBITER"
if [ "$(echo "$CONTRACT" | tr A-Z a-z)" = "$(echo "$ARBITER" | tr A-Z a-z)" ]; then
  echo "OK: la firma del arbitro es compatible con el contrato ✅"
else
  echo "MISMATCH ❌"
  exit 1
fi
