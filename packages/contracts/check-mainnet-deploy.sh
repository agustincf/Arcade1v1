#!/usr/bin/env bash
# Ensayo del deploy a MAINNET (W7 de docs/MAINNET.md) en una copia local de
# Base mainnet (anvil --fork-url, en un bloque fijo), con el USDC real de Circle:
#   1. DeployMainnet.s.sol se niega fuera de Base (8453) y con una "Safe" que no
#      es un contrato.
#   2. En la copia de Base despliega con el USDC real, la comisión fija y las
#      mesas, y deja la Safe como dueña PENDIENTE (Ownable2Step).
#   3. `deploy-mainnet.ts verificar` relee el contrato: el código es el
#      compilado, los parámetros, las mesas y el dominio EIP-712; la Safe todavía
#      no aceptó.
#   4. La Safe acepta, y verificar dice que la dueña es la Safe.
#   5. verificar falla con otro árbitro esperado y contra otro contrato.
#   6. `deploy-mainnet.ts chequeos` lee bien la red, el USDC, la Safe y el saldo.
# Lo único que no se ensaya es la Ledger: acá firma una clave de prueba.
#
# Requiere Foundry y `npm ci`. Uso: bash packages/contracts/check-mainnet-deploy.sh
# (BASE_RPC_URL cambia el nodo de Base del que se copia; por defecto, el público).
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
TSX="$ROOT/node_modules/.bin/tsx"

PORT=8547
RPC="http://127.0.0.1:$PORT"
TMP=$(mktemp -d)
# Solo este anvil, en su propio puerto: no mata los de otros.
anvil --fork-url "${BASE_RPC_URL:-https://mainnet.base.org}" --fork-block-number 51972000 \
  --port "$PORT" >"$TMP/anvil.log" 2>&1 &
ANVIL_PID=$!
cleanup() {
  kill "$ANVIL_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT
for _ in $(seq 1 60); do
  cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break
  sleep 1
done

fail() {
  echo "❌ $1"
  [ -n "${2:-}" ] && echo "$2"
  exit 1
}
expect() { echo "$1" | grep -q -E "$2" || fail "falta en la salida: $2" "$1"; }

# Cuentas NUEVAS, derivadas de un rótulo: las de siempre de anvil tienen código
# en Base real (una delegación EIP-7702), y el deploy se niega a desplegar desde
# una cuenta así. El bloque es fijo, así que estas siguen vacías para siempre.
key() { cast keccak "arcade1v1/check-mainnet-deploy/$1"; }
addr() { cast wallet address --private-key "$1"; }
DEPLOYER_KEY=$(key deployer)
DEPLOYER=$(addr "$DEPLOYER_KEY")
SAFE_OWNER_KEY=$(key safe-owner)
SAFE_OWNER=$(addr "$SAFE_OWNER_KEY")
ARBITER=$(addr "$(key arbiter)")
PLATFORM=$(addr "$(key platform)")
for a in "$DEPLOYER" "$SAFE_OWNER"; do
  cast rpc anvil_setBalance "$a" 0x56BC75E2D63100000 --rpc-url "$RPC" >/dev/null # 100 ETH
done

# La "Safe": test/MockSafe.sol, con un dueño.
SAFE=$(forge create test/MockSafe.sol:MockSafe --rpc-url "$RPC" --private-key "$SAFE_OWNER_KEY" \
  --broadcast --constructor-args "[$SAFE_OWNER]" 1 | grep "Deployed to:" | awk '{print $3}')
[ -n "$SAFE" ] || fail "no se desplegó la Safe de prueba"

export ARBITER_ADDRESS="$ARBITER" PLATFORM_WALLET="$PLATFORM" SAFE_ADDRESS="$SAFE"
export DEPLOYER_ADDRESS="$DEPLOYER" BASE_MAINNET_RPC_URL="$RPC"
# Sin clave de Basescan: el ensayo no pregunta por un contrato que solo existe acá.
unset ETHERSCAN_API_KEY
# El registro del deploy de prueba va aparte: no pisa el de un deploy real.
export FOUNDRY_BROADCAST="$TMP/broadcast"

# La build de este commit (lo que iría a build-aprobada.json): sirve para ver
# que da el mismo hash con el forge de CI que con el local.
"$TSX" deploy-mainnet.ts hash

echo "--- 1) El script se niega fuera de Base y con una Safe que no es un contrato ---"
OUT=$(forge script script/DeployMainnet.s.sol:DeployMainnet --sender "$DEPLOYER" 2>&1 || true)
expect "$OUT" "no es Base mainnet"
echo "✓ fuera de Base (red 31337): se niega"
OUT=$(SAFE_ADDRESS="$SAFE_OWNER" forge script script/DeployMainnet.s.sol:DeployMainnet \
  --rpc-url "$RPC" --sender "$DEPLOYER" 2>&1 || true)
expect "$OUT" "SAFE_ADDRESS no es un contrato"
echo "✓ con una cuenta común como Safe: se niega"

echo "--- 2) Deploy en la copia de Base (firma una clave de prueba, no la Ledger) ---"
forge script script/DeployMainnet.s.sol:DeployMainnet --rpc-url "$RPC" \
  --private-key "$DEPLOYER_KEY" --sender "$DEPLOYER" --broadcast >"$TMP/deploy.log" 2>&1 ||
  fail "el deploy falló" "$(cat "$TMP/deploy.log")"
echo "✓ desplegado"

echo "--- 3) verificar: todo coincide y la Safe todavía no aceptó ---"
OUT=$("$TSX" deploy-mainnet.ts verificar 2>&1) || fail "verificar falló" "$OUT"
for id in codigo red usdc arbitro plataforma comision mesas dominio; do
  expect "$OUT" "✓ \[$id\]"
done
expect "$OUT" "⏳ \[duenio\]"
ESCROW=$(echo "$OUT" | sed -n 's/^Escrow1v1: //p')
[ -n "$ESCROW" ] || fail "verificar no dijo la dirección" "$OUT"
echo "$OUT"

echo "--- 4) La Safe acepta: verificar dice que la dueña es la Safe ---"
cast send "$SAFE" "exec(address,bytes)" "$ESCROW" "$(cast calldata 'acceptOwnership()')" \
  --private-key "$SAFE_OWNER_KEY" --rpc-url "$RPC" >/dev/null
OUT=$("$TSX" deploy-mainnet.ts verificar "$ESCROW" 2>&1) || fail "verificar falló" "$OUT"
expect "$OUT" "✓ \[duenio\]"
echo "✓ dueña: la Safe"

echo "--- 5) verificar falla con otro árbitro esperado y contra otro contrato ---"
if OUT=$(ARBITER_ADDRESS="$PLATFORM" "$TSX" deploy-mainnet.ts verificar "$ESCROW" 2>&1); then
  fail "verificar aceptó otro árbitro" "$OUT"
fi
expect "$OUT" "✗ \[arbitro\]"
echo "✓ otro árbitro: falla"
if OUT=$("$TSX" deploy-mainnet.ts verificar 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 2>&1); then
  fail "verificar aceptó el contrato del USDC" "$OUT"
fi
expect "$OUT" "✗ \[codigo\]"
echo "✓ otro contrato (el USDC): falla"

echo "--- 6) chequeos lee la red, el USDC, la Safe y el saldo ---"
OUT=$("$TSX" deploy-mainnet.ts chequeos 2>&1 || true)
echo "$OUT"
for id in red usdc safe saldo cuentas; do
  expect "$OUT" "✓ \[$id\]"
done
echo "✓ chequeos de la cadena en orden"

echo ""
echo "DEPLOY A MAINNET ENSAYADO ✅ (copia de Base, USDC real, Safe como dueña, relectura)"
