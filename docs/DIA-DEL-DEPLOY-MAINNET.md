# El día del deploy a mainnet, paso a paso

Esta guía junta en orden todo lo que pasa el día que Arcade1v1 empieza a manejar
USDC real en Base mainnet: qué tiene que estar listo antes, cómo vaciar testnet
sin dejar partidas colgadas, el deploy del contrato, las variables de Render y
de Vercel, la primera partida con plata real y cómo volver atrás. El detalle
técnico de cada pieza está en [`DEPLOY.md`](../DEPLOY.md) ("Pasar a DINERO
REAL") y la lista completa de pendientes en [`MAINNET.md`](MAINNET.md).

> Mainnet arranca solo con el **1v1**: las mesas de plata de **Aleph siguen en
> testnet** (decisión 6 de `MAINNET.md`). Lo legal (licencia, KYC, países) sigue
> sin hacerse, bajo tu criterio.

---

## Antes del día (puede llevar semanas)

Nada de esto se hace el mismo día. Cuando esté todo tildado, se elige el día.

- [ ] **La auditoría externa cerrada** (L2) y sus arreglos, si hubo, revisados
      por el auditor. Con el informe en la mano, se completa
      `packages/contracts/build-aprobada.json` en un PR (lo arma
      `npx tsx packages/contracts/deploy-mainnet.ts hash` sobre el commit
      auditado). Sin eso, el script de deploy no firma nada.
- [ ] **La Safe creada en Base** (O1), en [app.safe.global](https://app.safe.global),
      red **Base**, con tu Ledger como firmante. Anotá su dirección: es
      `SAFE_ADDRESS`, la dueña del contrato (puede cambiar el árbitro, la wallet
      de cobro y la comisión, así que no conviene que sea una wallet común).
- [ ] **Tu Ledger** con la app de Ethereum, y una cuenta suya con un poco de
      ETH en Base para el gas del deploy (con unos USD 5 sobra; el script
      chequea que alcance antes de firmar). Es `DEPLOYER_ADDRESS`.
- [ ] **La wallet que cobra la comisión**: tu MetaMask (es `PLATFORM_WALLET`).
      Confirmá la dirección ese día, copiándola de MetaMask.
- [ ] **La llave del árbitro.** Recomendado: **la misma que hoy** (la de
      `ARBITER_PRIVATE_KEY` en Render). Aleph sigue en testnet y su contrato
      espera esa llave: con una nueva habría que rotarla también ahí
      ([`ROTAR-LLAVE-ARBITRO.md`](ROTAR-LLAVE-ARBITRO.md)). Su dirección es
      `ARBITER_ADDRESS` (`curl -s https://arcade1v1.onrender.com/arbiter`).
- [ ] **ETH real en la wallet del árbitro**, en Base: con 0,01–0,02 ETH alcanza
      para muchas partidas (cada pago o reembolso cuesta centavos). El vigía
      abre un issue si baja de 0,005. **No le saques el ETH de Base Sepolia**:
      sigue pagando el gas de Aleph en testnet (y eso no lo vigila nadie).
- [ ] **Un RPC de Base mainnet** (O3). El público (`https://mainnet.base.org`)
      es gratis y sin cuenta, pero tiene límite de pedidos: sirve para mirar,
      no para un árbitro con tráfico. Lo habitual es una cuenta gratuita en un
      proveedor (Alchemy o QuickNode). Es `RPC_URL` en Render,
      `NEXT_PUBLIC_RPC_URL` en Vercel y `BASE_MAINNET_RPC_URL` para el deploy.
- [ ] **Una cuenta de Basescan** con su API key (`ETHERSCAN_API_KEY`), para
      publicar el código fuente del contrato.
- [ ] **El vigía andando** (`docs/MAINNET.md`, O4): el workflow `keep-alive` con
      `scripts/vigia.mjs` mergeado, y el mail de un issue de prueba recibido.

---

## El día

Calculá medio día: el paso 1 puede llevar hasta 3 horas de espera.

### 1. Vaciar testnet (hasta ~3 h)

Las partidas no guardan en qué red se jugaron, así que las de plata de testnet
tienen que terminar **antes** de cambiar de red. Si no, el árbitro de mainnet
no abre las mesas de plata hasta que terminen solas, y sus depósitos de prueba
quedan para reembolsar a mano en el contrato viejo (lo frena y lo avisa:
`network-switch.ts`).

1. En Render, en el servicio del árbitro, agregá la variable `STAKES_ALLOWED`
   **vacía** y guardá (se redespliega solo). Desde ahí no se abren mesas de
   plata nuevas; la ladder gratis sigue igual. La web sigue mostrando las mesas,
   pero el árbitro las rechaza con `stake not allowed`.
2. Esperá a que `curl -s https://arcade1v1.onrender.com/health` diga
   **`"paidOpen":0`**: cada partida de plata que estaba en juego se termina, se
   liquida o se reembolsa sola (esperando rival: hasta 1 h; jugándose: la
   ventana de 2 h más el pago).

### 2. Desplegar el contrato (con la Ledger)

En `packages/contracts/.env.mainnet` (ver `DEPLOY.md`): `BASE_MAINNET_RPC_URL`,
`DEPLOYER_ADDRESS`, `SAFE_ADDRESS`, `ARBITER_ADDRESS`, `PLATFORM_WALLET` y
`ETHERSCAN_API_KEY`. Después, con la Ledger conectada y la app de Ethereum
abierta:

```bash
bash packages/contracts/deploy-base-mainnet.sh chequeos
```

Mira todo sin firmar nada: el código es exactamente el auditado, el árbol está
limpio, la red es Base con el USDC real, la Safe es una Safe y el gas alcanza.
Si algo falla, dice qué. Con los chequeos en verde:

```bash
bash packages/contracts/deploy-base-mainnet.sh
```

Pide escribir `MAINNET` y la Ledger pide 6 firmas (el contrato, las 4 mesas y el
traspaso a la Safe). **Anotá la dirección del contrato** que imprime al final.

### 3. La Safe acepta el contrato

En app.safe.global (red Base) → Transaction Builder → la dirección del contrato
→ `acceptOwnership()`, y firmalo con la Ledger. Después:

```bash
bash packages/contracts/deploy-base-mainnet.sh verificar <dirección del contrato>
```

Tiene que decir `✓ [duenio] la dueña es la Safe`.

### 4. El árbitro a mainnet (Render)

En las variables del servicio del árbitro:

| Variable               | Valor                                                                     |
| ---------------------- | ------------------------------------------------------------------------- |
| `CHAIN_ID`             | `8453`                                                                    |
| `ESCROW_ADDRESS`       | la dirección del contrato del paso 2                                      |
| `RPC_URL`              | tu RPC de Base mainnet                                                    |
| `STAKES_ALLOWED`       | **borrarla** (vuelve a 1, 2, 5 y 10)                                      |
| `ALEPH_CHAIN_ID`       | `84532` (Aleph se queda en testnet; sin esto el árbitro no arranca)       |
| `ALEPH_RPC_URL`        | un RPC de Base Sepolia (`https://sepolia.base.org` o el tuyo)             |
| `ALEPH_ESCROW_ADDRESS` | el de testnet, el mismo de hoy (no se toca)                               |
| `ARBITER_PRIVATE_KEY`  | no se toca (salvo que hayas elegido una llave nueva y rotado la de Aleph) |

Guardá y esperá el deploy. Revisá:

```bash
curl -s https://arcade1v1.onrender.com/health
```

Tiene que decir `"escrow":"ok"`, `"paidOpen":0` y **no** traer
`networkSwitch`. Si dice `"escrow":"blocked"`, el log del árbitro dice por qué:
`[escrow-check]` (la red, el árbitro o la comisión no coinciden con el
contrato) o `[cambio-de-red]` (quedaron partidas de plata de testnet: el paso 1
no terminó).

### 5. La web a mainnet (Vercel)

En las variables del proyecto:

| Variable                     | Valor                                        |
| ---------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_CHAIN_ID`       | `8453`                                       |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | la dirección del contrato del paso 2         |
| `NEXT_PUBLIC_USDC_ADDRESS`   | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `NEXT_PUBLIC_RPC_URL`        | tu RPC de Base mainnet                       |

Redesplegá la web. Revisá que la portada ya no diga "testnet".

### 6. La primera partida con plata real

Una mesa de **1 USDC** entre dos wallets tuyas: depositá con una, unite con la
otra, jugá las dos. El árbitro paga solo: el ganador tiene que recibir 1,70 USDC
y tu MetaMask 0,30 de comisión. La pantalla de la partida muestra el pago, y
`curl -s https://arcade1v1.onrender.com/match/<matchId>` trae su `settleTx`:
abrilo en [basescan.org](https://basescan.org) y mirá los dos pagos.

### 7. Después

- El vigía mira el gas del árbitro **en Base** desde ahora (sigue solo la red
  del 1v1, sin tocar nada).
- Los agentes con `paid1v1` necesitan `chainId: 8453`, el `escrow` nuevo y un
  RPC de mainnet. Avisalo donde corresponda (README, `/agents`) cuando quieras
  que jueguen con plata real.

---

## Volver atrás

- **Antes del paso 4** no cambió nada visible: el contrato desplegado no
  molesta a nadie. Si querés frenar, borrá `STAKES_ALLOWED` en Render y testnet
  vuelve a abrir sus mesas de plata.
- **Después del paso 4 y antes de que se juegue plata real**: volvé las
  variables de Render y Vercel a las de testnet (anotalas antes de cambiarlas).
- **Con partidas de plata real ya abiertas**: primero vaciá mainnet igual que el
  paso 1 (`STAKES_ALLOWED` vacía, esperar `"paidOpen":0`) y recién ahí volvé a
  testnet. Si te apurás, el árbitro de testnet no abre mesas de plata hasta que
  las de mainnet terminen, y sus depósitos (**plata real**) quedan para
  reembolsar a mano en el contrato de mainnet (`refundExpired`, cuando vence
  cada partida).
- **Para frenar solo la entrada de plata** (algo raro en la cadena), sin cambiar
  de red: `STAKES_ALLOWED` vacía en Render (inmediato) o, desde la Safe,
  `setAllowedStake(<mesa>, false)` en el contrato (decisión 5 de `MAINNET.md`).
