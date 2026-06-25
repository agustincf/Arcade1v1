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
- **9/9 pruebas automáticas pasan.**

---

## Hallazgos (priorizados)

### 🔴 Críticos — bloquean el dinero real
1. **Puntaje sin verificar (anti-trampa).** ✅ **RESUELTO en los 6 juegos**
   (2048, Tetris, Flappy, Carrera, Snake y Space Invaders), con **default-deny**:
   el árbitro tiene un **registro de verificadores** y **rechaza cualquier juego
   que no sepa verificar** (nunca confía en un puntaje sin re-jugar el replay).
   Motor compartido web/servidor; los de tiempo real corren con **paso de tiempo
   fijo** (por ticks) y graban las entradas con su tick. El servidor re-simula el
   *replay* y rechaza cualquier puntaje inventado — verificado en `selftest`
   (legítimo aceptado e inventado rechazado en los 6, + **juego desconocido
   rechazado**). *(Los juegos nuevos deben sumar su verificador al registro.)*
2. **El flujo de dinero on-chain está probado de punta a punta con el backend
   real; falta desplegarlo a una red pública.** 🟡 Modelo **asincrónico open/join**:
   el árbitro **ya no crea la partida ni paga gas** — cada jugador deposita por su
   cuenta (uno **abre**, el otro **se une**) y emparejar es solo orden de llegada.
   El **ciclo completo está verificado en cadena local con el árbitro de verdad**
   (ver `packages/contracts/check-payment-e2e.sh`, + tests 9/9 + selftest +
   `check-integration.sh`):
   - **Victoria:** emparejar → p1 **abre** depositando → p2 **se une** depositando
     → juegan → el árbitro firma → el contrato paga al ganador (8.5) + comisión
     (1.5) y el escrow queda en 0. ✅
   - **Empate / sin resultado a tiempo / sin rival:** reembolso on-chain
     (`cancelMatch` en empate; `refundExpired` / `refundUnfunded` por vencimiento). ✅

   La **UI de pago está enchufada** a la pantalla de partida (`match/page.tsx`):
   con contrato configurado pide **conectar wallet → APROBAR** el allowance →
   emparejar → **ABRIR/UNIRSE** (depositar), y al ganar muestra **COBRAR** (settle
   con la firma del árbitro). Además, la página **`/recover`** deja reclamar el
   reembolso si no apareció rival o la partida quedó sin resultado a tiempo. Queda
   **dormida** mientras no haya `NEXT_PUBLIC_ESCROW_ADDRESS` (el modo de prueba no
   cambia). **Falta solo:** **desplegar** a Base Sepolia/mainnet y setear las
   direcciones (`NEXT_PUBLIC_ESCROW_ADDRESS` / `NEXT_PUBLIC_USDC_ADDRESS`).
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
8. **Estado en memoria / un solo nodo.** Las partidas en curso, la cola de
   emparejamiento y el rate-limit por IP viven en memoria; el ranking ELO se
   guarda en un archivo plano (`data/ratings.json`, con escritura atómica). Esto
   alcanza para **una sola instancia**: si el servidor se reinicia se pierden las
   partidas en curso (on-chain queda mitigado por el reembolso a la hora), y si se
   corre con **más de una instancia** el emparejamiento, el rate-limit y el
   ranking se descoordinan. Para escalar hace falta un **store compartido**
   (Redis/DB) y recuperación de estado.
9. **Auditoría externa del contrato** por un tercero profesional antes de dinero
   real. 🟡 **Parcial:** se corrió **análisis estático con Slither** (0.11.5,
   filtrando `lib/`+`test/`): **sin hallazgos críticos/altos/medios**. Solo 4 avisos
   informativos de `block.timestamp` en los plazos —irrelevantes a escala de 1 hora,
   aceptados— y 2 de eventos de admin sin `indexed` que **ya se corrigieron**
   (`ArbiterUpdated`/`PlatformWalletUpdated`). El análisis automático **no
   reemplaza** una auditoría humana profesional, que sigue pendiente.

### 🟡 Medios
10. **Rate limiting** en el backend. ✅ **HECHO** — límite por IP (120 pedidos
    cada 10s) que devuelve 429. Ajustable.
11. **Semilla por `Math.random`.** Sirve para que sea igual para ambos, pero un
    esquema *commit-reveal* sería más robusto contra predicción/grinding.
12. **Empate dispara el reembolso on-chain.** ✅ **HECHO** — al detectar empate el
    árbitro llama `cancelMatch` y el contrato reembolsa a ambos (verificado e2e en
    cadena local).
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

- [x] **Anti-trampa** (verificación por replay) — *crítico* — hecho en los 6
  juegos (2048, Tetris, Flappy, Carrera, Snake, Space Invaders) con **default-deny**
  (un juego sin verificador se rechaza). Los juegos nuevos deben seguir el patrón.
- [x] **Conectar el flujo on-chain real** (depósito USDC `open`/`join` + `settle` +
  reembolso en empate y por vencimiento) — *crítico* — implementado y verificado
  e2e en cadena local; falta el deploy a testnet/mainnet.
- [x] **Autenticación de jugadores** (firmar los envíos con la wallet) — *crítico*
  — hecho; activar con `REQUIRE_AUTH=true` en producción
- [ ] **Asesoría legal + licencias + KYC/AML + edad + geobloqueo** — *crítico (legal)*
- [ ] Quitar `/bot` y el fallback simulado de producción — *alto*
- [ ] Proteger la llave del árbitro (KMS/HSM, multisig) — *alto*
- [ ] Persistencia + recuperación del backend — *alto*
- [~] **Auditoría externa** del contrato — *alto* — análisis estático (Slither)
  hecho y limpio (sin críticos/altos/medios); falta la auditoría humana profesional
- [ ] Rate limiting + HTTPS + monitoreo — *medio*
- [ ] Pruebas de extremo a extremo en testnet con varios usuarios reales — *medio*

> **Conclusión:** la base está sólida y el contrato es seguro en lo que cubre,
> pero **NO se debe activar dinero real** hasta cerrar al menos los 4 puntos
> críticos (con la parte legal a la cabeza).
