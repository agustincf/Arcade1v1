# Pasar a mainnet (Base) — qué falta y quién lo hace

**EN** — Everything that has to happen before Arcade1v1 handles real USDC on
Base mainnet, in one place: what the code still needs (and its status), what the
project owner has to operate, and what depends on third parties (legal advice
and an external contract audit). The critical path is **final contracts →
external audit → mainnet deploy**, with the legal work running in parallel from
day one. Details below are in Spanish, the project's working language.

> Estado: **2026-09-24**, versión 3.9.0 en testnet (Base Sepolia, dinero de
> juego). Este documento junta lo que piden [SECURITY.md](../SECURITY.md),
> [DEPLOY.md](../DEPLOY.md) y [ROADMAP.md](ROADMAP.md) antes de operar con USDC
> real. Cuando un punto se cierra, se marca acá y en su documento de origen, en
> el mismo PR.

---

## El camino crítico

```
contratos finales ──▶ auditoría externa ──▶ deploy a Base mainnet
        ▲                                          ▲
        │ (todo cambio de Solidity entra ANTES      │ owner en hardware/multisig,
        │  de la auditoría: después es re-auditar)  │ llave del árbitro resguardada,
        │                                          │ RPC, gas y monitoreo
lo legal ─────────────── en paralelo, desde hoy ────┘ (sin esto no se opera)
```

1. **Contratos finales.** La auditoría tiene que mirar el código que va a
   custodiar la plata, no uno que después cambia. Por eso todo lo que toque
   Solidity va primero (sección 1, puntos C1, C2 y C4 a C8).
2. **Auditoría externa** de `Escrow1v1` (y de `EscrowAleph` el día que sus
   mesas de plata vayan a mainnet: ver la decisión 6). Es lo más largo del lado
   técnico: semanas, y la contrata el dueño.
3. **Deploy a mainnet**, con todo lo operativo de la sección 2 listo.
4. **Lo legal** no depende de nada técnico y es lo que más tarda: arranca ya.

---

## 1. Código (lo resuelve el repo)

| #   | Qué                                                                                                                                                                                                                                                                                            | Gravedad        | Estado                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------ |
| C1  | **`EscrowAleph`: un pago que el USDC rechaza no traba la sala.** Cada pago se empuja por separado; el rechazado (blacklist de Circle, token en pausa) queda acreditado a su dueño, que lo cobra con `withdraw`.                                                                                | alto            | ✅ v2 del contrato (redespliegue en testnet pendiente) |
| C2  | **`EscrowAleph`: la tabla firmada vence** (`Payout(roomId, tableHash, deadline)`), y el árbitro no publica ni manda una firma antes de tenerla guardada.                                                                                                                                       | alto            | ✅ v2 del contrato (redespliegue en testnet pendiente) |
| C3  | **Flappy en vivo: cada intento guardado antes de revelar** valores nuevos (una caída dura ya no lo rebobina).                                                                                                                                                                                  | medio           | ✅ hecho                                               |
| C4  | **`Escrow1v1`: el mismo problema de la blacklist.** Si el ganador caía en la blacklist de USDC, `settle` revertía, y `refundExpired`/`cancelMatch` también (empujaban a los dos): el stake del perdedor quedaba trabado para siempre. Mismo arreglo que C1.                                    | alto            | ✅ v2 del contrato (redespliegue en testnet pendiente) |
| C5  | **`Escrow1v1`: el `Result` firmado vence** (`Result(matchId, winner, deadline)`), y el árbitro guarda la decisión antes de mostrar la firma o mandarla en una transacción. Antes, una partida decidida dos veces dejaba dos firmas válidas con ganadores distintos.                            | alto            | ✅ v2 del contrato + árbitro                           |
| C6  | **`Escrow1v1`: el asiento firmado ata el stake y los plazos** (`Seat(matchId, player, stake, fundDeadline, playDeadline)`), como ya hacía `EscrowAleph`. Antes los elegía quien abría.                                                                                                         | medio           | ✅ v2 del contrato + árbitro                           |
| C7  | **Freno de emergencia de las entradas**, sin pausa nueva: una mesa deshabilitada con `setAllowedStake(x, false)` ahora frena `open` **y** `join`/`deposit`; las salidas (liquidar, reembolsar, retirar) nunca se frenan. Más rápido: el árbitro deja de firmar asientos (`STAKES_ALLOWED=""`). | medio           | ✅ v2 de los dos contratos (decisión 5)                |
| C8  | **Dueño en dos pasos** (`Ownable2Step`) en los dos contratos, y `renounceOwnership` deshabilitada: antes un `transferOwnership` a una dirección con un error, o una renuncia, perdían la administración para siempre.                                                                          | medio           | ✅ v2 de los dos contratos                             |
| C9  | **El árbitro liquida el 1v1**: presenta su propia firma apenas queda guardada, con reintentos; si otro la presentó antes (el ganador), lo lee de la cadena. Antes cobraba el ganador, y si no lo hacía a tiempo el perdedor podía pedir el reembolso.                                          | alto (usuario)  | ✅ árbitro y web                                       |
| C10 | **Script de deploy a mainnet de `EscrowAleph`**: `DeployMainnet.s.sol` despliega solo `Escrow1v1`.                                                                                                                                                                                             | —               | no hace falta para el lanzamiento (decisión 6)         |
| C11 | **Web: geobloqueo, edad y aceptación de términos** antes de depositar. El mecanismo lo puede construir el repo; la lista de países y las reglas salen del trabajo legal (L1).                                                                                                                  | crítico (legal) | pendiente de las definiciones legales                  |
| C12 | **La llave del árbitro, firmando desde un KMS/HSM** en vez de `ARBITER_PRIVATE_KEY` en el entorno (viem admite cuentas propias). Depende del proveedor que se elija (O2).                                                                                                                      | alto            | pendiente                                              |
| C13 | **Semilla anticipada en los otros cinco juegos** (2048, Tetris, Snake, Carrera, Space Invaders): con la semilla en la mano se puede optimizar la corrida offline. El arreglo de fondo es pasarlos al modelo en vivo de Flappy.                                                                 | medio           | pendiente (es el trabajo más grande de la lista)       |

Ya cerrado en rondas anteriores (para no repetirlo): verificación por replay en
los 6 juegos, semilla atada a la partida, un intento por jugador, firma
obligatoria en producción, puntaje del rival oculto, topes de acciones por tick,
el árbitro lee el escrow antes de aceptar un puntaje, traspaso entre instancias
sin cortes, approve por el monto exacto. Detalle en [SECURITY.md](../SECURITY.md).

---

## 2. Operación (lo hace el dueño; el repo documenta cómo)

| #   | Qué                                                                                                                                                                                                | Estado                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| O1  | **Dueño de los contratos en una wallet de hardware**, idealmente un multisig Safe. Nunca una clave generada por script en un `.env`. `deploy-base-mainnet.sh` ya firma con `--ledger`.             | pendiente                                               |
| O2  | **Llave del árbitro resguardada** (KMS/HSM, o como mínimo el secreto del hosting), con su dirección en `ARBITER_ADDRESS`. Ver C12.                                                                 | pendiente                                               |
| O3  | **RPC propio de Base mainnet** (Alchemy/QuickNode) en `RPC_URL` y `NEXT_PUBLIC_RPC_URL`, y **ETH real** en la wallet que despliega y en la del árbitro (paga reembolsos y liquidaciones).          | pendiente (en testnet ya está: v3.0)                    |
| O4  | **Monitoreo**: el monitor de gas con umbral y webhook (`GAS_ALERT_*`), y una alerta de caída del árbitro. Upstash en la misma región que Render: cada compromiso en vivo ahora espera un guardado. | parcial (gas: sí; caídas: no)                           |
| O5  | **Redis (Upstash) verificado en producción** y el traspaso con timbre funcionando (`Traspaso: doorbell` en los logs de cada deploy).                                                               | hecho en testnet; re-verificar en el entorno de mainnet |
| O6  | **Prueba de punta a punta en testnet con usuarios reales**, con los dos contratos v2 ya redesplegados.                                                                                             | pendiente                                               |
| O7  | **Redespliegue de `Escrow1v1` v2 y `EscrowAleph` v2 en Base Sepolia** junto con el merge que los trae ([runbook](REDEPLOY-contratos-v2.md)).                                                       | pendiente (al mergear)                                  |

---

## 3. Terceros

| #   | Qué                                                                                                                                                                                                                                    | Estado    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| L1  | **Asesoría legal**: si hace falta licencia y cuál, KYC/AML, verificación de edad, países donde no se puede operar, términos y privacidad. Es el bloqueante no técnico más importante (SECURITY.md, hallazgo 4), y define C11.          | pendiente |
| L2  | **Auditoría externa profesional** de `Escrow1v1` (y de `EscrowAleph` si sus mesas de plata van a mainnet), sobre la versión final (la v2). Slither ya corrió limpio sobre la versión anterior, pero no reemplaza una auditoría humana. | pendiente |

---

## Decisiones (tomadas el 2026-09-24)

El dueño las delegó ("quiero que vos decidas"); se tomaron así, y cualquiera se
puede revisar antes de la auditoría:

1. **`Escrow1v1` recibe el mismo tratamiento que `EscrowAleph` v2 (C4 y C5)**, en
   un solo redespliegue de testnet para los dos contratos.
2. **El asiento del 1v1 ata el stake y los plazos (C6).** Los fija el árbitro al
   crear la partida (fondeo: la espera de rival + 10 min; juego: la ventana de
   envío), y la web abre con esos.
3. **El árbitro liquida el 1v1 (C9).** `settle` sigue siendo permissionless: la
   web conserva el botón de cobrar como respaldo.
4. **`Ownable2Step` en los dos contratos (C8)**, y sin `renounceOwnership`.
5. **Sin función de pausa nueva (C7).** El freno de las entradas es
   `setAllowedStake(x, false)`, que ahora también frena `join`/`deposit`, más el
   árbitro dejando de firmar asientos. Una pausa aparte sumaría superficie que
   auditar sin frenar nada que esto no frene. Se revisa con quien audite.
6. **Mainnet arranca solo con el 1v1.** Las mesas de plata de Aleph siguen en
   testnet: la primera auditoría cubre solo `Escrow1v1`, y C10 no hace falta para
   el lanzamiento. Es la única decisión de producto de la lista.

---

## Cómo seguir (para retomar en otra sesión o en local)

Todo el trabajo vive en la rama `claude/mainnet-requirements-2ksx0x` (PR #48).

```
git fetch origin
git checkout claude/mainnet-requirements-2ksx0x
npm ci
```

Los tests del contrato necesitan Foundry v1.8.3 y las librerías en
`packages/contracts/lib` (forge-std v1.16.1 y OpenZeppelin v5.6.1): los comandos
exactos están en `.github/workflows/ci.yml`.

**Hecho y probado en la rama:** `EscrowAleph` v2 (C1, C2), Flappy en vivo
durable (C3), `Escrow1v1` v2 (C4, C5, C6, C8) y el freno de mesa (C7) en los
dos contratos; el árbitro del 1v1 con plazos en el asiento, firma con
vencimiento, decisión guardada antes de mostrarse y liquidación propia (C9);
la web adaptada (abre con los plazos del árbitro, muestra el pago del árbitro,
cobro de respaldo con la firma que vence, retiro de lo acreditado en
`/recover`); el runbook del redespliegue de los dos contratos
([`REDEPLOY-contratos-v2.md`](REDEPLOY-contratos-v2.md)); y la documentación.
Verificado con `forge test` (113), `npm run check`, los cinco e2e de anvil y el
build de la web.

**Falta:**

1. **Revisión y merge del PR #48** (el dueño), sacándolo de borrador cuando CI
   esté en verde. Si retomás el trabajo antes: correr la verificación completa
   (`npm run check`, `forge test`, los cinco e2e con
   `bash packages/contracts/check-*.sh` —ojo: hacen `pkill -f anvil`— y
   `npm run build --workspace apps/web`) después de cada cambio.
2. **Del dueño, con el merge**: el redespliegue de los dos contratos en testnet
   siguiendo el runbook (O7).
3. **Del dueño, después**: prueba con usuarios reales (O6), auditoría de
   `Escrow1v1` v2 (L2), lo legal (L1), y el deploy a mainnet con el dueño en una
   Safe o Ledger (O1) y la llave del árbitro resguardada (C12, O2).
4. **Código que sigue abierto** (sección 1): C11 (geobloqueo, edad y términos:
   espera las definiciones legales), C12 (el árbitro firmando desde un KMS: espera
   al proveedor) y C13 (la semilla anticipada en los otros cinco juegos: el
   trabajo más grande de la lista).
