# Benchmark en vivo, PR 3: el interruptor — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prender Flappy en vivo en producción (`RULES_V.flappy = 2`) y publicar los paquetes para que los agentes externos jueguen con el protocolo nuevo.

**Architecture:** No hay código nuevo del protocolo: todo está en los PR #28 (base), #30 (agentes y web) y #33 (traspaso entre instancias). Este PR:

- cambia la versión de reglas;
- adapta el selftest y los tests que suponían Flappy v1;
- documenta el cambio para quienes juegan con agentes.

La publicación en npm y en el registry del MCP la hace el dueño, o se hace con su OK, el mismo día del merge.

**Tech Stack:** TypeScript, `node:test` + tsx; npm workspaces (`scripts/publish-sdk.mjs`).

**Spec:** `docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md`, sección "Despliegue", punto 3.

## Precondiciones (NO empezar sin esto)

- [ ] #28, #30 y #33 mergeados en `main`, y también el arreglo del traspaso con timbre (rama `fix/traspaso-con-timbre`, spec `docs/superpowers/specs/2026-09-18-traspaso-con-timbre-design.md`). El #33 solo no alcanza: Render manda el SIGTERM a la instancia vieja 60 s después de pasarle el tráfico a la nueva, y su espera de 60 s vence siempre.
- [ ] El traspaso verificado en producción: en un deploy POSTERIOR al del timbre, los logs de Render muestran que la instancia nueva esperó a la vieja y recién después cargó el estado (`Árbitro listo: estado cargado`), sin `Traspaso: timeout`. Lo mira el dueño en el panel de Render.
- [ ] OK del dueño para publicar. La 0.4.0 ya se publicó el 2026-09-18 (Aleph con reglas v2), sin el benchmark: el benchmark sale como **0.5.0**.

## Global Constraints

- Comentarios en español, identificadores en inglés. Commits en español con prefijo y el trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- No correr nada contra producción sin OK del dueño. No tocar `.env`.
- El merge lo hace el dueño. **Al mergear se despliegan juntos árbitro y web**; los agentes con paquetes viejos reciben "rules version mismatch … update @arcade1v1 packages" hasta actualizar.

---

### Task 1: El interruptor y los tests que suponían v1

**Files:** `packages/game-sdk/src/rules.ts`; los tests que fallen.

- [ ] `flappy: 1` pasa a `flappy: 2`, con un comentario que apunte al spec.
- [ ] `node --import tsx --test "{packages,apps}/*/test/*.test.ts"` y arreglar lo que suponía v1. Lo que ya se sabe:
  - `apps/server/test/webhook-agents.test.ts`: `emptyReplay("flappy", 7)` ahora es `{ seed: 7, ticks: 0, flaps: [], v: 2 }` (con semilla, porque el test la pasa). En una partida en vivo real el runner la manda sin semilla.
  - Los tests en vivo que hacen `RULES_V.flappy = 2` quedan igual: ya es el valor por defecto, y el comentario "solo en este proceso" pasa a decir "ya es el valor por defecto".
  - Los tests que usan Flappy como juego "de siempre" (runner, desafíos, casa) ahora juegan en vivo: tienen que pasar por los caminos del PR 2a. Si alguno supone la semilla en la vista, pasarlo a 2048 o adaptarlo.
- [ ] Commit `feat(game-sdk): Flappy se juega en vivo (reglas v2)`.

### Task 2: El selftest de Flappy, en vivo

**Files:** `apps/server/src/selftest.ts`.

- [ ] Sacar Flappy de la tabla de "replay aceptado / inventado rechazado", que es de juegos con semilla.
- [ ] Sumar un bloque en vivo:
  - emparejar dos jugadores;
  - jugar los dos intentos en proceso con `liveStart` + `playFlappyLive` (la estrategia por defecto);
  - verificar que se decide;
  - verificar que el puntaje de cada uno re-verifica con `verifyFlappyLive(secret, replay)`;
  - verificar que `liveSecretHash(secret) === secretHash`;
  - verificar que un replay armado afuera se rechaza con `replay not allowed`.
- [ ] `npm run selftest` → `TODO OK ✅`. Commit `test(server): el selftest juega Flappy en vivo`.

### Task 3: Documentación para quienes juegan con agentes

**Files:** `CHANGELOG.md` ("Sin publicar"), `AGENTS.md`, `README.md`, `apps/mcp/README.md`, `packages/agent-sdk/README.md`, `docs/` (lo que describa el webhook BYO y la API del 1v1), `llms.txt` si existe.

- [ ] **CHANGELOG**, sección "⚠️ ruptura: Flappy se juega en vivo (reglas v2)", en simple:
  - por qué: la semilla anticipada dejaba simular la partida entera;
  - qué cambia para un agente:
    - sin semilla;
    - `playAndSubmit` ya lo hace solo;
    - quien use su propia estrategia pasa `liveStrategy`, o usa `liveStart`/`liveCommit` y `playFlappyLive`;
  - qué cambia para un BYO por webhook:
    - la notificación trae `live: true` y `secretHash`, sin semilla;
    - `/agents/:id/live/start` y `/live/commit`;
    - el plazo corre hasta terminar el intento;
  - cómo se re-verifica: `secret` al decidirse y `verifyFlappyLive`;
  - lo que `playAndSubmit` hace solo: reintenta lo pasajero (red, 429, 5xx), retoma un intento cortado (hasta 2 veces), valida la llamada antes de emparejar y avisa si una partida decidida no publica su secreto.
- [ ] En las guías de API y de agentes: los endpoints en vivo con ejemplos; el hash del secreto al emparejar y el secreto al decidir; el límite de 60 compromisos cada 10 s.
- [ ] Commit `docs: Flappy en vivo para quienes juegan con agentes`.

### Task 4: Versiones y verificación

- [ ] Subir a 0.5.0 los 4 paquetes (`game-sdk`, `strategies`, `agent-sdk`, `mcp`), con las dependencias internas entre ellos (`^0.5.0`) y `server.json` del MCP si tiene versión.
- [ ] `npx prettier --write . && npm run check` en verde.
- [ ] Prueba manual de la web contra árbitro y web locales, **ya con `RULES_V.flappy = 2` commiteado**:
  - jugar, cerrar y ver el resultado;
  - retomar al recargar;
  - rendirse;
  - un agente de la casa contra la web.
- [ ] Push y PR contra `main`. El cuerpo explica la ruptura y lo que hay que hacer el día del merge.

### Task 5: El día del merge (con el dueño)

- [ ] El dueño mergea: se despliegan el árbitro (Render) y la web (Vercel).
- [ ] Con OK del dueño:
  - publicar los paquetes (`npm run release` en cada uno, o el flujo de `scripts/publish-sdk.mjs`) y el MCP en el registry. Trampas de la 0.4.0: publicar de a uno; npm puede dejar el MCP "staged" esperando aprobación (`npm stage approve`, con npm 11.19.1: `npm@latest` es la 12 y no es compatible); `mcp-publisher` se instala con brew;
  - un smoke contra producción: el SDK publicado juega una partida de Flappy en la ladder gratis y el resultado re-verifica con el secreto.
- [ ] Anotar en la memoria del proyecto: fecha, versión publicada y resultado del smoke.
