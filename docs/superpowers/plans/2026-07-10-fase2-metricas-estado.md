# Fase 2 — Métricas y página de estado

> Plan de implementación. Estructura y criterios en
> [../v3/PLAN.md](../v3/PLAN.md) (Fase 2). Protocolo en
> [../v3/OPERATIVA.md](../v3/OPERATIVA.md).

**Objetivo**: uptime, partidas/día y errores de verificación visibles como
página pública de estado (`/status`), con datos reales del árbitro. Nada
sintético (regla de la casa).

## Decisiones de diseño (sin ambigüedad abierta)

- **Métricas elegidas** (todas reales y verificables):
  - `uptime` del proceso actual (`process.uptime()`): honesto = "prendido desde
    el último deploy". No se persiste (es por-proceso).
  - `matchesCreated`: total acumulado + hoy. Se incrementa al crear una partida
    en espera (una por partida; unirse no crea otra).
  - `matchesSettled`: total + hoy. Al decidirse una partida (ganador o empate),
    excluyendo las de bot de prueba (igual criterio que el ELO).
  - `verificationsRejected`: total + hoy. Envíos rechazados por el anti-trampa
    (replay ausente/largo, seed mismatch, score mismatch). NO cuenta fallos de
    firma ni "not a player" (esos no son verificación de replay).
  - `activeAgents`: conteo en vivo de agentes hosteados activos (no se persiste;
    se deriva al servir).
- **Acumulados persistidos** con `jsonStore("stats")` (mismo backend Redis/archivo
  que ratings/agents) → sobreviven redeploys. `daily` guarda por día UTC,
  podado a los últimos 30 días (evita crecer sin fin, como el resto del server).
- **`firstRecordedAt`**: marca desde cuándo acumulan los totales (para mostrar
  "desde …" sin mentir que son "de siempre").
- **Endpoint**: `GET /stats` público, bajo el rate-limit global existente.
- **Página `/status`**: client component que consume `/stats`, con tarjetas
  honestas (uptime, partidas hoy/total, rechazos, agentes activos) y un desglose
  simple de los últimos días. Link desde el footer.

## Tareas

- [ ] `apps/server/src/stats.ts`: contadores + `jsonStore("stats")` +
      `restoreStats()` + `statsSnapshot(activeAgents)`. Funciones `record*`
      aceptan `now` opcional (testeabilidad). Poda de `daily` a 30 días.
- [ ] `apps/server/test/stats.test.ts` (TDD): incrementos totales/hoy, rollover
      de día, poda a 30 días, forma del snapshot.
- [ ] Enganchar en `matchmaking.ts`:
  - `recordMatchCreated()` en `createWaiting`.
  - `recordMatchSettled()` en `settleIfReady` (solo `!isBot`, con outcome).
  - `recordVerificationRejected()` envolviendo el bloque anti-trampa de
    `submitScore` (try/catch que incrementa y re-lanza).
- [ ] `index.ts`: `GET /stats` (deriva `activeAgents` de `listAgents`) +
      `restoreStats()` en el `Promise.all` de arranque + entrada en la API
      auto-descriptiva (`GET /stats`).
- [ ] Web `lib/arbiter.ts`: `getStats(): Promise<StatsView>`.
- [ ] Web `app/status/page.tsx`: página honesta con las tarjetas.
- [ ] Footer: link a `/status`.
- [ ] i18n: textos de `/status` en en/es/hi/fr.
- [ ] Changelog 2.3.0 + verificación local E2E (server arriba, jugar partida,
      ver `/stats` y `/status` reflejar el movimiento y un rechazo provocado).

## Constraints

- Sin dependencias nuevas. `stats.ts` solo importa `persist.ts` (evita ciclo:
  `matchmaking → stats`; `activeAgents` se inyecta desde `index.ts`).
- Tests herméticos: `ARCADE_PERSIST` off ⇒ `save()` es no-op.
- No romper la forma de `/health` ni otros endpoints.
