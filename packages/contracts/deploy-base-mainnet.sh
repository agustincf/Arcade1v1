#!/usr/bin/env bash
# Despliegue a Base MAINNET — DINERO REAL. Con guardas y wallet de hardware.
#
# Requisitos (ver .env.mainnet.example + el checklist de DEPLOY.md):
#   - Una WALLET DE HARDWARE (Ledger/Trezor) conectada, con ETH real para gas.
#   - .env.mainnet completo (USDC real, ARBITER_ADDRESS, PLATFORM_WALLET, FEE_BPS,
#     OWNER_ADDRESS). OWNER_ADDRESS = la dirección de tu hardware wallet.
#
# Uso:  bash packages/contracts/deploy-base-mainnet.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")"

ENV_FILE=".env.mainnet"
[ -f "$ENV_FILE" ] || { echo "❌ Falta $ENV_FILE (copialo de .env.mainnet.example y completalo)"; exit 1; }
set -a; . "$ENV_FILE"; set +a

# Exigir todas las variables (sin claves: la firma la pone la hardware wallet).
for v in BASE_MAINNET_RPC_URL USDC_ADDRESS ARBITER_ADDRESS PLATFORM_WALLET FEE_BPS OWNER_ADDRESS; do
  [ -n "${!v:-}" ] || { echo "❌ Falta $v en $ENV_FILE"; exit 1; }
done

# Confirmar que el USDC configurado es el real de Base (symbol == USDC, 6 decimales).
SYM=$(cast call "$USDC_ADDRESS" 'symbol()(string)' --rpc-url "$BASE_MAINNET_RPC_URL" 2>/dev/null || echo "")
DEC=$(cast call "$USDC_ADDRESS" 'decimals()(uint8)' --rpc-url "$BASE_MAINNET_RPC_URL" 2>/dev/null || echo "")
echo "USDC configurado: $USDC_ADDRESS  ($SYM, $DEC decimales)"
[ "$SYM" = '"USDC"' ] && [ "$DEC" = "6" ] || { echo "❌ Ese USDC_ADDRESS no parece el USDC real de Base. Abortando."; exit 1; }

cat <<EOF

⚠️  ESTÁS POR DESPLEGAR EN BASE MAINNET — ESTO MANEJA DINERO REAL.
    Dueño/admin del contrato : $OWNER_ADDRESS  (debe ser tu hardware wallet)
    Árbitro (firma pagos)    : $ARBITER_ADDRESS
    Wallet de comisión       : $PLATFORM_WALLET
    Comisión                 : $FEE_BPS bps
    USDC                     : $USDC_ADDRESS

EOF
read -r -p 'Escribí MAINNET en mayúsculas para confirmar: ' CONFIRM
[ "$CONFIRM" = "MAINNET" ] || { echo "Cancelado."; exit 1; }

echo "🚀 Desplegando (firmá en tu hardware wallet)..."
# --ledger: firma con Ledger. Para Trezor usá --trezor; para un keystore, --account <nombre>.
forge script script/DeployMainnet.s.sol:DeployMainnet \
  --rpc-url "$BASE_MAINNET_RPC_URL" \
  --ledger --sender "$OWNER_ADDRESS" \
  --broadcast -vv

echo ""
echo "✅ Listo. Pegá las líneas NEXT_PUBLIC_... en apps/web (producción),"
echo "   y ESCROW_ADDRESS/CHAIN_ID=8453 en el árbitro (producción). Reiniciá ambos."
