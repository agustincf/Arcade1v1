# Redeploy de los contratos v2 — `Escrow1v1` y `EscrowAleph`

> **Pendiente.** Se ejecuta UNA vez, junto con el merge del PR que trae la v2
> de los dos contratos (ver [MAINNET.md](MAINNET.md), puntos C1, C2 y C4 a C9).
> Cuando se ejecute, anotar acá la fecha y las dos direcciones nuevas, como en
> [REDEPLOY-v3.4.0.md](REDEPLOY-v3.4.0.md).

Esta versión **cambia los dos contratos de plata**:

**`Escrow1v1`** (las mesas 1v1):

- `settle` recibe un argumento más (`deadline`): el resultado se firma como
  `Result(matchId, winner, deadline)` y vence justo cuando se abre el reembolso.
- El asiento ata el stake y los plazos:
  `Seat(matchId, player, stake, fundDeadline, playDeadline)`. Los fija el
  árbitro al crear la partida y la web abre con esos.
- Cada pago se empuja por separado; el que el USDC rechaza queda en `owed` y se
  cobra con `withdraw` / `withdrawFor`.
- `Ownable2Step`, sin `renounceOwnership`, y una mesa deshabilitada tampoco
  acepta `join`.
- Dominio EIP-712 en versión `"2"`.
- Y del lado del código: **el árbitro liquida solo** cada partida decidida. La
  web conserva el botón de cobrar como respaldo.

**`EscrowAleph`** (las mesas de plata de Aleph):

- `settle` recibe `deadline` y la tabla se firma como
  `Payout(roomId, tableHash, deadline)`, con el dominio en versión `"2"`.
- El mismo crédito de respaldo (`owed`, `withdraw`, `withdrawFor`),
  `Ownable2Step` sin `renounceOwnership`, y una mesa deshabilitada tampoco
  acepta `deposit`.

Los contratos desplegados son inmutables: hay que **desplegar dos nuevos** y
apuntar el árbitro y la web a sus direcciones.

> **Por qué no se auto-despliega como las otras versiones.** El árbitro nuevo
> firma asientos, resultados y tablas con el dominio v2 y los tipos nuevos, y la
> web nueva llama a `settle` con el plazo: contra los contratos viejos, cada
> depósito revertiría ("bad seat") y cada cobro también. El código viejo contra
> los contratos nuevos, lo mismo. El cambio de contratos y el de código van
> **coordinados**.

Es **testnet** (Base Sepolia, dinero de juego): una ventana con las mesas de
plata cerradas no arriesga plata real. Mientras dure, la web muestra un error al
entrar a una mesa paga; la ladder gratis y Aleph gratis siguen.

---

## Antes de empezar

1. **Cerrar las mesas de plata en el árbitro de hoy y esperar a que se
   vacíen.** En Render, `STAKES_ALLOWED=` (vacía: el árbitro solo acepta la
   ladder gratis) y `ALEPH_STAKES=0`, y redeploy. Desde ahí no se crea ninguna
   partida de plata nueva.
   - **1v1:** una partida de plata vive como mucho unas 2,5 h (ventana de juego
     de 2 h, más la media hora de gracia). Esperá ese tiempo: el árbitro cancela
     las que vencen sin resultado, y los ganadores cobran desde la web como
     siempre. Después, revisá que en el contrato viejo no quede ninguna `Open` ni
     `Funded` (ver "Revisar el `Escrow1v1` viejo" abajo).
   - **Aleph:** `GET /aleph/lobbies` no tiene que listar ninguna sala con
     `stake: 2`, y en `GET /aleph/recent` cada sala de plata reciente tiene que
     mostrar su `settleTx` (o, en `GET /aleph/<id>`, un `settleOutcome`). La mesa
     de 2 USDC arranca muy poco: lo normal es que no haya ninguna.
2. Tener a mano, en `packages/contracts/.env` (ya existen del despliegue
   anterior): la clave del deployer (`PRIVATE_KEY`, en testnet también es el
   dueño), **`USDC_ADDRESS` con el TestUSDC actual** (sin ella,
   `deploy-base-sepolia.sh` despliega un USDC nuevo y los saldos de prueba dejan
   de valer), `ARBITER_ADDRESS` (la misma de siempre), `PLATFORM_WALLET` y
   `FEE_BPS=1500`. Y acceso a las variables de **Render** (árbitro) y **Vercel**
   (web).

### Revisar el `Escrow1v1` viejo

Lista cada partida abierta en el contrato viejo desde `FROM` con su estado (el
último número: `1` = `Open`, `2` = `Funded`, `3` = pagada, `4` = reembolsada).
Con dos días hacia atrás alcanza: el árbitro guarda las partidas terminadas
48 h. Algunos RPC públicos limitan el rango de `cast logs`: si falla, usá el de
Alchemy o partí el rango.

```bash
OLD=0xF6B4bd37d4571B23a707A3C128fcA1a4714BeecB   # el Escrow1v1 de hoy (REDEPLOY-v3.4.0.md)
RPC=$BASE_SEPOLIA_RPC_URL
FROM=$(( $(cast block-number --rpc-url "$RPC") - 86400 ))   # ~48 h de bloques de 2 s
for id in $(cast logs --address "$OLD" "MatchOpened(bytes32 indexed,address,uint256)" \
    --from-block "$FROM" --rpc-url "$RPC" --json | jq -r '.[].topics[1]'); do
  echo "$id $(cast call "$OLD" "matches(bytes32)(address,address,uint256,bool,bool,uint64,uint64,uint8)" \
    "$id" --rpc-url "$RPC" | tail -1)"
done
```

Si alguna quedó `Open` o `Funded`:

- **`Funded` con ganador:** `GET https://arcade1v1.onrender.com/match/<id>`
  todavía muestra el `winner` y la `signature` (la v1, sin vencimiento).
  Presentala antes de que venza la gracia (cualquiera puede; paga el gas):
  `cast send "$OLD" "settle(bytes32,address,bytes)" <id> <winner> <signature> --private-key <cualquiera con gas> --rpc-url "$RPC"`.
- **Cualquier otra:** reembolsala con la llave del árbitro o del dueño:
  `cast send "$OLD" "cancelMatch(bytes32)" <id> --private-key <árbitro o dueño> --rpc-url "$RPC"`.

---

## Pasos

### 1) Desplegar los dos contratos nuevos en Base Sepolia

```bash
bash packages/contracts/deploy-base-sepolia.sh        # Escrow1v1 v2, con las mesas 1/2/5/10
bash packages/contracts/deploy-aleph-base-sepolia.sh  # EscrowAleph v2, con la mesa de 2 USDC
```

Cada uno imprime su dirección **nueva**: anotalas. Chequeo rápido de que son la
v2 (solo la v2 tiene `owed`, y su dominio EIP-712 dice `"2"`):

```bash
for C in <nuevo Escrow1v1> <nuevo EscrowAleph>; do
  cast call "$C" "owed(address)(uint256)" 0x0000000000000000000000000000000000000001 --rpc-url "$RPC"  # → 0
  cast call "$C" "eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])" --rpc-url "$RPC"  # → ..., "2", ...
done
```

### 2) Apuntar el árbitro y la web a los contratos nuevos, y publicar el código

- **Render (árbitro):** `ESCROW_ADDRESS` = el `Escrow1v1` nuevo y
  `ALEPH_ESCROW_ADDRESS` = el `EscrowAleph` nuevo. Dejá `STAKES_ALLOWED=` y
  `ALEPH_STAKES=0` por ahora. `CHAIN_ID`, `RPC_URL` y `ARBITER_PRIVATE_KEY` no
  cambian.
- **Vercel (web):** `NEXT_PUBLIC_ESCROW_ADDRESS` = el `Escrow1v1` nuevo
  (`NEXT_PUBLIC_USDC_ADDRESS` no cambia si reusaste el USDC).
- Mergear el PR a `main` (dispara los dos deploys) y esperar a que
  `curl -s https://arcade1v1.onrender.com/health` devuelva el `commit` del merge.

Opcional: `ALEPH_PAYOUT_TTL_MS` (vida de la firma de una tabla de Aleph,
default 30 min). No hace falta tocarla.

### 3) Prender las mesas de plata y probarlas

- **Render:** `STAKES_ALLOWED=1,2,5,10` (o borrar la variable: ese es el
  default) y `ALEPH_STAKES=0,2`, y redeploy.
- **1v1:** jugá una mesa de 1 USDC con dos wallets desde la web. Al terminar, la
  pantalla del ganador tiene que pasar sola a "¡Cobrado!" con el enlace "Ver el
  pago", sin que nadie toque "Cobrar", y `GET /match/<id>` tiene que mostrar
  `settleTx`. El gas de ese pago lo pone el árbitro: mirá que su saldo alcance
  (`/status`).
- **Aleph:** el smoke con 4 wallets contra el contrato nuevo (cuesta gas de
  testnet y tarda 15-30 min):

  ```bash
  bash packages/contracts/smoke-aleph-base-sepolia.sh <nuevo EscrowAleph>
  ```

### 4) Avisar a quienes corren agentes en la mesa de plata de Aleph

El SDK y el MCP **clavan** el escrow (`escrow` en `createAgent`,
`ARCADE_ALEPH_ESCROW_ADDRESS` en el MCP) y se niegan a depositar en otro. Hasta
que actualicen el pin a la dirección nueva, sus depósitos fallan con
`escrow mismatch` (es a propósito: la dirección que manda el árbitro no alcanza
para aprobarle USDC a un contrato). Depositar no exige paquetes nuevos: `open` y
`deposit` no cambiaron. Cobrar lo acreditado (`alephWithdraw`, `aleph_withdraw`)
sí: sale en la próxima versión de `@arcade1v1/agent-sdk` y `@arcade1v1/mcp`. Las
mesas 1v1 de plata no las juegan agentes (el SDK no deposita en ellas).

---

## Reversa (si algo sale mal)

- Volver `ESCROW_ADDRESS`, `ALEPH_ESCROW_ADDRESS` y `NEXT_PUBLIC_ESCROW_ADDRESS`
  a las direcciones viejas, dejar las mesas de plata cerradas y hacer
  `git revert` del merge: el árbitro y la web vuelven a hablar con la v1.
- La plata de los contratos viejos nunca queda atrapada: sus reembolsos
  (`refundUnfunded`, `refundExpired` y la cancelación) siguen funcionando.
- Lo que se haya depositado en los contratos nuevos durante la prueba tampoco:
  los reembolsos de la v2 son los mismos, y además nunca revierten por un USDC
  que rechace un pago (queda acreditado).

---

## Qué se verificó antes de este redeploy

- `forge test`: 113 pruebas. 50 de `Escrow1v1` (antes 14: blacklist en la
  liquidación y en los tres reembolsos, USDC en pausa, retiro, `withdrawFor`,
  vencimiento del resultado justo cuando abre el reembolso, condiciones del
  asiento, freno de mesa, rotación de la llave del árbitro, fuzz de
  conservación por todos los caminos de salida, gas justo, reentrada, dueño en
  dos pasos) y 63 de `EscrowAleph` (antes 59). Cada guarda nueva se probó
  contra un mutante que la rompe.
- `npm run check` completo (tipos, lint, formato, tests del árbitro, la web, el
  SDK y el MCP, selftest) y el build de producción de la web.
- Los cinco e2e en anvil. `check-integration.sh` compara el digest del
  resultado y el del asiento con el contrato. `check-payment-e2e.sh` prueba que
  el árbitro liquida solo, que el ganador que se le adelanta con la misma firma
  queda como "external" sin pago doble, y que un ganador en la blacklist tiene el
  premio acreditado y lo cobra al salir. `check-aleph-e2e.sh` prueba el asiento de
  Aleph en la blacklist.
