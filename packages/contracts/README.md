# contracts — Contrato de escrow (Solidity, para Base)

Dos contratos: `Escrow1v1` (el pozo de una partida 1v1) y `EscrowAleph` (las
mesas de plata de Aleph, 4 a 8 asientos). Custodian el pozo y pagan solo segun
las reglas. Hechos con **Foundry** (CI lo fija en **v1.8.3**) y piezas de
seguridad de **OpenZeppelin**. Los dos estan desplegados en **Base Sepolia**
(testnet, con `TestUSDC`).

## Que hace

- `open` — el primer jugador abre la partida y deposita su apuesta en USDC.
  Presenta su **asiento** (EIP-712
  `Seat(matchId, player, stake, fundDeadline, playDeadline)`, firmado por el
  arbitro): la mesa y los plazos los fija el arbitro, no quien abre. Nadie mas
  paga gas por el: cada jugador deposita lo suyo.
- `join` — el segundo jugador se une y deposita la misma apuesta, con su
  asiento, que se verifica contra las condiciones guardadas al abrir -> la
  partida queda `Funded`.
- `settle(id, winner, deadline, signature)` — con la **firma del arbitro**
  sobre `Result(matchId, winner, deadline)` (EIP-712, verificada on-chain),
  paga premio al ganador + comision a la wallet de la plataforma. La firma
  vence: el arbitro la emite hasta `playDeadline + REFUND_GRACE`, justo cuando
  se abre el reembolso. La presenta el propio arbitro; cualquiera puede.
- `refundUnfunded` — si no se lleno a tiempo (paso el `fundDeadline`), cada uno
  recupera su deposito.
- `refundExpired` — si se lleno pero paso el plazo de juego sin resultado
  (`playDeadline` mas 30 min de gracia), se devuelve todo a ambos.
- `cancelMatch` — el arbitro o el dueño cancela (empate o disputa) y reembolsa
  a quien haya depositado.
- **Pagos con credito de respaldo** (v2). El premio, la comision y cada
  reembolso se empujan por separado. Si el USDC rechaza uno (la direccion en la
  blacklist de Circle, o el token en pausa), ese monto queda en
  `owed[address]` (evento `Credited`) y lo demas se paga igual. Se cobra con
  `withdraw` / `withdrawFor(account)`, igual que en `EscrowAleph`, con la misma
  guarda de gas.
- `resultDigest` / `seatDigest` — vistas auxiliares (para el backend/tests) que
  devuelven los hashes EIP-712 que firma el arbitro.

Nadie puede sacar el dinero de los jugadores a mano: solo se mueve por estas
reglas. La comision (`feeBps`) tiene un tope duro de 20% (`MAX_FEE_BPS`).

Las mesas (montos de apuesta permitidos) se habilitan una por una con
`setAllowedStake` — los scripts de despliegue habilitan 1, 2, 5 y 10 USDC. Una
mesa deshabilitada no acepta `open` ni `join` (v2): es el freno de las
entradas, y las salidas no la miran. El dueño se transfiere en dos pasos
(`Ownable2Step`: `transferOwnership` + `acceptOwnership`) y
`renounceOwnership` esta deshabilitada.

Dominio EIP-712: `Arcade1v1Escrow` **version 2**. La v1 firmaba
`Result(matchId, winner)` sin vencimiento y `Seat(matchId, player)` sin
condiciones, y empujaba el premio y los reembolsos juntos: un jugador en la
blacklist de USDC trababa la plata del otro para siempre. El redespliegue en
Base Sepolia va con el merge:
[`docs/REDEPLOY-contratos-v2.md`](../../docs/REDEPLOY-contratos-v2.md).

Pruebas: `forge test --match-contract Escrow1v1Test -vv` (50 pruebas: el ciclo
completo, los tres reembolsos, la gracia, el secuestro del slot, y desde la v2
las condiciones del asiento, el freno de mesa, el vencimiento del resultado
justo cuando abre el reembolso, la rotacion de la llave del arbitro, la
blacklist en la liquidacion y en los reembolsos, USDC en pausa, retiro y
`withdrawFor`, fuzz de conservacion por todos los caminos de salida, gas justo,
reentrada y dueño en dos pasos).

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
- `settle` — con la firma del árbitro sobre
  `Payout(roomId, tableHash, deadline)`,
  `tableHash = keccak256(abi.encode(seats, amounts))`, paga `amounts[i]` a cada
  asiento (en el MISMO orden que la sala) y la comisión más el polvo del
  redondeo a la plataforma. Exige `Σ amounts ≤ pozo − comisión` y que sobren
  menos de N micro-USDC. Cualquiera puede presentarla, hasta su `deadline`
  (segundos): vencida, revierte con `payout expired` y el árbitro firma de nuevo
  la misma tabla.
- `refundUnfunded` / `refundExpired` / `cancelRoom` — los tres reembolsos:
  fondeo vencido (cualquiera), plazo de juego vencido más la gracia de 30 min
  (cualquiera), o cancelación del árbitro/dueño. Cada uno recupera exactamente
  su stake; el que no depositó no recibe nada.
- **Pagos con crédito de respaldo.** Cada pago de `settle` y de los reembolsos
  se empuja por separado. Si el USDC lo rechaza (la dirección está en la
  blacklist de Circle, o el token en pausa), ese monto queda en `owed[address]`
  (evento `Credited`) y los demás cobran igual: un asiento bloqueado no traba la
  sala. Si un envío falla por falta de gas, en cambio, revierte todo (el chequeo
  de EIP-150 de `ERC2771Forwarder`): así nadie convierte el pago de otro en un
  crédito eligiendo el gas de un `settle` permissionless.
- `withdraw` — cobra lo que `msg.sender` tiene acreditado (un saldo por
  dirección: suma todas sus salas). `withdrawFor(account)` se lo entrega a
  `account`; lo puede llamar cualquiera, y la plata sale solo hacia `account`.
  Mientras siga en la blacklist, revierte y el crédito queda intacto.
- `roomOf`, `depositors`, `paid`, `owed` — vistas para el árbitro y los agentes;
  `seatDigest`, `payoutDigest`, `seatsHashOf`, `tableHashOf` — los hashes tal
  cual los calcula el contrato, para que el backend y los tests firmen lo mismo.

Dominio EIP-712 propio: `Arcade1v1EscrowAleph` **versión 2** (la v1 firmaba
`Payout(roomId, tableHash)`, sin vencimiento). Mesa habilitada por el script de
despliegue: **2 USDC**.

Las dos propiedades que la v1 tenía y la v2 arregla (decididas el 2026-09-18
para antes de mainnet): los pagos se empujaban todos en la misma transacción,
así que un solo depositante en la blacklist de USDC hacía revertir la
liquidación y los tres reembolsos (el pozo de una sala en `Funding` quedaba
trabado para siempre); y la tabla firmada no vencía, así que dos tablas firmadas
para la misma sala valían las dos. El redespliegue en Base Sepolia va con el
merge: [`docs/REDEPLOY-contratos-v2.md`](../../docs/REDEPLOY-contratos-v2.md).
También desde la v2: `Ownable2Step` sin `renounceOwnership`, y una mesa
deshabilitada no acepta `deposit`.

Pruebas: `forge test --match-contract EscrowAlephTest -vv` (63 pruebas: fondeo,
liquidación, tabla que no suma, address que no es asiento, firma ajena, doble
liquidación, los tres reembolsos exactos, 8 asientos, gracia, reentrancy, la
superficie de admin/constructor y, desde la v2, blacklist en la liquidación y
en los tres reembolsos, USDC en pausa, retiro y `withdrawFor`, crédito acumulado
entre salas, vencimiento de la tabla, fuzz de conservación de fondos con
cualquier subconjunto en blacklist, un barrido de límites de gas contra un
token de pago caro, dueño en dos pasos y el freno de mesa). Los tokens de prueba viven en `test/`: `BlacklistUSDC`
(blacklist y pausa, como el USDC real), `GasHungryUSDC` y `ReentrantUSDC`.

Desplegar en Base Sepolia (reusa la wallet y el TestUSDC de `.env`):

```bash
cd packages/contracts
bash deploy-aleph-base-sepolia.sh
```

Ensayo del deploy en anvil, sin gastar nada: `bash check-aleph-deploy.sh`.
Está desplegado en Base Sepolia y el árbitro publicado ofrece la mesa de 2 USDC
(`GET /aleph/lobbies` → `stakes: [0, 2]`). Smoke de punta a punta contra ese
árbitro (4 wallets efímeras se sientan, depositan, juegan y cobran; cuesta gas
de testnet y tarda 15-30 min): `bash smoke-aleph-base-sepolia.sh <ALEPH_ESCROW_ADDRESS>`
(`--preflight` corre solo el chequeo previo, de solo lectura).

Lo que falta para mainnet, de los dos contratos y del resto del proyecto:
[`docs/MAINNET.md`](../../docs/MAINNET.md).

## Correr las pruebas (local, sin gastar nada)

```bash
cd packages/contracts
forge test -vv
```

Estado actual: 113 pruebas pasando — 50 de `Escrow1v1.t.sol` + 63 de
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

> Estado: `Escrow1v1` v2 probado (50/50 pruebas) y flujo completo verificado en
> Anvil con el árbitro real (depósito, liquidación por el árbitro, ganador que se
> le adelanta, ganador en la blacklist, reembolsos); `EscrowAleph` v2 probado
> (63/63) y verificado en Anvil con el árbitro y el SDK reales. Las v1 tienen
> smoke en Base Sepolia; las v2 se redespliegan con el merge. `DeployMainnet.s.sol` despliega solo
> `Escrow1v1`: el de `EscrowAleph` a mainnet todavía no existe. Las direcciones de un entorno publicado y sus
> secretos no se guardan en Git (`.env`, `.env.mainnet` y `broadcast/` estan
> en `.gitignore`), por lo que deben verificarse en la configuracion de ese
> entorno.
