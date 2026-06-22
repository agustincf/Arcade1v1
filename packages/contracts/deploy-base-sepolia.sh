#!/usr/bin/env bash
# Deploy "llave en mano" a Base Sepolia.
#  1ra corrida: si no hay wallet, crea una descartable (queda SOLO en .env local)
#               y te da la DIRECCIÓN para fondear en un faucet.
#  2da corrida: con gas en la wallet, despliega el USDC de prueba + el escrow
#               e imprime las variables para pegar en la web y el árbitro.
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=".env"
RPC="${RPC_URL:-https://sepolia.base.org}"

if ! command -v forge >/dev/null 2>&1; then
  echo "❌ Falta Foundry (forge/cast). Instalalo: https://book.getfoundry.sh/getting-started/installation"
  exit 1
fi

# Cargar .env si existe.
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

# 1) Wallet de deploy.
if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "🔑 No hay wallet de deploy. Genero una descartable (queda SOLO en $ENV_FILE)..."
  NEW=$(cast wallet new)
  ADDR=$(echo "$NEW" | sed -n 's/.*Address: *//p' | tr -d ' ')
  KEY=$(echo "$NEW" | sed -n 's/.*Private key: *//p' | tr -d ' ')
  printf '\nPRIVATE_KEY=%s\n' "$KEY" >> "$ENV_FILE"
  echo ""
  echo "✅ Wallet creada (la clave quedó en $ENV_FILE, NO la compartas)."
  echo "📬 DIRECCIÓN (esta SÍ podés compartirla / pegarla en el faucet):"
  echo "    $ADDR"
  echo ""
  echo "👉 Pasos: 1) Fondeala con ETH de Base Sepolia en un faucet."
  echo "          2) Volvé a correr este script para desplegar."
  exit 0
fi

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
BAL=$(cast balance "$DEPLOYER" --rpc-url "$RPC" 2>/dev/null || echo 0)
echo "Deployer: $DEPLOYER"
echo "Saldo:    $BAL wei  (red: $RPC)"

if [ "$BAL" = "0" ]; then
  echo ""
  echo "⛽ Sin gas. Fondeá esta dirección en un faucet de Base Sepolia y reintentá:"
  echo "    $DEPLOYER"
  exit 1
fi

echo ""
echo "🚀 Desplegando a Base Sepolia..."
forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC" --broadcast -vv

echo ""
echo "✅ Listo. Copiá las líneas NEXT_PUBLIC_... a apps/web/.env.local,"
echo "   ESCROW_ADDRESS/CHAIN_ID a apps/server/.env, y reiniciá ambos servidores."
