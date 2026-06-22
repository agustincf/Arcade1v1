# Repaso de seguridad — Arcade1v1 (Fase 6)

Fecha: 2026-06-21 · Estado: **testnet / demo** (no opera con dinero real).

Este documento es el resultado de revisar el **contrato** (`packages/contracts`),
el **backend árbitro** (`apps/server`) y la **arquitectura** completa. La idea es
ser honestos sobre lo que falta **antes de pensar en dinero real**.

---

## Modelo de confianza (quién puede hacer qué)

- **Jugadores:** depositan USDC y juegan. No pueden sacar fondos salvo según las
  reglas (premio, reembolso).
- **Árbitro (backend):** decide quién ganó y **firma** el resultado. Es el punto
  central de confianza: si su llave se filtra, puede decidir partidas
  (aunque el ganador siempre debe ser uno de los dos jugadores).
- **Dueño (owner del contrato):** configura árbitro, comisión (tope 20%), wallet
  de comisión y mesas permitidas. **No** puede enviar fondos a una dirección
  arbitraria.
- **El contrato:** custodia el pozo y solo lo mueve según las reglas verificadas.

---

## Lo que el contrato YA garantiza (lo bueno) ✅

- **Nunca paga más de lo depositado** (premio = pozo solo si los dos depositaron).
- **El premio va solo a un jugador real** (p1 o p2); la **comisión está topeada
  al 20%** y el dueño no puede subirla más.
- **Protección anti-reentrada** y patrón "estado antes de transferir".
- **Firmas EIP-712** atadas a la red (chainId) y al contrato → no se pueden
  reusar en otra red/contrato; `matchId` único → no se puede liquidar dos veces.
- **Reembolsos** por: no llenarse a tiempo, vencimiento del plazo de juego (1h)
  o cancelación del árbitro/dueño.
- **8/8 pruebas automáticas pasan.**

---

## Hallazgos (priorizados)

### 🔴 Críticos — bloquean el dinero real
1. **Puntaje sin verificar (anti-trampa).** ✅ **RESUELTO para los 4 juegos**
   (2048, Tetris, Flappy y Carrera). Motor compartido web/servidor; los de tiempo
   real corren con **paso de tiempo fijo** (por ticks) y graban las entradas con
   su tick. El servidor re-simula el *replay* y rechaza cualquier puntaje
   inventado — verificado en `selftest` (legítimo aceptado, inventado rechazado
   en los 4). *(Los juegos nuevos deben seguir el mismo patrón para ir con plata.)*
2. **El flujo de dinero on-chain está probado de punta a punta con el backend
   real; falta desplegarlo y enchufarlo a la UI.** 🟡 El **ciclo completo está
   verificado en cadena local usando el árbitro de verdad** (ver
   `packages/contracts/check-payment-e2e.sh`, además de tests 8/8 + selftest +
   `check-integration.sh`):
   - **Victoria:** emparejar → el árbitro **crea la partida on-chain** → los dos
     depositan → juegan → el árbitro firma → el contrato paga al ganador (8.5) +
     comisión (1.5) y el escrow queda en 0. ✅
   - **Empate:** el árbitro **cancela on-chain** (`cancelMatch`) y el contrato
     **reembolsa a ambos** (balances vuelven al inicio, sin comisión). ✅

   El **código de pago de la web** ya existe (`app/lib/escrow.ts` +
   `app/lib/useEscrow.tsx`). **Falta solo:** (a) **desplegar** a Base Sepolia
   (necesita tu wallet) y (b) **conectar depósito/cobro a la UI** de la partida.
3. **Autenticación en el backend.** ✅ **RESUELTO.** El jugador (y los agentes)
   **firman su envío con la wallet**; el árbitro verifica que la firma recupere
   su dirección (verificado en `selftest`: firma válida aceptada, firma que no
   corresponde rechazada). Con `REQUIRE_AUTH=true` la firma es **obligatoria** en
   producción; en dev queda opcional para permitir invitados de prueba.
   *(Pendiente menor: exigir firma también al emparejar.)*
4. **Legal / regulatorio.** Apuestas con dinero real = licencias, **KYC/AML**,
   verificación de **edad** y **restricciones por país**. Sin esto no se puede
   operar legalmente. (Bloqueante no técnico, el más importante.)

### 🟠 Altos
5. **Endpoint `/bot` de prueba.** ✅ **RESUELTO.** Queda **apagado en producción**
   (`NODE_ENV=production`, salvo `ENABLE_TEST_BOT=true`).
6. **Fallback "offline" simulado en el frontend.** ✅ **RESUELTO.** En producción
   **nunca** se muestra un rival/resultado inventado: si el árbitro no responde,
   se muestra un error (la simulación queda solo en desarrollo).
7. **Llave del árbitro = único punto de confianza.** Guardarla en un KMS/HSM,
   con mínimos privilegios; considerar un **árbitro multi-firma**.
8. **Estado en memoria (sin persistencia).** Si el servidor se reinicia, se
   pierden las partidas en curso. (On-chain queda mitigado por el reembolso a la
   hora, pero hay que **persistir** y tener recuperación.)
9. **Auditoría externa del contrato** por un tercero profesional antes de dinero
   real.

### 🟡 Medios
10. **Rate limiting** en el backend. ✅ **HECHO** — límite por IP (120 pedidos
    cada 10s) que devuelve 429. Ajustable.
11. **Semilla por `Math.random`.** Sirve para que sea igual para ambos, pero un
    esquema *commit-reveal* sería más robusto contra predicción/grinding.
12. **Empate no dispara el reembolso on-chain** (falta integrar `cancelMatch`).
13. **Poderes del dueño.** Mucha confianza concentrada. Considerar **timelock /
    multisig** para el owner.

### 🟢 Bajos
14. **Sin pausa de emergencia** en el contrato (es inmutable; bueno para la
    confianza, pero no hay "freno" si algo sale mal). Evaluar una pausa acotada.
15. **CORS** — ✅ **configurable** con `ALLOWED_ORIGIN` (en producción se
    restringe a tu dominio; en dev queda abierto).
16. **HTTPS obligatorio** en producción (en local es OK sin él).

---

## Checklist "antes de pensar en dinero real"

- [x] **Anti-trampa** (verificación por replay) — *crítico* — hecho en los 4
  juegos (2048, Tetris, Flappy, Carrera). Los juegos nuevos deben seguir el patrón.
- [ ] **Conectar el flujo on-chain real** (depósito USDC + `settle` + reembolso en empate) — *crítico*
- [x] **Autenticación de jugadores** (firmar los envíos con la wallet) — *crítico*
  — hecho; activar con `REQUIRE_AUTH=true` en producción
- [ ] **Asesoría legal + licencias + KYC/AML + edad + geobloqueo** — *crítico (legal)*
- [ ] Quitar `/bot` y el fallback simulado de producción — *alto*
- [ ] Proteger la llave del árbitro (KMS/HSM, multisig) — *alto*
- [ ] Persistencia + recuperación del backend — *alto*
- [ ] **Auditoría externa** del contrato — *alto*
- [ ] Rate limiting + HTTPS + monitoreo — *medio*
- [ ] Pruebas de extremo a extremo en testnet con varios usuarios reales — *medio*

> **Conclusión:** la base está sólida y el contrato es seguro en lo que cubre,
> pero **NO se debe activar dinero real** hasta cerrar al menos los 4 puntos
> críticos (con la parte legal a la cabeza).
