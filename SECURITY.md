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
1. **Puntaje sin verificar (anti-trampa).** ✅ **RESUELTO para 2048** (el juego y
   el servidor comparten el mismo motor; el servidor re-juega el *replay* y
   rechaza cualquier puntaje inventado — verificado en `selftest`). ⚠️ **Falta
   para los juegos en tiempo real** (Tetris, Flappy, Carrera): necesitan que su
   motor corra con paso de tiempo fijo y se grabe la secuencia de entradas para
   poder re-simularlos igual. Hasta entonces, esos tres no son verificables.
2. **El flujo de dinero on-chain está probado, falta desplegarlo y enchufarlo a
   la UI.** 🟡 El **pago completo está verificado en cadena local**: depósito real
   de USDC → el árbitro firma → el contrato paga al ganador (8.5) + comisión (1.5)
   y el escrow queda en 0 (ver `packages/contracts/check-payment-e2e.sh`, además
   de tests 8/8 + selftest + `check-integration.sh`). El **código de pago de la
   web** ya existe (`app/lib/escrow.ts` + `app/lib/useEscrow.tsx`). **Falta:**
   (a) **desplegar** a Base Sepolia (necesita tu wallet), (b) **conectar
   depósito/cobro a la UI** de la partida, (c) que el **árbitro cree la partida
   on-chain** al emparejar, y (d) **reembolso en empate** (`cancelMatch`).
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
5. **Endpoint `/bot` de prueba.** Debe **eliminarse o bloquearse** en producción
   (permite forzar la liquidación contra un bot).
6. **Fallback "offline" simulado en el frontend.** En una partida de plata jamás
   debe mostrar un rival/resultado inventado. Dejarlo **solo para el modo libre**.
7. **Llave del árbitro = único punto de confianza.** Guardarla en un KMS/HSM,
   con mínimos privilegios; considerar un **árbitro multi-firma**.
8. **Estado en memoria (sin persistencia).** Si el servidor se reinicia, se
   pierden las partidas en curso. (On-chain queda mitigado por el reembolso a la
   hora, pero hay que **persistir** y tener recuperación.)
9. **Auditoría externa del contrato** por un tercero profesional antes de dinero
   real.

### 🟡 Medios
10. **Sin rate limiting** en el backend → spam / DoS. Agregar límites.
11. **Semilla por `Math.random`.** Sirve para que sea igual para ambos, pero un
    esquema *commit-reveal* sería más robusto contra predicción/grinding.
12. **Empate no dispara el reembolso on-chain** (falta integrar `cancelMatch`).
13. **Poderes del dueño.** Mucha confianza concentrada. Considerar **timelock /
    multisig** para el owner.

### 🟢 Bajos
14. **Sin pausa de emergencia** en el contrato (es inmutable; bueno para la
    confianza, pero no hay "freno" si algo sale mal). Evaluar una pausa acotada.
15. **CORS abierto (`*`)** — aceptable para API pública, pero combinar con auth.
16. **HTTPS obligatorio** en producción (en local es OK sin él).

---

## Checklist "antes de pensar en dinero real"

- [~] **Anti-trampa** (verificación por replay) — *crítico* — hecho en 2048;
  falta en Tetris/Flappy/Carrera (requiere motor con paso de tiempo fijo)
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
