# Repaso de seguridad — Arcade1v1 (Fase 6)

Fecha: 2026-06-21 (1ª ronda) · 2026-06-26 (2ª ronda) · 2026-07-02 (3ª ronda —
preparación mainnet, ver abajo) · Estado: **testnet / demo** (no opera con
dinero real).

---

## Actualización 2026-07-02 — tercera ronda (auditoría completa pre-mainnet)

Pasada completa sobre contrato, árbitro, web, MCP y SDKs. Resuelto en esta ronda:

### 🔴 CRÍTICO — RESUELTO: el rival podía **espiar tu puntaje antes de jugar**

`GET /match/:id` devolvía los `scores` de la partida a cualquiera, **también
antes del cierre**. El segundo jugador consultaba el puntaje del primero y jugaba
sabiendo EXACTAMENTE cuánto superar (o directamente no depositaba/jugaba si no le
convenía) → ventaja desleal decisiva con plata en juego. **Arreglo:** hasta que la
partida se decide, cada jugador ve **solo su propio puntaje** (nuevo campo
`rivalSubmitted` avisa que el rival ya jugó, sin revelar cuánto); el detalle
completo aparece recién al liquidar. Cubierto en `selftest`.

### 🟠 Altos — RESUELTOS

- **Emparejar sin autenticación.** Cualquiera podía encolar direcciones AJENAS
  (suplantación) o llenar la cola de rivales fantasma que nunca depositan (el
  rival real deposita, espera y pierde tiempo y gas). **Arreglo:** `/matchmake`
  ahora exige (en producción, mismo criterio `REQUIRE_AUTH` que el envío de
  puntaje) una **firma de la wallet** sobre `matchmakeAuthMessage(game, stake,
address, ts)` con ventana anti-replay de 10 min. Web, agent-sdk y MCP ya firman
  solos. Cubierto en `selftest` (válida sí / ajena no / vencida no).
- **`approve` infinito en la web.** El flujo de depósito aprobaba `maxUint256`
  hacia el escrow: un bug del contrato podía drenar **todo** el USDC de la wallet.
  **Arreglo:** se aprueba el monto **exacto** de la apuesta, cada vez.
- **`join` a ciegas.** P2 depositaba sin verificar la partida on-chain. Un P1
  malicioso podía abrirla por su cuenta con `playDeadline` lejano (años) y dejar
  el depósito de P2 **atrapado** hasta entonces. **Arreglo:** antes de unirse, la
  web lee la partida del contrato y verifica estado/monto/plazos normales; ante
  cualquier anomalía **no deposita**. Defensa extra: el **barrendero** del árbitro
  (abajo) cancela on-chain las partidas emparejadas sin resultado (reembolso).
- **Partidas eternas en memoria/disco.** Las partidas nunca se purgaban (fuga de
  memoria) y una emparejada sin resultado quedaba colgada para siempre.
  **Arreglo:** barrendero cada 60s — waiters vencidos se descartan, terminadas
  viejas se purgan, y una emparejada sin resultado al vencer la **ventana de
  envío** (2h, `SUBMIT_WINDOW_MS`) se marca expirada y se **cancela on-chain**
  (reembolso a ambos). Además los envíos tardíos o a partidas ya decididas se
  rechazan. Cubierto en `selftest`.

### 🟡 Medios/bajos — RESUELTOS

- **Mesas sin validar** en el árbitro (NaN/negativos/montos arbitrarios creaban
  colas basura persistidas): ahora solo se aceptan las mesas permitidas
  (`STAKES_ALLOWED`, default 1/2/5/10 — las del contrato). Cubierto en `selftest`.
- **Direcciones sensibles a mayúsculas:** `0xAbC…` y `0xabc…` eran dos jugadores
  distintos (doble ELO, errores de reenvío). Ahora se normalizan a minúsculas.
- **Semilla con `Math.random`** (predecible): ahora `crypto.randomInt` (CSPRNG).
- **Rate-limit con fuga de memoria** (una entrada por IP para siempre): limpieza
  periódica. **Persistencia** que escribía TODO el archivo por request (bloqueo
  del event loop): ahora con debounce + flush en el apagado (SIGTERM).
- **Empates quemaban gas** si la partida no era cancelable on-chain: el árbitro
  ahora **simula** `cancelMatch` antes de mandar la transacción.
- **Config de producción:** la guarda ahora también exige `RPC_URL` (sin nodo no
  hay reembolso automático de empates/vencidas). Cubierto en `selftest`.
- **Web:** cabeceras de seguridad (anti-clickjacking `frame-ancestors 'none'`,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`); el botón "vs Bot" ya no
  aparece en producción; los **contadores sintéticos** de actividad ("N jugadores
  en línea/esperando" — datos de demo) **no se muestran en mainnet** (inventar
  actividad a gente que apuesta es engañarla); RPC propio configurable
  (`NEXT_PUBLIC_RPC_URL`) para no depender del público en producción.

### Verificación de esta ronda

`npm run check` completo (tipos web+server, lint, formato, 36 tests, selftest con
los casos nuevos) + `forge test` 9/9 + `check-integration.sh` (digest EIP-712) +
`check-payment-e2e.sh` (pago y empate reales en cadena local con el árbitro
modificado) + `next build` de producción. Todo en verde.

### Sigue pendiente (sin cambios en esta ronda)

- **Contrato sin cambios a propósito** (decisión sostenida: no tocar Solidity sin
  auditoría humana). La **auditoría externa profesional** sigue pendiente.
- **Llave del árbitro** en KMS/HSM y **owner multisig/hardware** — operacional.
- **Lo legal** (licencias/KYC/edad/geobloqueo) — decisión del dueño del proyecto.
- **Mono-instancia** (estado en disco local): para escalar horizontalmente hace
  falta un store compartido (Redis/DB).

Este documento es el resultado de revisar el **contrato** (`packages/contracts`),
el **backend árbitro** (`apps/server`) y la **arquitectura** completa. La idea es
ser honestos sobre lo que falta **antes de pensar en dinero real**.

---

## Actualización 2026-06-26 — segunda ronda (preparación mainnet)

Nueva pasada de revisión enfocada en el flujo de dinero. Resumen de lo encontrado
y resuelto en esta ronda (detalle en cada hallazgo más abajo):

### 🔴 CRÍTICO — RESUELTO: replay con **semilla ajena**

El árbitro re-jugaba el replay usando la semilla **que mandaba el cliente**, sin
compararla con la semilla real de la partida. Un jugador podía **ignorar la semilla
justa, probar muchas semillas offline y mandar una favorable** (con un puntaje alto
que "coincidía" al re-jugar esa misma semilla) → **ganaba con dinero real de forma
desleal**, y afectaba a los 6 juegos. **Arreglo:** `submitScore` ahora exige
`replay.seed === match.seed` y **fuerza la semilla real al re-jugar** (el árbitro
manda sobre el azar, nunca el cliente). Cubierto en `selftest` ("replay con semilla
ajena RECHAZADO").

### 🟠 Altos/medios — RESUELTOS

- **Un intento por jugador.** El puntaje se **congela en el primer envío válido**.
  Antes, el primero en enviar podía reintentar hasta sacar su mejor marca (ventaja
  desleal sobre el rival, que al enviar cierra la partida). Cubierto en `selftest`.
- **Guarda de configuración de producción** (`apps/server/src/config-guard.ts`). En
  producción **con escrow activo**, el servidor **no arranca** si falta `CHAIN_ID`,
  `ARBITER_PRIVATE_KEY` o `ALLOWED_ORIGIN`. Sin esto, `CHAIN_ID` caía por defecto en
  testnet (84532) y **las firmas del árbitro no servían para cobrar en mainnet**.
  Cubierto en `selftest`.
- **Anti-DoS de replay.** Re-jugar es O(ticks)/O(eventos): un replay chiquito con
  `ticks: 1e9` (que entra en el límite de 256 kb) obligaba a iterar mil millones de
  veces. Ahora se topa `ticks`/eventos **antes** de re-jugar (`replayTooLong`).
  Cubierto en `selftest`.
- **`trust proxy`.** `req.ip` usa `X-Forwarded-For` detrás de un reverse proxy, así
  el rate-limit no agrupa a todos los clientes bajo la IP del proxy.

### Pendientes de esta ronda (decisión de auditoría / operacional)

No se tocaron a propósito; cambiar el **contrato** (dinero real) sin auditoría
humana ni tests locales de Foundry sería un riesgo mayor que el que resuelven:

- **Pausa de emergencia acotada** en el contrato. Si se agrega, debe **pausar solo
  las ENTRADAS** (`open`/`join`) y **nunca las SALIDAS** (`settle`, `refund*`), para
  poder frenar nuevos depósitos sin atrapar fondos ya custodiados. Decidir e
  implementar **dentro de la auditoría humana** (con sus tests).
- **Timelock / multisig del owner** y **resguardo de la llave del árbitro**
  (KMS/HSM o firma múltiple). Son medidas **operacionales/de despliegue**, no código
  de este repo. Ver hallazgos 7 y 13.

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
   _replay_ y rechaza cualquier puntaje inventado — verificado en `selftest`
   (legítimo aceptado e inventado rechazado en los 6, + **juego desconocido
   rechazado**). _(Los juegos nuevos deben sumar su verificador al registro.)_
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
   corresponde rechazada). **Seguro por defecto:** en producción
   (`NODE_ENV=production`) la firma es **obligatoria** sin tener que recordar
   `REQUIRE_AUTH` (hay que poner `REQUIRE_AUTH=false` para desactivarla a
   propósito); en dev queda opcional para permitir invitados de prueba. Sin esto,
   alguien podría mandar un puntaje a nombre del rival para hacerlo perder.
   _(Pendiente menor: exigir firma también al emparejar — bajo impacto, cada
   jugador deposita por su cuenta.)_
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
8. **Un solo nodo (estado compartido en disco, no en memoria distribuida).** 🟡
   **Mitigado para una instancia:** el ranking ELO (`data/ratings.json`) **y las
   partidas** (`data/matches.json`) se guardan en disco con escritura atómica, así
   que **sobreviven a un reinicio** (un ganador puede recuperar su firma para
   cobrar; verificado simulando un reinicio). El rate-limit por IP sigue en
   memoria. Sigue siendo **mono-instancia**: con **más de una instancia** el
   emparejamiento, el rate-limit y el archivo de partidas se descoordinan. Para
   escalar a varias instancias hace falta un **store compartido** (Redis/DB).
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
11. **Semilla por `Math.random`.** ✅ **Endurecido (2026-06-26):** el árbitro ahora
    **exige y fuerza la semilla real de la partida** al re-jugar (antes aceptaba la
    semilla del cliente → ver el crítico de la 2ª ronda, arriba). Sirve para que sea
    igual para ambos jugadores. _Mejora futura:_ un esquema _commit-reveal_ sería aún
    más robusto contra la **predicción** de la semilla (`Math.random` es predecible).
12. **Empate dispara el reembolso on-chain.** ✅ **HECHO** — al detectar empate el
    árbitro llama `cancelMatch` y el contrato reembolsa a ambos (verificado e2e en
    cadena local).
13. **Poderes del dueño.** Mucha confianza concentrada. Considerar **timelock /
    multisig** para el owner.

### 🟢 Bajos

14. **Sin pausa de emergencia** en el contrato (es inmutable; bueno para la
    confianza, pero no hay "freno" si algo sale mal). **Recomendación para la
    auditoría:** una **pausa acotada** que frene solo las ENTRADAS (`open`/`join`) y
    **nunca** las SALIDAS (`settle`/`refund*`), para no atrapar fondos custodiados.
    No se agregó en la 2ª ronda para no expandir la superficie del contrato sin
    auditoría humana ni tests de Foundry (no instalado en el entorno de desarrollo).
15. **CORS** — ✅ **configurable** con `ALLOWED_ORIGIN` (en producción se
    restringe a tu dominio; en dev queda abierto).
16. **HTTPS obligatorio** en producción (en local es OK sin él).

---

## Checklist "antes de pensar en dinero real"

- [x] **Anti-trampa** (verificación por replay) — _crítico_ — hecho en los 6
      juegos (2048, Tetris, Flappy, Carrera, Snake, Space Invaders) con **default-deny**
      (un juego sin verificador se rechaza). Los juegos nuevos deben seguir el patrón.
- [x] **Replay atado a la semilla de la partida** (anti-trampa "semilla ajena") —
      _crítico_ — hecho (2ª ronda): el árbitro exige y **fuerza** la semilla real.
- [x] **Un intento por jugador · guarda de config de prod · anti-DoS de replay ·
      `trust proxy`** — _alto/medio_ — hechos (2ª ronda; ver actualización arriba).
- [x] **Conectar el flujo on-chain real** (depósito USDC `open`/`join` + `settle` +
      reembolso en empate y por vencimiento) — _crítico_ — implementado y verificado
      e2e en cadena local; falta el deploy a testnet/mainnet.
- [x] **Autenticación de jugadores** (firmar los envíos con la wallet) — _crítico_
      — hecho y **obligatorio por defecto en producción** (opt-out explícito con
      `REQUIRE_AUTH=false`)
- [ ] **Asesoría legal + licencias + KYC/AML + edad + geobloqueo** — _crítico (legal)_
- [ ] Quitar `/bot` y el fallback simulado de producción — _alto_
- [ ] Proteger la llave del árbitro (KMS/HSM, multisig) — _alto_
- [ ] Persistencia + recuperación del backend — _alto_
- [~] **Auditoría externa** del contrato — _alto_ — análisis estático (Slither)
  hecho y limpio (sin críticos/altos/medios); falta la auditoría humana profesional
- [ ] Rate limiting + HTTPS + monitoreo — _medio_
- [ ] Pruebas de extremo a extremo en testnet con varios usuarios reales — _medio_

> **Conclusión:** la base está sólida y el contrato es seguro en lo que cubre,
> pero **NO se debe activar dinero real** hasta cerrar al menos los 4 puntos
> críticos (con la parte legal a la cabeza).
