# Redeploy de `Escrow1v1` revisado (pre-auditoría) en Base Sepolia

> **Pendiente.** Lo corre el dueño, después del merge del PR de la
> pre-auditoría. Cuando esté hecho, anotar acá la dirección nueva y marcarlo
> como ejecutado (como [REDEPLOY-contratos-v2.md](REDEPLOY-contratos-v2.md)).

La pre-auditoría ([informe](auditorias/2026-10-02-preauditoria-escrow1v1.md))
cambió `Escrow1v1` antes de mandarlo a auditar: tope al vencimiento del
resultado, presupuesto fijo de gas por pago, duración máxima de una partida,
comisión congelada al abrir y chequeos de la wallet de la plataforma. Testnet
tiene que correr **el mismo contrato que se audita** (la prueba con usuarios
reales, O6 de [MAINNET.md](MAINNET.md), es sobre ese). `EscrowAleph` **no
cambia**: no se toca.

**A diferencia del redeploy del 24/9, esta vez el orden no importa.** Los
mensajes firmados son los mismos (dominio EIP-712 `"2"`), y el árbitro y la web
leen el contrato viejo y el nuevo igual. Mergear el PR antes o después del
deploy no rompe nada.

## Antes de empezar

1. Que el PR esté **mergeado** y tu copia local actualizada y limpia:
   `git checkout main && git pull && git status` (sin cambios). `forge script`
   compila lo que hay en la carpeta en ese momento: en julio un deploy hecho
   desde una copia vieja desplegó el contrato anterior.
2. `packages/contracts/.env` como la vez pasada: `PRIVATE_KEY` (deployer y
   dueño en testnet), **`USDC_ADDRESS` con el TestUSDC actual**
   (`0xBE3A57a90548b336F5EBF997E6DA6d3DC64EE137`; sin ella el script despliega
   un USDC nuevo), `ARBITER_ADDRESS` (la de siempre), `PLATFORM_WALLET` y
   `FEE_BPS=1500`.

## Pasos

### 1) Cerrar las mesas de plata del 1v1 y esperar que se vacíen

En Render, `STAKES_ALLOWED=` (vacía) y redeploy. Una partida de plata vive como
mucho unas 2,5 h. Después revisá que en el contrato de hoy no quede ninguna
`Open` ni `Funded` **desde que se desplegó** (bloque 47.255.314, el
2026-09-24), no solo las últimas 48 h: los reembolsos del árbitro son de un
solo intento (W4 de [MAINNET.md](MAINNET.md)) y alguna vieja pudo quedar
colgada. El rango va en tramos porque los nodos públicos limitan `cast logs`.
Imprime cada partida con su estado (el último número: `1` = `Open`, `2` =
`Funded`, `3` = pagada, `4` = reembolsada):

```bash
OLD=0x155ff6FB175cC43197bA983Cb16c532Be12a34cb      # el Escrow1v1 v2 de hoy
RPC=${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}
HEAD=$(cast block-number --rpc-url "$RPC")
for ((FROM = 47255314; FROM <= HEAD; FROM += 10000)); do
  TO=$((FROM + 9999)); [ "$TO" -gt "$HEAD" ] && TO=$HEAD
  for id in $(cast logs --address "$OLD" "MatchOpened(bytes32 indexed,address,uint256)" \
      --from-block "$FROM" --to-block "$TO" --rpc-url "$RPC" --json | jq -r '.[].topics[1]'); do
    echo "$id $(cast call "$OLD" "matches(bytes32)(address,address,uint256,bool,bool,uint64,uint64,uint8)" \
      "$id" --rpc-url "$RPC" | tail -1)"
  done
done
```

Si alguna quedó `Open` o `Funded`:

- **`Funded` con ganador:** `GET https://arcade1v1.onrender.com/match/<id>`
  muestra `winner`, `signature` y `signatureDeadline`. Mientras no venza,
  cualquiera la presenta (paga el gas):
  `cast send "$OLD" "settle(bytes32,address,uint64,bytes)" <id> <winner> <signatureDeadline> <signature> --private-key <cualquiera con gas> --rpc-url "$RPC"`.
- **Cualquier otra:** reembolsala con la llave del árbitro o del dueño:
  `cast send "$OLD" "cancelMatch(bytes32)" <id> --private-key <árbitro o dueño> --rpc-url "$RPC"`.

Aleph no se toca.

### 2) Desplegar el contrato revisado

```bash
bash packages/contracts/deploy-base-sepolia.sh
```

Anotá la dirección nueva. Chequeo de que es la versión revisada (solo ella
tiene `PAY_GAS` y `MAX_MATCH_DURATION`):

```bash
NEW=<dirección nueva>; RPC=$BASE_SEPOLIA_RPC_URL
cast call "$NEW" "PAY_GAS()(uint256)" --rpc-url "$RPC"              # → 300000
cast call "$NEW" "MAX_MATCH_DURATION()(uint64)" --rpc-url "$RPC"    # → 172800
cast call "$NEW" "feeBps()(uint16)" --rpc-url "$RPC"                # → 1500
cast call "$NEW" "arbiter()(address)" --rpc-url "$RPC"              # → el árbitro de siempre
```

### 3) Apuntar el árbitro y la web

- **Render:** `ESCROW_ADDRESS` = la dirección nueva. Lo demás no cambia.
- **Vercel:** `NEXT_PUBLIC_ESCROW_ADDRESS` = la dirección nueva, y **redeploy**
  (las `NEXT_PUBLIC_*` se hornean al compilar).

### 4) Reabrir y probar

- **Render:** `STAKES_ALLOWED=1,2,5,10` (o borrar la variable) y redeploy.
- Jugá una mesa de 1 USDC con dos wallets desde la web. La pantalla del ganador
  tiene que pasar sola a "¡Cobrado!" y `GET /match/<id>` mostrar `settleTx`.

## Reversa

Volver `ESCROW_ADDRESS` y `NEXT_PUBLIC_ESCROW_ADDRESS` a
`0x155ff6FB175cC43197bA983Cb16c532Be12a34cb` (y redeploy de Vercel). El código
habla igual con los dos contratos, y ninguno puede trabar plata: los reembolsos
son permissionless en los dos.
