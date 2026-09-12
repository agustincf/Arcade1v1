#!/usr/bin/env bash
# packages/contracts/check-aleph-deploy.sh
# Ensaya el script de despliegue REAL de EscrowAleph (script/DeployAleph.s.sol)
# en una cadena local (anvil): despliega un MockUSDC, corre el script sobre él y
# verifica que la mesa de 2 USDC quedó habilitada (si no, los depósitos
# revertirían en producción con "stake not allowed").
# Requiere Foundry (anvil, cast, forge). Uso: bash packages/contracts/check-aleph-deploy.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")"

pkill -f anvil 2>/dev/null || true
sleep 1
anvil >/tmp/anvil-aleph-deploy.log 2>&1 &
ANVIL_PID=$!
for i in $(seq 1 15); do
  cast block-number --rpc-url http://localhost:8545 >/dev/null 2>&1 && break
  sleep 1
done
cleanup() { kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

KEY0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
# Sin "2>/dev/null": si forge create falla queremos ver POR QUÉ en el log de CI.
# Y el "|| true" evita que set -e/pipefail corten la línea antes de llegar al
# chequeo de abajo (con pipefail, un forge que falla o un grep sin match hacen
# fallar el pipeline entero, y el "❌" de la siguiente línea quedaría inalcanzable).
USDC=$(forge create test/MockUSDC.sol:MockUSDC --rpc-url http://localhost:8545 \
  --private-key $KEY0 --broadcast | grep "Deployed to:" | awk '{print $3}') || true
[ -n "$USDC" ] || { echo "❌ No se pudo desplegar el MockUSDC"; exit 1; }

OUT=$(PRIVATE_KEY=$KEY0 \
  USDC_ADDRESS=$USDC \
  ARBITER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
  PLATFORM_WALLET=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
  FEE_BPS=1500 \
  forge script script/DeployAleph.s.sol:DeployAleph --rpc-url http://localhost:8545 --broadcast 2>&1)
echo "$OUT" | grep -E "EscrowAleph desplegado|ALEPH_ESCROW_ADDRESS|ALEPH_STAKES" || true

ESCROW=$(echo "$OUT" | sed -n 's/.*ALEPH_ESCROW_ADDRESS=//p' | tr -d ' \r' | head -1)
[ -n "$ESCROW" ] || { echo "❌ No se pudo determinar la dirección del EscrowAleph"; exit 1; }

allowed=$(cast call "$ESCROW" "allowedStake(uint256)(bool)" 2000000 --rpc-url http://localhost:8545)
echo "  mesa 2 USDC -> allowedStake = $allowed"
usdcOn=$(cast call "$ESCROW" "usdc()(address)" --rpc-url http://localhost:8545)
echo "  usdc() = $usdcOn (esperado $USDC)"
if [ "$allowed" = "true" ] && [ "$(echo "$usdcOn" | tr A-Z a-z)" = "$(echo "$USDC" | tr A-Z a-z)" ]; then
  echo "DEPLOY DE ALEPH VERIFICADO ✅ (EscrowAleph sobre el USDC dado + mesa de 2 USDC habilitada)"
else
  echo "❌ El deploy de Aleph no dejó la mesa habilitada o apunta a otro USDC"
  exit 1
fi
