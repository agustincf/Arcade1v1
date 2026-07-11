# Fase 4 — Duelos directos (diseño)

> Spec de diseño de la Fase 4 del milestone v3. Estructura y criterios en
> [../v3/PLAN.md](../v3/PLAN.md) (Fase 4). Protocolo en
> [../v3/OPERATIVA.md](../v3/OPERATIVA.md). Aprobada por el dueño el 2026-07-10.

## Objetivo

Poder desafiar a un **rival puntual** en vez de solo la cola por orden de
llegada. Alcance decidido en el brainstorm: **solo ladder gratis** (stake 0, sin
escrow ni plata), y el rival es **siempre un agente hosteado** (juega solo vía el
runner, así la partida se resuelve seguro). Dos formas:

1. **Humano → agente**: elegís un agente y jugás vos mismo contra él en el
   navegador (benchmark propio).
2. **Agente → agente**: uno de tus agentes desafía a otro (el de un amigo); ambos
   juegan solos.

**Fuera de alcance (YAGNI):** duelos con plata/escrow (fase futura), desafiar a
un humano (poco confiable: podría no aparecer), exposición en el MCP (opcional,
anotado para después).

## Modelo: la "partida-desafío"

Un desafío es una partida gratis (stake 0) con un campo nuevo `target` (address
del agente desafiado, en minúsculas). Diferencias con una partida normal:

- **No entra en la cola general** (`queue`): nadie más la puede tomar. El
  `matchmake` normal nunca la encuentra (solo mira `queue`).
- **Solo el `target` la acepta**: al aceptar se exige que quien entra sea el
  `target` (verificado); un tercero es rechazado → cumple "nadie roba el
  desafío".
- **Expira**: TTL propio `CHALLENGE_TTL` (30 min, configurable). El barrendero
  que ya limpia partidas en espera vencidas la descarta (sin fondos que liberar,
  al ser gratis) → cumple "si no se acepta, expira".

El campo `target?` es opcional en `Match` → se serializa con el resto (persiste)
y no rompe el formato existente.

## Servidor

### matchmaking.ts

- `Match` suma `target?: string`.
- `CHALLENGE_TTL = Number(process.env.CHALLENGE_TTL_MS ?? 30*60_000)`.
- `createChallenge(game, challenger, target)`: valida juego conocido; crea la
  partida `p1=challenger`, `target`, `seed`, `stake=0`, `status="waiting"`,
  **sin** meterla en `queue`. Devuelve la vista. (La auth va en la capa de rutas.)
- `acceptChallenge(matchId, joiner)`: la partida existe, es desafío (`target`
  seteado), `status==="waiting"`, sin `p2`; `joiner===target` (si no,
  `"not the challenged rival"`) y `joiner!==p1`. Setea `p2=joiner`,
  `status="ready"`, persiste. Devuelve la vista. Es **in-process** (no hay ruta
  HTTP de accept): como el target es siempre un agente, solo lo llama su runner;
  la propiedad "solo el target acepta" la garantiza el `joiner===target` con la
  address del propio agente. No necesita firma (nadie externo lo invoca).
- `pendingChallengesFor(address): Match[]`: desafíos en espera (`target===address`,
  sin `p2`, no vencidos) — lo usa el runner para descubrir sus desafíos.
- Barrendero (`sweepMatches`): para partidas `!p2` con `target`, usar
  `CHALLENGE_TTL` en vez de `WAIT_TTL`.
- Reusa lo existente: `settleIfReady` (aplica ELO al liquidarse, no-bot), `view`
  (oculta el puntaje del rival hasta decidir), la persistencia y el barrendero.

### game-sdk/auth.ts

- `challengeAuthMessage(challenger, target, ts)`: mensaje que firma un **humano**
  para desafiar (ata challenger + target + ts). Para agente→agente NO se usa
  este: se reusa `agentAuthMessage("challenge", agentId, owner, ts)` (el dueño
  firma sobre su agente, como el resto de la administración).

### challenge-routes.ts (nuevo)

`POST /challenge` — un solo endpoint que ramifica:

- **Humano → agente**: `{ challenger, target, game, signature, ts }`. Verifica
  `challengeAuthMessage(challenger, target, ts)` firmado por `challenger`.
  `target` debe ser un **agente hosteado activo**; `game` = el juego del agente.
- **Agente → agente**: `{ byAgentId, target, signature, ts }`. Verifica
  `agentAuthMessage("challenge", byAgentId, owner, ts)` firmado por el dueño del
  agente `byAgentId`. `challenger` = address del agente `byAgentId`; `game` = su
  juego. Se setea `pendingMatchId` del agente desafiante (para que su runner
  juegue el intento). **Anti-farming**: rechazar si `byAgent.owner ===
targetAgent.owner` (no desafiar tu propio agente con otro tuyo).

Ambos casos: `target` debe ser agente activo y del **mismo juego** que el
challenger; si no, 400. Pasa por `strictLimit` (recupera una firma), como
`POST /agents`. Devuelve `{ matchId, seed, ... }` (la vista de la partida creada).

(No hace falta ruta HTTP de "accept" ni de "pendientes": el target siempre es un
agente y su runner descubre y acepta con la función in-process
`pendingChallengesFor`.)

### agent-runner.ts

En `runAgentsTick`, por cada agente activo, ANTES del cooldown normal:

- Si tiene `pendingMatchId` → `playPendingMatch` (ya existe; cubre el lado
  challenger de agente→agente y cualquier desafío ya aceptado).
- Si NO tiene pendiente → primero mirar `pendingChallengesFor(agent.address)`; si
  hay uno, `acceptChallenge(matchId, agent.address)` (in-process) y
  `setAgentPending(agent, matchId)`. Se juega en el mismo tick o el siguiente
  (cuando `status==="ready"`, con su intento firmado por la clave del agente,
  igual que hoy).
- Recién si no hay desafíos ni pendiente, el laddering aleatorio de siempre.

Los desafíos tienen **prioridad** sobre la cola aleatoria. Un agente juega de a
una partida (un solo `pendingMatchId`).

## Web

### Descubrir y desafiar (página del agente)

`apps/web/app/my-agents/[agentId]/page.tsx` es pública. Para un **visitante que
no es el dueño** y con wallet conectada, se agrega un botón **"Desafiar"** →
`ChallengeButton` (componente nuevo) que ofrece:

- **"Juego yo"** (humano→agente): firma `challengeAuthMessage`, hace
  `POST /challenge`, y navega a `/game/[game]/match?challenge=<matchId>` para
  jugar el intento.
- **"Con mi agente"** (agente→agente): selector de tus agentes **del mismo juego
  que el target**. Firma `agentAuthMessage("challenge", tuAgente, owner, ts)`,
  `POST /challenge` con `byAgentId`, y muestra "desafío enviado" (ambos juegan
  solos). Si el target fuera tuyo, el server lo rechaza (anti-farming); en la
  práctica desafiás al agente de otro.

Una sola acción primaria por zona (regla de la casa): "Desafiar" es la primaria
de la zona del visitante; las de administración (pausar/borrar) solo le aparecen
al dueño.

### Llegar a la página del agente (ranking clickeable)

Hoy no hay forma pública de navegar a la página de otro agente. Se agrega:

- `resolveDisplay` (server, profiles.ts) incluye `agentId?` cuando la address es
  un agente hosteado (además de name/avatar).
- El **ranking** (`leaderboard/page.tsx`) linkea la fila a
  `/my-agents/[agentId]` cuando `row.agentId` está presente. Los tipos del
  cliente (`LeaderRow`) suman `agentId?`.

### Jugar el desafío (humano)

`apps/web/app/game/[gameId]/match/page.tsx` suma un modo desafío: si hay
`?challenge=<matchId>` en la URL, en vez de emparejar, carga la partida existente
(`getMatch(matchId, address)` → `seed`, `role`) y sigue el MISMO camino que la
ladder gratis rankeada (jugar el intento + enviar puntaje firmado + resultado).
Es una partida gratis: reusa toda la lógica de `rankedFree` (wallet + firma, sin
depósito). El rival (agente) juega solo vía runner.

### Cliente arbiter.ts

- `createChallenge(input): Promise<MatchView>` (humano→agente y agente→agente,
  según los campos).
- `getMatch` ya existe (se reusa para el modo desafío del match page).

## Anti-abuso / honestidad

- **Anti-farming**: agente→agente del **mismo dueño** rechazado (server). Humano
  vs cualquier agente (incluso propio) permitido: el humano juega de verdad cada
  intento, no es el farm de dos bots automáticos.
- **Firmas**: crear un desafío va firmado (humano: su wallet; agente→agente: el
  dueño sobre su agente), con `ts` anti-replay (TTL 10 min).
- **Solo el target acepta**: `acceptChallenge` exige `joiner===target`.
- Sin plata: un desafío vencido solo se descarta (nada que reembolsar).

## Testing

**TDD (server, hermético):**

- `createChallenge` no entra en la cola; `matchmake` normal no la toca.
- `acceptChallenge`: el target acepta (ready); un tercero es rechazado; el propio
  challenger no se auto-acepta.
- `pendingChallengesFor` lista solo los dirigidos y no vencidos.
- Anti-farming: agente→agente del mismo dueño rechazado (test de rutas).
- Firma: humano válida acepta, ajena rechaza; agente→agente con firma del dueño
  acepta, de un tercero rechaza (test de `challenge-routes` como
  `agents-routes.test.ts`).
- Runner: un agente objetivo acepta y juega un desafío dirigido; agente→agente
  entre dos dueños distintos se liquida solo (extensión de `agents.test.ts`).

**E2E real local:** por HTTP, crear un desafío humano→agente firmado, ver que el
runner del agente lo acepta y la partida se liquida con ELO; y agente→agente
entre dos dueños. Verificación web: botón "Desafiar" en la página del agente,
jugar el intento, ver el resultado.

## Archivos

Nuevos:

- `apps/server/src/challenge-routes.ts`
- `apps/server/test/challenge.test.ts`, `apps/server/test/challenge-routes.test.ts`
- `apps/web/app/my-agents/ChallengeButton.tsx`

Modificados:

- `packages/game-sdk/src/auth.ts` — `challengeAuthMessage`
- `apps/server/src/matchmaking.ts` — `target`, `createChallenge`,
  `acceptChallenge`, `pendingChallengesFor`, TTL en el barrendero
- `apps/server/src/agent-runner.ts` — aceptar/priorizar desafíos
- `apps/server/src/profiles.ts` — `resolveDisplay` suma `agentId?`
- `apps/server/src/index.ts` — montar `challenge-routes` (+ enriquecer
  leaderboard con `agentId` ya lo hace resolveDisplay)
- `apps/web/app/lib/arbiter.ts` — `createChallenge` + `agentId?` en `LeaderRow`
- `apps/web/app/my-agents/[agentId]/page.tsx` — botón "Desafiar"
- `apps/web/app/leaderboard/page.tsx` — filas de agente clickeables
- `apps/web/app/game/[gameId]/match/page.tsx` — modo `?challenge=`
- `apps/web/app/lib/i18n-dict.ts` — textos ×4
