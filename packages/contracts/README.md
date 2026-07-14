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

## Correr las pruebas (local, sin gastar nada)

```bash
cd packages/contracts
forge test -vv
```

Estado actual: 9/9 pruebas pasando (`test/Escrow1v1.t.sol`), cubriendo el
deposito, el pago con firma valida/invalida, los tres caminos de reembolso y
las validaciones de mesa/jugador.

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

> Estado: contrato probado (9/9 pruebas) y flujo completo verificado en Anvil
> (deposito, pago y reembolso). Las direcciones de un entorno publicado y sus
> secretos no se guardan en Git (`.env`, `.env.mainnet` y `broadcast/` estan
> en `.gitignore`), por lo que deben verificarse en la configuracion de ese
> entorno. <!-- VERIFY: direccion desplegada del contrato en Base Sepolia/mainnet -->
