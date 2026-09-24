# Redeploy de EscrowAleph v2 — pagos con crédito de respaldo y tabla que vence

> **Pendiente.** Se ejecuta UNA vez, junto con el merge del PR que trae
> `EscrowAleph` v2 (ver [MAINNET.md](MAINNET.md), puntos C1 y C2). Cuando se
> ejecute, anotar acá la fecha y la dirección nueva, como en
> [REDEPLOY-v3.4.0.md](REDEPLOY-v3.4.0.md).

Esta versión **cambia el contrato** de las mesas de plata de Aleph:

- `settle` recibe un argumento más (`deadline`) y la tabla se firma como
  `Payout(roomId, tableHash, deadline)`, con el dominio EIP-712 en versión `"2"`.
- Cada pago se empuja por separado; el que el USDC rechaza queda en `owed` y se
  cobra con `withdraw` / `withdrawFor`.

El contrato desplegado es inmutable: hay que **desplegar uno nuevo** y apuntar
el árbitro a su dirección.

> **Por qué no se auto-despliega como las otras versiones.** El árbitro nuevo
> firma pases y tablas con el dominio v2 y llama a `settle` con el plazo: contra
> el contrato viejo, cada depósito revertiría ("bad seat") y cada liquidación
> también. El árbitro viejo contra el contrato nuevo, lo mismo. El cambio de
> contrato y el de código van **coordinados**.

`Escrow1v1` (las mesas 1v1) **no cambia** en este redespliegue.

Es **testnet** (Base Sepolia, dinero de juego): una ventana breve con la mesa de
plata apagada no arriesga plata real.

---

## Antes de empezar

1. **Que no queden mesas de plata en curso en el contrato viejo.** En Render,
   `ALEPH_STAKES=0` (la mesa gratis sigue) y redeploy: desde ahí no se abre
   ninguna sala de plata nueva. Después, esperar a que las que ya estaban
   terminen:
   - `GET /aleph/lobbies` no tiene que listar ninguna sala con `stake: 2` (ni en
     `lobby` ni en `funding`).
   - Las salas de plata en juego se liquidan solas (el árbitro manda el `settle`
     al terminar). En `GET /aleph/recent`, cada sala de plata reciente tiene que
     mostrar su `settleTx` (o, en `GET /aleph/<id>`, un `settleOutcome`). La mesa
     de 2 USDC arranca muy poco: lo normal es que no haya ninguna.
2. Tener a mano (ya existen del despliegue anterior, en
   `packages/contracts/.env`): la clave del deployer (`PRIVATE_KEY`), el
   `USDC_ADDRESS` del TestUSDC actual (se reusa, así los saldos de prueba siguen
   valiendo), `ARBITER_ADDRESS` (la misma de siempre), `PLATFORM_WALLET` y
   `FEE_BPS=1500`. Y acceso a las variables de **Render**.

---

## Pasos

### 1) Desplegar el EscrowAleph nuevo en Base Sepolia

```bash
bash packages/contracts/deploy-aleph-base-sepolia.sh
```

Imprime la **nueva** `ALEPH_ESCROW_ADDRESS` y deja habilitada la mesa de
2 USDC. Anotala. Chequeo rápido de que es la v2 (solo la v2 tiene `owed`):

```bash
cast call <nueva> "owed(address)(uint256)" 0x0000000000000000000000000000000000000001 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"   # → 0
```

### 2) Apuntar el árbitro al contrato nuevo y publicar el código

- **Render**: `ALEPH_ESCROW_ADDRESS` = la dirección nueva. Dejá `ALEPH_STAKES=0`
  por ahora.
- Mergear el PR a `main` (dispara el deploy) y esperar a que
  `curl -s https://arcade1v1.onrender.com/health` devuelva el `commit` del merge.

Opcional: `ALEPH_PAYOUT_TTL_MS` (vida de la firma de una tabla, default 30 min).
No hace falta tocarla.

### 3) Prender la mesa de plata y probarla

- **Render**: `ALEPH_STAKES=0,2` y redeploy.
- Smoke con 4 wallets contra el contrato nuevo (cuesta gas de testnet y tarda
  15-30 min):

  ```bash
  bash packages/contracts/smoke-aleph-base-sepolia.sh <nueva>
  ```

### 4) Avisar a quienes corren agentes en la mesa de plata

El SDK y el MCP **clavan** el escrow (`escrow` en `createAgent`,
`ARCADE_ALEPH_ESCROW_ADDRESS` en el MCP) y se niegan a depositar en otro. Hasta
que actualicen el pin a la dirección nueva, sus depósitos fallan con
`escrow mismatch` (es a propósito: la dirección que manda el árbitro no alcanza
para aprobarle USDC a un contrato). Depositar no exige paquetes nuevos: `open` y
`deposit` no cambiaron. Cobrar lo acreditado (`alephWithdraw`, `aleph_withdraw`)
sí: sale en la próxima versión de `@arcade1v1/agent-sdk` y `@arcade1v1/mcp`.

---

## Reversa (si algo sale mal)

- Volver `ALEPH_ESCROW_ADDRESS` a la dirección vieja, dejar `ALEPH_STAKES=0` y
  hacer `git revert` del merge: el árbitro vuelve a hablar con el contrato v1.
- La plata del contrato viejo nunca queda atrapada: sus tres reembolsos
  (`refundUnfunded`, `refundExpired`, `cancelRoom`) siguen funcionando.

---

## Qué se verificó antes de este redeploy

- `forge test`: 59 pruebas de `EscrowAleph` (las 43 de la v1 adaptadas y 16
  nuevas: blacklist en la liquidación y en los tres reembolsos, USDC en pausa,
  retiro, `withdrawFor`, crédito acumulado entre salas, vencimiento de la tabla,
  fuzz de conservación de fondos, barrido de gas justo) + 14 de `Escrow1v1`.
- `npm run check` completo (tipos, lint, formato, tests del árbitro, SDK y MCP,
  selftest).
- Los cinco e2e en anvil, incluido `check-aleph-e2e.sh` con el escenario nuevo:
  un asiento cae en la blacklist antes de liquidar, los otros tres cobran, su
  parte queda acreditada y la cobra con `alephWithdraw` del SDK al salir.
