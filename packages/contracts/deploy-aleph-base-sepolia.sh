#!/usr/bin/env bash
# packages/contracts/deploy-aleph-base-sepolia.sh
# Despliega EscrowAleph (mesas de plata de Aleph) en Base Sepolia, reusando la
# wallet de deploy y el TestUSDC de `.env` (los creó deploy-base-sepolia.sh).
# Uso: bash deploy-aleph-base-sepolia.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -d "$HOME/.foundry/bin" ] && PATH="$HOME/.foundry/bin:$PATH"

ENV_FILE=".env"
RPC="${RPC_URL:-https://sepolia.base.org}"

if ! command -v forge >/dev/null 2>&1; then
  echo "❌ Falta Foundry (forge/cast). Instalalo: https://book.getfoundry.sh/getting-started/installation"
  exit 1
fi
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

for v in PRIVATE_KEY USDC_ADDRESS ARBITER_ADDRESS PLATFORM_WALLET FEE_BPS; do
  if [ -z "${!v:-}" ]; then
    echo "❌ Falta $v en $ENV_FILE (corré primero deploy-base-sepolia.sh, que deja la wallet y el USDC)."
    exit 1
  fi
done

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
BAL=$(cast balance "$DEPLOYER" --rpc-url "$RPC" 2>/dev/null || echo 0)
echo "Deployer: $DEPLOYER"
echo "Saldo:    $BAL wei  (red: $RPC)"
if [ "$BAL" = "0" ]; then
  echo "⛽ Sin gas. Fondeá $DEPLOYER en un faucet de Base Sepolia y reintentá."
  exit 1
fi

echo ""
echo "🚀 Desplegando EscrowAleph a Base Sepolia..."
forge script script/DeployAleph.s.sol:DeployAleph --rpc-url "$RPC" --broadcast -vv

echo ""
echo "✅ Listo. Copiá ALEPH_ESCROW_ADDRESS y ALEPH_STAKES al árbitro (Render) y"
echo "   redeployalo. La web no necesita variables nuevas."
