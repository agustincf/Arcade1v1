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
2. **Auditoría externa** de los dos contratos (`Escrow1v1` y `EscrowAleph`).
   Es lo más largo del lado técnico: semanas, y la contrata el dueño.
3. **Deploy a mainnet**, con todo lo operativo de la sección 2 listo.
4. **Lo legal** no depende de nada técnico y es lo que más tarda: arranca ya.

---

## 1. Código (lo resuelve el repo)

| #   | Qué                                                                                                                                                                                                                                                               | Gravedad        | Estado                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------- |
| C1  | **`EscrowAleph`: un pago que el USDC rechaza no traba la sala.** Cada pago se empuja por separado; el rechazado (blacklist de Circle, token en pausa) queda acreditado a su dueño, que lo cobra con `withdraw`.                                                   | alto            | ✅ v2 del contrato (redespliegue en testnet pendiente)  |
| C2  | **`EscrowAleph`: la tabla firmada vence** (`Payout(roomId, tableHash, deadline)`), y el árbitro no publica ni manda una firma antes de tenerla guardada.                                                                                                          | alto            | ✅ v2 del contrato (redespliegue en testnet pendiente)  |
| C3  | **Flappy en vivo: cada intento guardado antes de revelar** valores nuevos (una caída dura ya no lo rebobina).                                                                                                                                                     | medio           | ✅ hecho                                                |
| C4  | **`Escrow1v1`: el mismo problema de la blacklist.** Si el ganador cae en la blacklist de USDC, `settle` revierte, y `refundExpired`/`cancelMatch` también (empujan a los dos): el stake del perdedor queda trabado para siempre. Mismo arreglo que C1.            | alto            | propuesta: falta la decisión del dueño                  |
| C5  | **`Escrow1v1`: el `Result` firmado no vence.** Una partida de plata decidida dos veces (una caída dura con las últimas jugadas perdidas) deja dos firmas válidas con ganadores distintos, y cobra la primera que llega. Mismo arreglo que C2.                     | alto            | propuesta: falta la decisión del dueño                  |
| C6  | **`Escrow1v1`: el asiento firmado ata quién entra, no con qué condiciones** (quinta ronda de SECURITY.md, punto 3): el stake y los plazos los elige quien abre. Atarlos al asiento, como ya hace `EscrowAleph`.                                                   | medio           | propuesta: falta la decisión del dueño                  |
| C7  | **Pausa de emergencia acotada** en los dos contratos: frena solo las entradas (`open`/`join`/`deposit`), nunca las salidas.                                                                                                                                       | medio           | a decidir con la auditoría (SECURITY.md, hallazgo 14)   |
| C8  | **Dueño en dos pasos** (`Ownable2Step`) en los dos contratos: hoy un `transferOwnership` a una dirección con un error, o un `renounceOwnership`, pierde la administración para siempre.                                                                           | medio           | propuesta: falta la decisión del dueño                  |
| C9  | **Que el árbitro liquide solo el 1v1.** Hoy cobra el ganador; si no lo hace antes de `playDeadline` + 30 min (la web abre con +2 h), cualquiera, el perdedor incluido, puede pedir `refundExpired` y el ganador pierde el premio. En Aleph ya liquida el árbitro. | alto (usuario)  | propuesta: solo árbitro, sin tocar el contrato          |
| C10 | **Script de deploy a mainnet de `EscrowAleph`**: `DeployMainnet.s.sol` hoy despliega solo `Escrow1v1`.                                                                                                                                                            | —               | pendiente, si las mesas de plata de Aleph van a mainnet |
| C11 | **Web: geobloqueo, edad y aceptación de términos** antes de depositar. El mecanismo lo puede construir el repo; la lista de países y las reglas salen del trabajo legal (L1).                                                                                     | crítico (legal) | pendiente de las definiciones legales                   |
| C12 | **La llave del árbitro, firmando desde un KMS/HSM** en vez de `ARBITER_PRIVATE_KEY` en el entorno (viem admite cuentas propias). Depende del proveedor que se elija (O2).                                                                                         | alto            | pendiente                                               |
| C13 | **Semilla anticipada en los otros cinco juegos** (2048, Tetris, Snake, Carrera, Space Invaders): con la semilla en la mano se puede optimizar la corrida offline. El arreglo de fondo es pasarlos al modelo en vivo de Flappy.                                    | medio           | pendiente (es el trabajo más grande de la lista)        |

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
| O6  | **Prueba de punta a punta en testnet con usuarios reales**, con el redespliegue de `EscrowAleph` v2 incluido.                                                                                      | pendiente                                               |
| O7  | **Redespliegue de `EscrowAleph` v2 en Base Sepolia** junto con el merge que lo trae ([runbook](REDEPLOY-escrow-aleph-v2.md)).                                                                      | pendiente (al mergear)                                  |

---

## 3. Terceros

| #   | Qué                                                                                                                                                                                                                           | Estado    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| L1  | **Asesoría legal**: si hace falta licencia y cuál, KYC/AML, verificación de edad, países donde no se puede operar, términos y privacidad. Es el bloqueante no técnico más importante (SECURITY.md, hallazgo 4), y define C11. | pendiente |
| L2  | **Auditoría externa profesional** de `Escrow1v1` y `EscrowAleph`, sobre la versión final (después de C4 a C8). Slither ya corrió limpio sobre la versión anterior, pero no reemplaza una auditoría humana.                    | pendiente |

---

## Decisiones que necesita el dueño

Para que los contratos queden finales y la auditoría pueda arrancar:

1. **¿`Escrow1v1` recibe el mismo tratamiento que `EscrowAleph` v2 (C4 y C5)?**
   La recomendación es sí, en un solo redespliegue: son los mismos dos riesgos,
   con plata real y un radio menor (2 asientos en vez de hasta 8).
2. **¿Se ata el stake y los plazos al asiento del 1v1 (C6)?** Recomendado: la
   web ya los verifica antes de unirse, pero el contrato no.
3. **¿Pausa de emergencia (C7) y dueño en dos pasos (C8)?** Recomendado:
   `Ownable2Step` sí (barato y sin riesgo); la pausa, decidirla con quien audite.
4. **¿El árbitro liquida el 1v1 (C9)?** Recomendado: sí. No toca el contrato
   (`settle` ya es permissionless) y saca al ganador de la carrera contra el
   reembolso.
5. **¿Las mesas de plata de Aleph van a mainnet en el lanzamiento (C10)?** La
   etapa 4 dijo que no desbloqueaba mainnet; si van, hace falta su script de
   deploy con las mismas guardas que el del 1v1.
