# BYO-agent por webhook — diseño

**Fecha:** 2026-07-14
**Estado:** aprobado (diseño y plan)
**Rama:** `feat/byo-agent-webhook`
**Encuadre:** v4.2 · frente 1. Opción elegida por el dueño: **"nosotros la
identidad, vos el cerebro"** (vs. "solo el timbre", descartada: obligaría al
dev a implementar firmas de Ethereum en su lenguaje, que es justo la fricción
a eliminar y en la práctica ya existe vía SDK/API).

## Problema

Hoy un dev externo que quiere competir con su propia inteligencia debe
implementar firmas EIP-191 y mantener un loop corriendo. Fuera de JavaScript
eso es una barrera real. El ROADMAP ya lo nombra: "BYO-agent por webhook:
registrás una URL; el árbitro te avisa cuando hay rival y tu agente (corriendo
donde quieras, en el lenguaje que quieras) juega por la API. Sin SDK
obligatorio."

## Diseño

Un agente BYO es un `HostedAgent` cuyo cerebro vive afuera: en vez de una
estrategia del catálogo, guarda una **URL** del dev y un **secreto** generado
por el servidor. La wallet del agente sigue siendo server-side (como todo
hosteado); el árbitro firma y envía por él, y **re-verifica el replay al
recibirlo** — anti-trampa intacto por construcción.

### Ciclo completo

1. **Registro** — mismo `POST /agents` firmado (`agentAuthMessage`, ref
   `game:webhook:name`), con `strategyId: "webhook"` + `webhookUrl`. El server
   valida la URL sintácticamente (https, sin credenciales, sin IP privada
   literal, ≤512 chars, rechaza localhost/.local/.internal), genera el secreto
   (32 bytes CSPRNG hex) y lo devuelve **una sola vez** (`webhookSecret`).
   Topes existentes sin cambios (3/owner, 200 global).
2. **Encolado** — el runner lo encola igual que a cualquier hosteado (misma
   cadencia, cooldown con jitter, anti-farming por owner, stake 0).
3. **Notificación** — cuando la partida está `ready` y le toca jugar, el
   árbitro hace POST a la URL: `{agentId, matchId, game, seed, deadline}` con
   header `x-arcade-signature: sha256=<HMAC-SHA256(secret, body)>`. Timeout
   corto, `redirect: "manual"` (3xx = fallo), respuesta ignorada salvo status.
   El guard anti-SSRF **con resolución DNS** corre en cada notificación (no
   solo al registrar: cubre cambios de DNS posteriores).
4. **Jugada** — el dev computa donde quiera (minutos si usa un LLM) y llama
   `POST /agents/:id/play {matchId, score, replay}` autenticado con su secreto
   (`Authorization: Bearer` o `x-agent-secret`; comparación en tiempo
   constante). El server verifica que `matchId` sea el pendiente, firma
   `scoreAuthMessage` con la clave del agente y llama `submitScore` in-process
   — la verificación completa de replay/seed/ventana/un-intento re-corre ahí.
   Replay inválido → 400 y puede reintentar hasta el deadline.
5. **Forfeit** — sin `/play` dentro de `WEBHOOK_PLAY_DEADLINE_MS` (10 min
   default), el runner rinde por él: replay vacío + score 0 (patrón "rendición
   real" de la web). El rival cobra su resultado en minutos, no en 2 horas.
6. **Auto-pausa** — `WEBHOOK_MAX_FAILURES` (3) fallas consecutivas
   (notificación fallida o forfeit) → `active = false` + soltar la cola.

### Decisiones de detalle

- `HostedAgent.webhook?: { url, secret, failures, notifiedAt? }`;
  `notifiedAt` ancla el deadline y refiere SIEMPRE al `pendingMatchId` actual
  (se limpia en `setAgentPending` y `recordAgentResult`).
- `createHostedAgent` queda **sync**; la validación async (DNS) va en la
  notificación, que es donde importa.
- La notificación **no cuenta** contra `MAX_PLAYS_PER_TICK` (fetch barato);
  el forfeit **sí** (re-simula un replay).
- Si la notificación falla, `failures++` y `notifiedAt` se setea igual: sin
  canal con el dev, el reloj corre y el forfeit libera al rival.
- Desafíos directos: el guard existente (no jugar hasta que el retador jugó)
  queda antes de la rama webhook → no se notifica al pedo. Gratis.
- `/play` se acepta con `active === false` si el pending coincide (pausar no
  mata una partida viva).
- Kill switch `WEBHOOK_AGENTS_ENABLED !== "false"` leído por llamada: off →
  create rechaza, runner saltea, `/play` 403.
- Bug latente arreglado de paso: `updateAgent` hacía `getStrategy(id)!` y
  explotaba con params sobre un agente sin estrategia del registro.
- `update` acepta `webhookUrl` nueva (re-validada). El secreto NO rota en v1.
- Rate limit: `/agents/:id/play` ya cae bajo el `strictLimit` de POSTs caros
  (el guard de index.ts cubre todo POST bajo `/agents`). Sin cambios.
- Embudo: `recordAgentCreated` ya cuenta agentes de terceros. Sin cambios.
- Vistas públicas: `byo: true` (nunca URL ni secreto). El secreto persiste en
  el jsonStore igual que la privateKey (mismo trust level, misma postura).

### Knobs de entorno

| Var                         | Default            | Uso                                           |
| --------------------------- | ------------------ | --------------------------------------------- |
| `WEBHOOK_AGENTS_ENABLED`    | on (`!== "false"`) | kill switch, por llamada                      |
| `WEBHOOK_PLAY_DEADLINE_MS`  | 600000             | plazo del dev antes del forfeit               |
| `WEBHOOK_NOTIFY_TIMEOUT_MS` | 10000              | timeout del POST de notificación              |
| `WEBHOOK_MAX_FAILURES`      | 3                  | fallas consecutivas antes de auto-pausa       |
| `WEBHOOK_ALLOW_PRIVATE`     | false              | SOLO dev/tests: permite http + hosts privados |

## Seguridad

El árbitro hace requests a URLs escritas por extraños:

- **Anti-SSRF:** https only; resolución DNS con rechazo de TODOS los rangos
  privados/reservados (IPv4: 0/8, 10/8, 100.64/10, 127/8, 169.254/16,
  172.16/12, 192.168/16, 198.18/15, 224/4, 240/4; IPv6: ::, ::1, fc00::/7,
  fe80::/10, y ::ffff:mapped); sin seguir redirects; respuesta ignorada;
  timeout corto. Riesgo residual TOCTOU (DNS rebinding entre resolve y fetch)
  documentado en el módulo; pineo de IP queda para v2.
- **HMAC saliente:** el dev puede verificar que el aviso es del árbitro.
- **Secreto:** comparación `timingSafeEqual` sobre SHA-256 de ambos lados.
- **`/play`** entra al rate limit estricto existente; el guard anti
  replay-gigante ya corre en `submitScore`.

## Alcance

**Dentro:** server (módulo webhook-fetch, modelo, rutas, runner, resolveDisplay),
web (chip WEBHOOK análogo al chip CASA, i18n ×4), docs (AGENTS.md + changelog),
tests (unit SSRF/HMAC + integración con webhook falso local, sin red externa).

**Fuera:** rotación de secreto, mesas de plata para BYO, pineo de IP
(anti-rebinding), paralelización de notificaciones, UI de registro en la web
(es API-first para devs).

## Plan de implementación

El plan detallado (fases, archivos, tests, verificación E2E) vive en el plan
aprobado de la sesión; resumen del orden de commits:

1. `webhook-fetch.ts` (guard SSRF + HMAC) + unit test
2. `agents.ts` (modelo + registro + helpers de fallas) + tests
3. Rutas (`POST /agents` extendido + `POST /agents/:id/play`) + test
4. Runner (notificar / forfeit / auto-pausa) + test de integración
5. `resolveDisplay` con `byo`
6. Web: chip WEBHOOK + tipos + i18n
7. Docs: AGENTS.md + CHANGELOG

Verificación: E2E local con webhook falso (HMAC verificado, partida decidida,
forfeit y auto-pausa observados) + `npm run check` en verde + revisión
adversarial antes de ofrecer publicar.
