# Medición mínima (v4.1 · Frente 4) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Responder con datos "¿cuántos llegan, de dónde, y hasta dónde avanzan?": embudo de agentes en el árbitro (agentes creados por terceros; partidas de terceros vs. de la casa, separables gracias a la etiqueta CASA) + analytics web liviano (Vercel Analytics, sin cookies), todo legible en `/status`.

**Architecture:** Se extiende `stats.ts` (contadores persistidos con desglose diario, ya existente) con 3 contadores nuevos. La clasificación casa/mixta se decide en el settle de `matchmaking.ts` vía un checker inyectado desde `index.ts` (matchmaking NO puede importar agents.ts — ciclo). La web suma una sección "embudo" en `/status` (i18n ×4) y el componente `<Analytics/>` de Vercel en el layout.

**Tech Stack:** TypeScript, Express, node:test; Next 16, @vercel/analytics.

## Global Constraints

- Regla de la casa: métricas honestas y verificables — nada sintético.
- `stats.ts` solo importa `persist.js`; `matchmaking.ts` no puede importar `agents.js` (ciclo) → checker inyectado.
- i18n: paridad exacta de claves en los 4 idiomas (test lo exige).
- Tests: `npm test`; typecheck: `npm run typecheck`.
- Los contadores nuevos arrancan en 0 desde el deploy (medición hacia adelante; sin retroactividad inventada).

---

### Task 1: Server — contadores del embudo en stats.ts (TDD)

**Files:**

- Modify: `apps/server/src/stats.ts` (Counters, zeros, record\*)
- Test: `apps/server/test/funnel-stats.test.ts` (nuevo)

**Interfaces:**

- Produces: `Counters` suma `agentsCreated`, `settledHouse`, `settledMixed`; `recordAgentCreated(now?)`; `recordMatchSettled(houseSide?: 0 | 1 | 2, now?)` (retro-compatible: sin args cuenta como tercero puro).

- [ ] Test que falla → implementar → `node --import tsx --test apps/server/test/funnel-stats.test.ts` PASS → `npm test` PASS → commit `feat(server): contadores del embudo — agentes creados y partidas casa/mixta/terceros`.

```ts
// apps/server/test/funnel-stats.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  __resetStatsForTest,
  recordAgentCreated,
  recordMatchSettled,
  statsSnapshot,
} from "../src/stats.js";

test("embudo: agentes creados y partidas casa/mixta/terceros", () => {
  __resetStatsForTest(1_000);
  recordAgentCreated();
  recordMatchSettled(2); // casa vs casa
  recordMatchSettled(1); // tercero vs casa
  recordMatchSettled(0); // terceros puros
  recordMatchSettled(); // sin clasificar = tercero puro (retro-compat)
  const s = statsSnapshot(0);
  assert.equal(s.totals.agentsCreated, 1);
  assert.equal(s.totals.matchesSettled, 4);
  assert.equal(s.totals.settledHouse, 1);
  assert.equal(s.totals.settledMixed, 1);
  assert.equal(s.today.agentsCreated, 1);
});
```

Implementación en `stats.ts`: sumar los 3 campos a `Counters` y `zeros()`;

```ts
export function recordAgentCreated(now = Date.now()) {
  bump("agentsCreated", now);
}

/** `houseSide`: cuántos de los dos jugadores son agentes de la casa (0|1|2).
 *  2 = casa vs casa; 1 = un tercero jugó CONTRA la casa (señal de tracción);
 *  0/omitido = terceros puros. matchesSettled cuenta siempre. */
export function recordMatchSettled(houseSide: 0 | 1 | 2 = 0, now = Date.now()) {
  bump("matchesSettled", now);
  if (houseSide === 2) bump("settledHouse", now);
  else if (houseSide === 1) bump("settledMixed", now);
}
```

### Task 2: Server — clasificar el settle (checker inyectado) + agentes creados

**Files:**

- Modify: `apps/server/src/matchmaking.ts` (settle, línea ~462)
- Modify: `apps/server/src/agents.ts` (`createHostedAgent`)
- Modify: `apps/server/src/index.ts` (wiring)
- Test: ampliar `apps/server/test/funnel-stats.test.ts`

**Interfaces:**

- Produces: `setHouseAddressCheck(fn: (address: string) => boolean)` en matchmaking.

- [ ] En matchmaking: `let houseAddressCheck: (a: string) => boolean = () => false;` + export del setter; en el settle:

```ts
if (!m.isBot && m.p2 && m.outcome) {
  m.eloUpdate = applyElo(m.game, m.p1, m.p2, m.outcome);
  const houseSide = (houseAddressCheck(m.p1) ? 1 : 0) + (houseAddressCheck(m.p2) ? 1 : 0);
  recordMatchSettled(houseSide as 0 | 1 | 2);
}
```

- [ ] En agents.ts, `createHostedAgent` (tras `agents.set(...)`): `if (!isHouseWallet(owner)) recordAgentCreated();` (los 15 de la casa no son tracción). stats.ts solo importa persist → sin ciclo.
- [ ] En index.ts (junto al resto del wiring): `setHouseAddressCheck((a) => { const ag = hostedAgentByAddress(a); return !!ag && isHouseWallet(ag.owner); });`
- [ ] Test integrado (mismo archivo, patrón de agents.test.ts): crear 2 agentes de la casa (env HOUSE_WALLETS), `setHouseAddressCheck` como en index, correr `runAgentsTick` hasta que jueguen y verificar que `settledHouse` subió y `agentsCreated` no.
- [ ] `npm test` + `npm run typecheck:server` PASS → commit `feat(server): el settle distingue partidas de la casa, mixtas y de terceros`.

### Task 3: Web — sección embudo en /status + i18n ×4

**Files:**

- Modify: `apps/web/app/lib/arbiter.ts` (`StatsCounters`)
- Modify: `apps/web/app/status/StatusClient.tsx`
- Modify: `apps/web/app/lib/i18n/{es,en,fr,hi}.ts`

- [ ] `StatsCounters` suma `agentsCreated: number; settledHouse: number; settledMixed: number;`
- [ ] Claves nuevas ×4 (junto a las `status.*`): `status.funnel` (título), `status.agentsCreated`, `status.thirdMatches`, `status.vsHouse`, `status.houseOnly`, `status.funnelHint` (explica que CASA permite separar señal de ruido). ES:

```ts
  "status.funnel": "¿LLEGAN TERCEROS?",
  "status.agentsCreated": "Agentes creados (terceros)",
  "status.thirdMatches": "Partidas entre terceros",
  "status.vsHouse": "Terceros vs. la casa",
  "status.houseOnly": "Casa vs. casa",
  "status.funnelHint":
    "La etiqueta CASA separa la señal del ruido: la casa mantiene la arena viva, pero la tracción son los terceros.",
```

(EN/FR/HI: traducciones equivalentes; el test de paridad exige las mismas claves.)

- [ ] En StatusClient, después del bloque de contadores actual, una tarjeta `win` con `win-title` `{t("status.funnel")}` y 4 `<Stat/>` (mismo componente de la página): agentsCreated (sub: hoy), terceros puros = `matchesSettled - settledHouse - settledMixed` (derivado, con `Math.max(0, …)`), vs. casa (settledMixed), casa vs casa (settledHouse) + el hint.
- [ ] `node --import tsx --test apps/web/test/i18n.test.ts` + `npm run typecheck:web` PASS → commit `feat(web): /status responde si llegan terceros — embudo con la etiqueta CASA`.

### Task 4: Web — Vercel Analytics (páginas vistas + referrers, sin cookies)

**Files:**

- Modify: `apps/web/package.json` (dep `@vercel/analytics`)
- Modify: `apps/web/app/layout.tsx` (`<Analytics />`)
- Modify: `DEPLOY.md` (runbook: activar Web Analytics en el dashboard de Vercel)

- [ ] `npm install @vercel/analytics --workspace apps/web`
- [ ] En layout.tsx: `import { Analytics } from "@vercel/analytics/next";` y `<Analytics />` antes de cerrar el body.
- [ ] DEPLOY.md, sección nueva al final de operación: qué mide (páginas vistas y referrers, sin cookies), dónde se ve (dashboard de Vercel → Analytics) y que el dueño debe activar **Web Analytics** en el proyecto de Vercel (un click).
- [ ] `npm run typecheck:web` PASS → commit `feat(web): Vercel Analytics — páginas vistas y referrers sin cookies`.

### Task 5: Verificación local + cierre

- [ ] Server local (`npm run server`) + crear un agente de tercero vía API firmada + dejar jugar a los agentes CASA locales → `curl /stats` muestra `agentsCreated`, `settledHouse` subiendo y coherentes.
- [ ] Web local → `/es/status` muestra la sección "¿LLEGAN TERCEROS?" con números reales.
- [ ] `npm test` completo PASS. Checkpoint dueño: OK para push (+ click "Enable Web Analytics" en Vercel). Tras verificar en prod: changelog 3.2.0 + tick del frente 4 en ROADMAP.

## Self-review

- Spec cubierto: contadores de embudo con separación CASA ✓ (Tasks 1-2), analytics web liviano sin cookies ✓ (Task 4), resumen legible en un lugar (/status) ✓ (Task 3), "agentes creados por semana" → el desglose `daily` ya existente lo da (30 días) ✓.
- Sin ciclos de import: stats←persist; agents→stats; matchmaking→stats + checker inyectado desde index ✓.
- Tipos consistentes: `recordMatchSettled(houseSide?)` retro-compatible con el call de addBot/settle existente ✓.
