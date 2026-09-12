# contracts — Contrato de escrow (Solidity, para Base)

Contrato `Escrow1v1` que custodia el pozo y paga solo segun las reglas. Hecho
con **Foundry** y piezas de seguridad de **OpenZeppelin**.

## Que hace

- `open` — el primer jugador abre la partida (define mesa y plazos) y deposita
  su apuesta en USDC. Nadie mas paga gas por el: cada jugador deposita lo suyo.
- `join` — el segundo jugador se une y deposita la misma apuesta -> la partida
  queda `Funded`.
- `settle` — con la **firma del arbitro** (EIP-712, verificada on-chain por el
  contrato), paga premio al ganador + comision a la wallet de la plataforma.
- `refundUnfunded` — si no se lleno a tiempo (paso el `fundDeadline`), cada uno
  recupera su deposito.
- `refundExpired` — si se lleno pero paso el plazo de juego sin resultado
  (`playDeadline`, ej: el rival no jugo en 1 hora), se devuelve todo a ambos.
- `cancelMatch` — el arbitro o el dueño cancela (empate o disputa) y reembolsa
  a quien haya depositado.
- `resultDigest` — vista auxiliar (para el backend/tests) que devuelve el hash
  EIP-712 que el arbitro debe firmar para liquidar una partida.

Nadie puede sacar el dinero de los jugadores a mano: solo se mueve por estas
reglas. La comision (`feeBps`) tiene un tope duro de 20% (`MAX_FEE_BPS`).

Las mesas (montos de apuesta permitidos) se habilitan una por una con
`setAllowedStake` — los scripts de despliegue habilitan 1, 2, 5 y 10 USDC.

## EscrowAleph — las mesas de plata de Aleph (N asientos)

Contrato aparte para el formato multi-agente: entre 4 y 8 asientos depositan el
mismo stake, el árbitro firma UNA tabla de pagos y el contrato paga a todos en
una sola transacción. No toca `Escrow1v1`.

- `open` — el PRIMER asiento en depositar abre la sala con la lista completa de
  asientos (congelada por el árbitro), el stake y los plazos. Presenta su
  **pase** (EIP-712 `Seat(roomId, seatsHash, stake, fundDeadline,
playDeadline, player)`, firmado por el árbitro): sin pase no hay asiento, y el
  pase ata la lista, el stake y los plazos, así que el que abre no puede
  inventar la mesa.
- `deposit` — cada uno de los demás asientos deposita con su pase. Con el
  último, la sala queda `Funded` y el juego corre fuera de la cadena.
- `settle` — con la firma del árbitro sobre `Payout(roomId, tableHash)`,
  `tableHash = keccak256(abi.encode(seats, amounts))`, paga `amounts[i]` a cada
  asiento (en el MISMO orden que la sala) y la comisión más el polvo del
  redondeo a la plataforma. Exige `Σ amounts ≤ pozo − comisión` y que sobren
  menos de N micro-USDC. Cualquiera puede presentarla.
- `refundUnfunded` / `refundExpired` / `cancelRoom` — los tres reembolsos:
  fondeo vencido (cualquiera), plazo de juego vencido más la gracia de 30 min
  (cualquiera), o cancelación del árbitro/dueño. Cada uno recupera exactamente
  su stake; el que no depositó no recibe nada.
- `roomOf`, `depositors`, `paid` — vistas para el árbitro y los agentes;
  `seatDigest`, `payoutDigest`, `seatsHashOf`, `tableHashOf` — los hashes tal
  cual los calcula el contrato, para que el backend y los tests firmen lo mismo.

Dominio EIP-712 propio: `Arcade1v1EscrowAleph` v1. Mesa habilitada por el
script de despliegue: **2 USDC**.

Propiedad conocida (a decidir antes de mainnet): el contrato paga empujando
USDC a cada asiento. El USDC real de Circle revierte una transferencia a una
dirección en su blacklist, así que un solo asiento en blacklist entre los 4 a 8
haría revertir toda la liquidación. `settle` tiene una salida — la tabla
firmada puede asignarle 0 a ese asiento — pero los tres reembolsos no: una sala
en `Funding` con un depositante en blacklist dejaría su pozo trabado para
siempre. El disparador exige que Circle ponga en blacklist a una dirección
DESPUÉS de que depositó, así que la probabilidad es baja y el stake es de 2
USDC. Es la misma propiedad que ya tiene `Escrow1v1`, desplegado con plata
real, con un radio de impacto menor (2 asientos en vez de hasta 8).

Pruebas: `forge test --match-contract EscrowAlephTest -vv` (43 pruebas: fondeo,
liquidación, tabla que no suma, address que no es asiento, firma ajena, doble
liquidación, los tres reembolsos exactos, 8 asientos, gracia, reentrancy y la
superficie de admin/constructor).

Desplegar en Base Sepolia (reusa la wallet y el TestUSDC de `.env`):

```bash
cd packages/contracts
bash deploy-aleph-base-sepolia.sh
```

Ensayo del deploy en anvil, sin gastar nada: `bash check-aleph-deploy.sh`.
Todavía no se desplegó en ninguna red: el deploy real queda para el PR 3, con
el OK del dueño.

## Correr las pruebas (local, sin gastar nada)

```bash
cd packages/contracts
forge test -vv
```

Estado actual: 57 pruebas pasando — 14 de `Escrow1v1.t.sol` + 43 de
`EscrowAleph.t.sol`.

## Desplegar en Base Sepolia (testnet)

Camino recomendado — script "llave en mano":

```bash
cd packages/contracts
bash deploy-base-sepolia.sh
```

La primera corrida (sin `PRIVATE_KEY` en `.env`) genera una wallet descartable
y muestra la direccion para fondear en un faucet de Base Sepolia. La segunda
corrida, ya con gas, despliega el `TestUSDC` (mint abierto) + el `Escrow1v1` y
deja habilitadas las mesas del producto.

Camino manual (forge directo):

```bash
cd packages/contracts
source .env
forge script script/Deploy.s.sol --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast
```

Antes de un deploy real tambien se puede ensayar el mismo script en una cadena
local (Anvil), sin gastar nada:

```bash
bash check-deploy.sh
```

## Desplegar en Base mainnet (dinero real)

Script separado (`script/DeployMainnet.s.sol`) con guardas: exige un USDC real
(no despliega ningun token de prueba), firma con wallet de hardware
(`--ledger` / `--trezor`) o keystore (`--account`), y pide confirmacion
explicita antes de ejecutar.

```bash
cd packages/contracts
bash deploy-base-mainnet.sh
```

Requiere `.env.mainnet` (copiado de `.env.mainnet.example`) con
`BASE_MAINNET_RPC_URL`, `USDC_ADDRESS` (USDC real de Base), `ARBITER_ADDRESS`,
`PLATFORM_WALLET`, `FEE_BPS` y `OWNER_ADDRESS` (la wallet de hardware que
firma y queda como dueña del contrato).

> Estado: contrato probado (14/14 pruebas) y flujo completo verificado en Anvil
> (deposito, pago y reembolso). Las direcciones de un entorno publicado y sus
> secretos no se guardan en Git (`.env`, `.env.mainnet` y `broadcast/` estan
> en `.gitignore`), por lo que deben verificarse en la configuracion de ese
> entorno. <!-- VERIFY: direccion desplegada del contrato en Base Sepolia/mainnet -->
