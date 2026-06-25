#!/usr/bin/env bash
# Ensaya el script de despliegue REAL (script/Deploy.s.sol) en una cadena local
# (anvil), para que el camino de deploy no se rompa en silencio: verifica que
# despliega el escrow + el USDC de prueba y que deja HABILITADAS las mesas del
# producto (1/2/5/10 USDC). Si las mesas no quedaran habilitadas, los depósitos
# revertirían en producción ("stake not allowed").
#
# Requiere Foundry (anvil, cast, forge). Uso: bash packages/contracts/check-deploy.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")"

pkill -f anvil 2>/dev/null || true
sleep 1
anvil >/tmp/anvil-deploy.log 2>&1 &
ANVIL_PID=$!
for i in $(seq 1 15); do
  cast block-number --rpc-url http://localhost:8545 >/dev/null 2>&1 && break
  sleep 1
done

cleanup() { kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

# Cuentas estándar de anvil (sin plata real). Sin USDC_ADDRESS -> el script
# despliega un TestUSDC con mint abierto, igual que en testnet.
OUT=$(PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  ARBITER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
  PLATFORM_WALLET=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
  FEE_BPS=1500 \
  forge script script/Deploy.s.sol:Deploy --rpc-url http://localhost:8545 --broadcast 2>&1)

echo "$OUT" | grep -E "TestUSDC|Escrow1v1 desplegado|NEXT_PUBLIC|CHAIN_ID" || true

ESCROW=$(echo "$OUT" | sed -n 's/.*NEXT_PUBLIC_ESCROW_ADDRESS=//p' | tr -d ' \r' | head -1)
if [ -z "$ESCROW" ]; then
  echo "❌ No se pudo determinar la dirección del escrow desplegado"
  exit 1
fi

# Verificar que las 4 mesas del producto quedaron habilitadas en el contrato.
ok=1
for amt in 1000000 2000000 5000000 10000000; do
  allowed=$(cast call "$ESCROW" "allowedStake(uint256)(bool)" "$amt" --rpc-url http://localhost:8545)
  echo "  mesa $((amt / 1000000)) USDC -> allowedStake = $allowed"
  [ "$allowed" = "true" ] || ok=0
done

if [ "$ok" = "1" ]; then
  echo "DEPLOY VERIFICADO ✅ (escrow desplegado + mesas 1/2/5/10 habilitadas)"
else
  echo "❌ Alguna mesa quedó deshabilitada (los depósitos revertirían)"
  exit 1
fi
