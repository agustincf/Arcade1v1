#!/usr/bin/env bash
# packages/contracts/smoke-aleph-base-sepolia.sh
# Corre el SMOKE de la mesa de plata de Aleph en Base Sepolia
# (scripts/aleph-money-smoke.mjs): 4 wallets efímeras se sientan en la mesa de
# 2 USDC del árbitro publicado, depositan, juegan y cobran. Las fondea la wallet
# de deploy de `.env` (PRIVATE_KEY). Cuesta gas de testnet y tarda 15-30 min.
# Las demás variables de `.env` que el smoke entiende (RPC_URL, por ejemplo)
# también valen.
# Uso: bash smoke-aleph-base-sepolia.sh [<ALEPH_ESCROW_ADDRESS>] [--preflight]
#      El escrow puede venir también del entorno (ALEPH_ESCROW_ADDRESS=0x… bash …).
#      Con --preflight corre solo el chequeo previo, de solo lectura.
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=".env"

# El escrow que elige quien corre el smoke (primer argumento o entorno) se toma
# ANTES de cargar `.env`: así un ALEPH_ESCROW_ADDRESS viejo en `.env` no lo pisa.
ESCROW="${ALEPH_ESCROW_ADDRESS:-}"
if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
  ESCROW="$1"
  shift
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Falta Node.js."
  exit 1
fi
if [ ! -d ../../node_modules/tsx ]; then
  echo "❌ Falta instalar el monorepo: corré npm ci en la raíz del repo."
  exit 1
fi
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
# `set -a` exporta TODO lo de `.env`, la clave incluida. Se le saca la marca de
# exportación: la clave le llega solo al smoke, como FUNDER_KEY, y a ningún otro
# proceso.
export -n PRIVATE_KEY

ESCROW="${ESCROW:-${ALEPH_ESCROW_ADDRESS:-}}"
if [ -z "$ESCROW" ]; then
  echo "❌ Falta ALEPH_ESCROW_ADDRESS (la dirección de EscrowAleph): pasala como primer argumento o por entorno."
  exit 1
fi
if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "❌ Falta PRIVATE_KEY en $ENV_FILE: es la wallet que fondea el smoke."
  exit 1
fi

# Acá no se imprime ni la clave ni el escrow: en ese argumento se puede pegar una
# clave por error, y el smoke valida el pin sin mostrarlo. La dirección de la
# wallet que fondea la imprime el smoke; derivarla acá con `cast wallet address
# --private-key` pondría la clave en una línea de comandos, visible en `ps`.
FUNDER_KEY="$PRIVATE_KEY" ALEPH_ESCROW_ADDRESS="$ESCROW" \
  node --import tsx ../../scripts/aleph-money-smoke.mjs ${@+"$@"}
