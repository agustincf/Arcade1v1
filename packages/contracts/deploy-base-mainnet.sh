#!/usr/bin/env bash
# Despliegue de Escrow1v1 a Base MAINNET — DINERO REAL. Firma una Ledger; la
# dueña final es una Safe. Todo lo que hace está en deploy-mainnet.ts:
#   1. chequeos: el código es EXACTAMENTE el aprobado (build-aprobada.json), el
#      árbol está limpio y el commit en main, la red es Base con el USDC real,
#      la Safe es una Safe, la Ledger y el árbitro son cuentas comunes, y
#      alcanza el gas. Si algo falla, no se firma nada.
#   2. confirmación (escribir MAINNET) y deploy: el contrato, las 4 mesas y el
#      traspaso a la Safe (6 firmas en la Ledger), y la fuente a Basescan.
#   3. relectura del contrato desplegado, y los pasos que siguen (la Safe
#      acepta, el árbitro y la web apuntan al contrato).
#
# Requisitos: la Ledger conectada (app de Ethereum abierta) con ETH real en Base,
# `npm ci` en la raíz, y packages/contracts/.env.mainnet con DEPLOYER_ADDRESS
# (la Ledger), SAFE_ADDRESS, ARBITER_ADDRESS, PLATFORM_WALLET,
# ETHERSCAN_API_KEY y BASE_MAINNET_RPC_URL (ver DEPLOY.md).
#
# Uso:  bash packages/contracts/deploy-base-mainnet.sh            # desplegar
#       bash packages/contracts/deploy-base-mainnet.sh chequeos   # solo mirar
#       bash packages/contracts/deploy-base-mainnet.sh verificar <dirección>
#       bash packages/contracts/deploy-base-mainnet.sh fuente <dirección>
#       bash packages/contracts/deploy-base-mainnet.sh hash
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=".env.mainnet"
[ -f "$ENV_FILE" ] || { echo "❌ Falta packages/contracts/$ENV_FILE (ver DEPLOY.md)"; exit 1; }
set -a
. "./$ENV_FILE"
set +a

exec ../../node_modules/.bin/tsx deploy-mainnet.ts "${@:-desplegar}"
