# Agentes de la casa (v4.1 · Frente 1) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poblar la ladder con 15 agentes hosteados propios (2-3 por juego, perillas variadas), dueños de una wallet de la casa exenta del tope por owner, con etiqueta "CASA" visible en ranking, página del agente, historial y espectador — y un keep-alive para que Render no duerma.

**Architecture:** No se construye un sistema nuevo: los agentes de la casa son agentes hosteados normales (el `agent-runner.ts` ya los hace jugar solos en la ladder gratis). Lo nuevo es (1) `HOUSE_WALLETS` en el server: exención del tope por owner + campo `house: true` derivado en las vistas públicas (`toView` y `resolveDisplay`, que ya alimentan ranking, partidas, replays e historial); (2) un chip "CASA" en la web (4 idiomas); (3) un script de siembra idempotente que firma con la wallet de la casa contra la API existente; (4) un cron de GitHub Actions que pinguea al árbitro.

**Tech Stack:** TypeScript, Express (apps/server), Next 16 (apps/web), viem (firmas), node:test + tsx (tests), GitHub Actions (keep-alive).

## Global Constraints

- Tests: `npm test` (corre `node --import tsx --test "{packages,apps}/*/test/*.test.ts"` desde la raíz). Typecheck: `npm run typecheck`.
- NO subir `MAX_AGENTS_TOTAL` (200) ni `MAX_AGENTS_PER_OWNER` (3): la exención es SOLO para wallets listadas en `HOUSE_WALLETS`.
- i18n: los 4 idiomas (`en`, `es`, `fr`, `hi`) deben exponer EXACTAMENTE las mismas claves — `apps/web/test/i18n.test.ts` lo exige.
- Nombres de agentes: máx. 24 caracteres (los valida `sanitizeName`); avatares solo de `AGENT_AVATARS` (allowlist).
- Next 16: el middleware se llama `proxy.ts` — NO crear `middleware.ts`.
- La clave privada de la wallet de la casa NUNCA se commitea (el repo es público): vive en `.house-wallet.json`, que se agrega a `.gitignore`.
- Nada se ejecuta contra producción sin OK del dueño (sección "Cierre en producción").
- Commits en español con el estilo del repo: `feat(server): …`, `feat(web): …`, `docs: …`.

---

### Task 1: Server — `HOUSE_WALLETS`: exención del tope + campo `house` en las vistas públicas

**Files:**
- Modify: `apps/server/src/agents.ts` (tope en `createHostedAgent:139-143`, `AgentView:56-70`, `toView:106-122`)
- Modify: `apps/server/src/profiles.ts` (`resolveDisplay:62-73`)
- Test: `apps/server/test/house-agents.test.ts` (nuevo)

**Interfaces:**
- Consumes: `createHostedAgent`, `toView`, `deleteAgent` (existentes en `agents.ts`); `resolveDisplay` (existente en `profiles.ts`).
- Produces: `isHouseWallet(address: string): boolean` (export de `agents.ts`); `AgentView.house?: boolean`; `resolveDisplay` devuelve `{ name?, avatar?, agentId?, house?: boolean }`. Las Tasks 2-3 dependen de que el JSON de la API incluya `house: true` solo para agentes de la casa.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/server/test/house-agents.test.ts` con exactamente este contenido:

```ts
// Agentes de la casa (v4.1 Frente 1): las wallets listadas en HOUSE_WALLETS
// quedan exentas del tope por owner, y sus agentes llevan house:true en las
// vistas públicas (toView y resolveDisplay). Derivado de config del server:
// un tercero no puede marcarse "CASA" a sí mismo.
//
// Correr: node --import tsx --test apps/server/test/house-agents.test.ts

import "../src/offline-env.js"; // corre offline con clave de prueba (ver el módulo)
import { test, after } from "node:test";
import assert from "node:assert/strict";

import {
  createHostedAgent,
  deleteAgent,
  toView,
  isHouseWallet,
  MAX_AGENTS_PER_OWNER,
} from "../src/agents.js";
import { resolveDisplay } from "../src/profiles.js";

// Dueños únicos por corrida: el store persiste en disco entre corridas locales.
const suffix = Date.now().toString(16).slice(-10);
const HOUSE = "0x" + ("caa" + suffix).padStart(40, "0");
const OTHER = "0x" + ("bbb" + suffix).padStart(40, "0");

// Con mayúsculas y espacios a propósito: el parser tiene que normalizar.
process.env.HOUSE_WALLETS = ` ${HOUSE.toUpperCase()} , 0x${"f".repeat(40)} `;

const created: string[] = [];
function make(owner: string, name: string) {
  const a = createHostedAgent({
    owner,
    name,
    avatar: "👾",
    game: "2048",
    strategyId: "2048.priority",
    params: {},
  });
  created.push(a.id);
  return a;
}

after(() => {
  for (const id of created) {
    try {
      deleteAgent(id);
    } catch {
      /* ya borrado en el test */
    }
  }
});

test("isHouseWallet: normaliza mayúsculas y espacios del env", () => {
  assert.equal(isHouseWallet(HOUSE), true);
  assert.equal(isHouseWallet(HOUSE.toUpperCase()), true);
  assert.equal(isHouseWallet(OTHER), false);
  assert.equal(isHouseWallet(""), false);
});

test("la casa queda exenta del tope por owner; un dueño común sigue topado", () => {
  for (let i = 0; i < MAX_AGENTS_PER_OWNER + 1; i++) make(HOUSE, `Casa ${i}`);
  // La casa pasó el tope sin error. Un dueño común sigue topado:
  for (let i = 0; i < MAX_AGENTS_PER_OWNER - 1; i++) make(OTHER, `Bot ${i}`);
  const ultimo = make(OTHER, "Bot lleno"); // 3er agente: todavía entra
  assert.throws(() => make(OTHER, "Bot extra"), /max .* agents per owner/);
  deleteAgent(ultimo.id); // libera un lugar para el test siguiente
});

test("toView marca house:true solo para agentes de la casa", () => {
  const casa = make(HOUSE, "Etiquetado Casa");
  const ajeno = make(OTHER, "Etiquetado Ajeno");
  assert.equal(toView(casa).house, true);
  assert.equal(toView(ajeno).house, undefined);
});

test("resolveDisplay propaga house:true (ranking, replays e historial lo heredan)", () => {
  const agente = make(HOUSE, "Display Casa");
  const d = resolveDisplay(agente.address);
  assert.equal(d.name, "Display Casa");
  assert.equal(d.house, true);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --import tsx --test apps/server/test/house-agents.test.ts`
Expected: FAIL — `isHouseWallet` no existe (error de import).

- [ ] **Step 3: Implementar en `agents.ts`**

En `apps/server/src/agents.ts`, después de la línea 19 (`MAX_AGENTS_TOTAL`), agregar:

```ts
// Wallets de la casa (v4.1): dueñas de los agentes "CASA" que mantienen la
// arena viva. Exentas del tope POR OWNER (no del global, que sigue protegiendo
// contra abuso). Se relee el env por llamada (con cache por valor) para que
// los tests puedan variarlo sin reimportar el módulo.
let houseCache: { raw: string; set: Set<string> } | undefined;
export function isHouseWallet(address: string): boolean {
  const raw = process.env.HOUSE_WALLETS ?? "";
  if (!houseCache || houseCache.raw !== raw) {
    const set = new Set(
      raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
    houseCache = { raw, set };
  }
  return houseCache.set.has(String(address).toLowerCase());
}
```

En `AgentView` (línea ~69, después de `stats`), agregar:

```ts
  rating: number;
  /** true solo para agentes cuyo owner está en HOUSE_WALLETS (etiqueta CASA). */
  house?: boolean;
```

En `toView` (línea ~120, después de `rating`), agregar:

```ts
    rating: getRating(normAddr(a.address), a.game),
    ...(isHouseWallet(a.owner) ? { house: true } : {}),
```

En `createHostedAgent`, reemplazar el bloque del tope (líneas 140-143):

```ts
  const mine = [...agents.values()].filter((a) => a.owner === owner);
  if (mine.length >= MAX_AGENTS_PER_OWNER) {
    throw new Error(`max ${MAX_AGENTS_PER_OWNER} agents per owner`);
  }
```

por:

```ts
  // Las wallets de la casa (HOUSE_WALLETS) no tienen tope por owner: son
  // nuestras y pueblan los 6 juegos. El tope global de arriba sí les aplica.
  if (!isHouseWallet(owner)) {
    const mine = [...agents.values()].filter((a) => a.owner === owner);
    if (mine.length >= MAX_AGENTS_PER_OWNER) {
      throw new Error(`max ${MAX_AGENTS_PER_OWNER} agents per owner`);
    }
  }
```

- [ ] **Step 4: Implementar en `profiles.ts`**

En `apps/server/src/profiles.ts`, línea 12, sumar `isHouseWallet` al import:

```ts
import { hostedAgentByAddress, sanitizeName, AGENT_AVATARS, isHouseWallet } from "./agents.js";
```

Y en `resolveDisplay` (líneas 62-73), reemplazar la firma y la rama del agente:

```ts
export function resolveDisplay(address: string): {
  name?: string;
  avatar?: string;
  agentId?: string;
  house?: boolean;
} {
  const a = normAddr(address);
  const agent = hostedAgentByAddress(a);
  if (agent) {
    return {
      name: agent.name,
      avatar: agent.avatar,
      agentId: agent.id,
      ...(isHouseWallet(agent.owner) ? { house: true } : {}),
    };
  }
  const p = profiles.get(a);
  if (p) return { name: p.name, avatar: p.avatar };
  return {};
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `node --import tsx --test apps/server/test/house-agents.test.ts`
Expected: PASS (4 tests).

Run: `npm test` y `npm run typecheck:server`
Expected: PASS todo (los tests existentes de agentes no cambian de conducta: ningún owner de esos tests está en HOUSE_WALLETS).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/agents.ts apps/server/src/profiles.ts apps/server/test/house-agents.test.ts
git commit -m "feat(server): wallets de la casa — exención del tope por owner y campo house en las vistas públicas"
```

---

### Task 2: Web — chip CASA: tipos, componente, dicts (4 idiomas) y ranking

**Files:**
- Modify: `apps/web/app/lib/arbiter.ts` (interfaces `LeaderRow:70`, `AgentView:101`, `AgentMatchSummary:117`, `RecentMatch:179`, `PublicReplay:189`)
- Create: `apps/web/app/components/HouseChip.tsx`
- Modify: `apps/web/app/lib/i18n/es.ts`, `en.ts`, `fr.ts`, `hi.ts` (2 claves nuevas cada uno)
- Modify: `apps/web/app/leaderboard/page.tsx` (fila del ranking, líneas 86-110)

**Interfaces:**
- Consumes: `house?: boolean` que el server ya devuelve en leaderboard/agents/matches (Task 1); clase CSS `.chip` existente en `globals.css`; `useT()` de `@/app/lib/i18n`.
- Produces: componente `HouseChip()` (sin props, usa `t("chip.house")` y tooltip `t("chip.houseTip")`); claves de dict `chip.house` y `chip.houseTip`; campos `house?: boolean` en los tipos del cliente que la Task 3 también usa.

- [ ] **Step 1: Agregar `house?: boolean` a los tipos del cliente**

En `apps/web/app/lib/arbiter.ts`:

`LeaderRow` (línea 70):

```ts
export interface LeaderRow {
  address: string;
  rating: number;
  name?: string;
  avatar?: string;
  agentId?: string;
  house?: boolean;
}
```

`AgentView` (línea 101): agregar al final, después de `rating: number;`:

```ts
  rating: number;
  house?: boolean;
```

`AgentMatchSummary` (línea 117): después de `avatar?: string;`:

```ts
  name?: string;
  avatar?: string;
  house?: boolean;
```

`RecentMatch` (línea ~179) y `PublicReplay` (línea ~189): en el tipo inline de `players`, sumar `house?: boolean`:

```ts
  players: { address: string; score?: number; name?: string; avatar?: string; house?: boolean }[];
```

(y en `PublicReplay`, el equivalente con `replay?: unknown`).

- [ ] **Step 2: Claves i18n en los 4 idiomas**

Insertar en cada dict, junto a las claves `lb.*` (después de `"lb.you"`):

`apps/web/app/lib/i18n/es.ts`:

```ts
  "chip.house": "CASA",
  "chip.houseTip":
    "Agente de la casa: lo corre Arcade1v1 para que la arena nunca esté vacía. Partidas y ELO reales.",
```

`apps/web/app/lib/i18n/en.ts`:

```ts
  "chip.house": "HOUSE",
  "chip.houseTip":
    "House agent: run by Arcade1v1 so the arena is never empty. Real matches, real ELO.",
```

`apps/web/app/lib/i18n/fr.ts`:

```ts
  "chip.house": "MAISON",
  "chip.houseTip":
    "Agent maison : géré par Arcade1v1 pour que l'arène ne soit jamais vide. Parties et ELO réels.",
```

`apps/web/app/lib/i18n/hi.ts`:

```ts
  "chip.house": "हाउस",
  "chip.houseTip":
    "हाउस एजेंट: इसे Arcade1v1 चलाता है ताकि एरिना कभी खाली न रहे। असली मैच, असली ELO।",
```

- [ ] **Step 3: Correr el test de paridad i18n**

Run: `node --import tsx --test apps/web/test/i18n.test.ts`
Expected: PASS (si falta la clave en un idioma, este test lo denuncia).

- [ ] **Step 4: Crear el componente `HouseChip`**

Crear `apps/web/app/components/HouseChip.tsx`:

```tsx
"use client";

// Chip "CASA": marca los agentes hosteados por Arcade1v1 (owner en
// HOUSE_WALLETS del server). Identidad honesta: partidas y ELO reales,
// pero que se sepa quién es de la casa. El tooltip explica el porqué.

import { useT } from "@/app/lib/i18n";

export function HouseChip() {
  const { t } = useT();
  return (
    <span className="chip !text-(--color-accent-2)" title={t("chip.houseTip")}>
      {t("chip.house")}
    </span>
  );
}
```

- [ ] **Step 5: Chip en el ranking**

En `apps/web/app/leaderboard/page.tsx`:

Import (junto a los demás, línea ~10):

```tsx
import { HouseChip } from "@/app/components/HouseChip";
```

En la fila (líneas 86-110), después del bloque del nombre y ANTES del `{mine && …}`, dentro del `<span className="font-mono …">`:

```tsx
                        {row.house && (
                          <span className="ml-2 align-middle">
                            <HouseChip />
                          </span>
                        )}
                        {mine && (
```

- [ ] **Step 6: Verificar typecheck**

Run: `npm run typecheck:web`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/lib/arbiter.ts apps/web/app/components/HouseChip.tsx apps/web/app/lib/i18n/es.ts apps/web/app/lib/i18n/en.ts apps/web/app/lib/i18n/fr.ts apps/web/app/lib/i18n/hi.ts apps/web/app/leaderboard/page.tsx
git commit -m "feat(web): chip CASA en el ranking — tipos, componente y textos en 4 idiomas"
```

---

### Task 3: Web — etiqueta CASA en espectador, página del agente e historial

**Files:**
- Modify: `apps/web/app/lib/wallet.tsx` (`playerLabel:45-47`)
- Modify: `apps/web/app/watch/page.tsx` (líneas 79-83)
- Modify: `apps/web/app/watch/[matchId]/page.tsx` (líneas 71-73)
- Modify: `apps/web/app/my-agents/[agentId]/page.tsx` (cabecera línea ~118-125 e historial línea ~227)

**Interfaces:**
- Consumes: `HouseChip` (Task 2), claves `chip.house`/`chip.houseTip` (Task 2), campos `house?: boolean` de los tipos (Task 2).
- Produces: `playerLabel(address: string, name?: string, avatar?: string, tag?: string): string` — 4to parámetro opcional; si viene, se agrega ` · ${tag}` al final. Compatible con todos los llamadores existentes (parámetro opcional).

- [ ] **Step 1: Extender `playerLabel` con un tag opcional**

En `apps/web/app/lib/wallet.tsx`, reemplazar la función (líneas 45-47):

```tsx
/** Etiqueta de identidad de un jugador para mostrar. ANTI-SUPLANTACIÓN (regla
 *  de la casa): el nombre NUNCA reemplaza la identidad — si hay perfil se
 *  muestra "avatar nombre · 0x1234…abcd", con el address corto SIEMPRE al lado
 *  (los nombres no son únicos). Sin nombre, solo el address corto. El `tag`
 *  opcional (p. ej. "CASA" traducido) se agrega al final en contextos donde
 *  el label es un string plano y no entra un chip estilado. */
export function playerLabel(address: string, name?: string, avatar?: string, tag?: string): string {
  const base = name ? `${avatar ?? ""} ${name} · ${shortAddress(address)}` : shortAddress(address);
  return tag ? `${base} · ${tag}` : base;
}
```

- [ ] **Step 2: Espectador — lista de partidas recientes**

En `apps/web/app/watch/page.tsx` (líneas 79-83), pasar el tag:

```tsx
                        {playerLabel(p1.address, p1.name, p1.avatar, p1.house ? t("chip.house") : undefined)}{" "}
                        <b className="font-pixel text-px10 text-(--color-gold)">
                          {p1.score ?? "?"} - {p2.score ?? "?"}
                        </b>{" "}
                        {playerLabel(p2.address, p2.name, p2.avatar, p2.house ? t("chip.house") : undefined)}
```

(Verificar que el componente ya tiene `const { t } = useT();` — si no, agregarlo con su import.)

- [ ] **Step 3: Espectador — replay de una partida**

En `apps/web/app/watch/[matchId]/page.tsx` (líneas 71-73):

```tsx
                label={`${playerLabel(p.address, p.name, p.avatar, p.house ? t("chip.house") : undefined)}${
                  data.winner?.toLowerCase() === p.address.toLowerCase() ? " 🏆" : ""
                }`}
```

- [ ] **Step 4: Página del agente — cabecera + historial**

En `apps/web/app/my-agents/[agentId]/page.tsx`:

Import:

```tsx
import { HouseChip } from "@/app/components/HouseChip";
```

Cabecera (líneas ~117-125), dentro del primer `<span>` del `win-title`:

```tsx
          <span className="flex items-center gap-2">
            {agent.avatar} {agent.name.toUpperCase()}
            {agent.house && <HouseChip />}
          </span>
```

Historial (línea ~227), el rival con tag:

```tsx
                    {t("agent.vs")} {m.opponent ? playerLabel(m.opponent, m.name, m.avatar, m.house ? t("chip.house") : undefined) : "?"}
```

- [ ] **Step 5: Verificar typecheck y tests**

Run: `npm run typecheck:web && npm test`
Expected: PASS todo.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/lib/wallet.tsx apps/web/app/watch/page.tsx "apps/web/app/watch/[matchId]/page.tsx" "apps/web/app/my-agents/[agentId]/page.tsx"
git commit -m "feat(web): etiqueta CASA en espectador, página del agente e historial"
```

---

### Task 4: Script de siembra — 15 agentes de la casa, idempotente

**Files:**
- Create: `scripts/seed-house-agents.ts`
- Modify: `.gitignore` (agregar `.house-wallet.json`)

**Interfaces:**
- Consumes: API pública del árbitro (`GET /agents?owner=`, `POST /agents`), `agentAuthMessage` de `@arcade1v1/game-sdk/auth`, `generatePrivateKey`/`privateKeyToAccount` de `viem/accounts`.
- Produces: archivo local `.house-wallet.json` (`{ "address": "0x…", "privateKey": "0x…" }`, NUNCA commiteado); 15 agentes creados vía API. Uso: `node --import tsx scripts/seed-house-agents.ts [--url URL] [--dry-run]`.

- [ ] **Step 1: `.gitignore`**

Agregar al final de `.gitignore`:

```
# Wallet de la casa (v4.1): la clave firma la administración de los agentes
# CASA. El repo es público — NUNCA subirla.
.house-wallet.json
```

- [ ] **Step 2: Escribir el script**

Crear `scripts/seed-house-agents.ts`:

```ts
// Siembra de los agentes de la casa (v4.1 · Frente 1).
//
// Qué hace: crea (vía la API pública del árbitro, firmando como cualquier
// dueño) los 15 agentes "CASA" — 2-3 por juego, con perillas variadas para
// que haya niveles distintos de ELO. Idempotente: si un agente con el mismo
// (juego, nombre) ya existe para la wallet de la casa, lo saltea.
//
// Wallet: se genera sola la primera vez y queda en .house-wallet.json
// (gitignoreado; el repo es público). El server tiene que listar su address
// en HOUSE_WALLETS para eximirla del tope por owner (si no, el 4to agente
// rebota con "max 3 agents per owner").
//
// Uso:
//   node --import tsx scripts/seed-house-agents.ts                  # contra localhost:4000
//   node --import tsx scripts/seed-house-agents.ts --url https://arcade1v1.onrender.com
//   node --import tsx scripts/seed-house-agents.ts --dry-run        # solo muestra el plan

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { agentAuthMessage } from "@arcade1v1/game-sdk/auth";

const WALLET_FILE = resolve(import.meta.dirname, "..", ".house-wallet.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const urlIdx = args.indexOf("--url");
const BASE = urlIdx >= 0 ? args[urlIdx + 1] : "http://localhost:4000";

// Los 15 de la casa: nombres con personalidad (nada de "Bot 1"), perillas
// variadas a propósito (validateParams del server acota a los rangos del
// registro; valores fuera de rango caen al borde, no fallan).
interface Seed {
  name: string;
  avatar: string;
  game: string;
  strategyId: string;
  params: Record<string, unknown>;
}
const SEEDS: Seed[] = [
  // 2048
  { name: "Doña Cuadritos", avatar: "🧠", game: "2048", strategyId: "2048.priority", params: { priority: ["down", "left", "right", "up"], greed: 0.85 } },
  { name: "Rincón Zen", avatar: "🌵", game: "2048", strategyId: "2048.corner", params: { corner: "down-left", patience: 0.9 } },
  { name: "Turbina", avatar: "⚡", game: "2048", strategyId: "2048.priority", params: { priority: ["left", "down", "right", "up"], greed: 0.1 } },
  // snake
  { name: "Culebra Golosa", avatar: "🐍", game: "snake", strategyId: "snake.greedy", params: { caution: 0.15 } },
  { name: "La Paciente", avatar: "🦖", game: "snake", strategyId: "snake.survivor", params: { foodPull: 0.25 } },
  // flappy
  { name: "Aleteo Fino", avatar: "🚀", game: "flappy", strategyId: "flappy.threshold", params: { riskOffset: 10, reaction: 1 } },
  { name: "Kamikaze del Caño", avatar: "🔥", game: "flappy", strategyId: "flappy.threshold", params: { riskOffset: -35, reaction: 4 } },
  { name: "Capitán Planeo", avatar: "🛸", game: "flappy", strategyId: "flappy.threshold", params: { riskOffset: 25, reaction: 2 } },
  // racing
  { name: "El Esquivador", avatar: "🎯", game: "racing", strategyId: "racing.dodger", params: { lookahead: 220, preferredLane: "center" } },
  { name: "Zigzag Salvaje", avatar: "🎲", game: "racing", strategyId: "racing.weaver", params: { boldness: 0.85 } },
  { name: "Abuelo Prudente", avatar: "🐙", game: "racing", strategyId: "racing.dodger", params: { lookahead: 100, preferredLane: "right" } },
  // invaders
  { name: "Cazadora Alfa", avatar: "👾", game: "invaders", strategyId: "invaders.hunter", params: { aggression: 1, dodge: 0.4 } },
  { name: "Muro Tímido", avatar: "🍄", game: "invaders", strategyId: "invaders.hunter", params: { aggression: 0.2, dodge: 1 } },
  // tetris
  { name: "Don Bloques", avatar: "🕹️", game: "tetris", strategyId: "tetris.heuristic", params: { holes: 9, height: 5, bumpiness: 2, lines: 9 } },
  { name: "Apilador Caótico", avatar: "🎮", game: "tetris", strategyId: "tetris.heuristic", params: { holes: 1, height: 0, bumpiness: 0, lines: 10 } },
];

function loadOrCreateWallet(): { address: string; privateKey: Hex } {
  if (existsSync(WALLET_FILE)) {
    const w = JSON.parse(readFileSync(WALLET_FILE, "utf8"));
    return { address: String(w.address).toLowerCase(), privateKey: w.privateKey as Hex };
  }
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address.toLowerCase();
  writeFileSync(WALLET_FILE, JSON.stringify({ address, privateKey }, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(`Wallet de la casa NUEVA generada y guardada en ${WALLET_FILE}`);
  console.log(`>>> Agregá esta address a HOUSE_WALLETS en el server: ${address}\n`);
  return { address, privateKey };
}

async function main() {
  const { address: owner, privateKey } = loadOrCreateWallet();
  const account = privateKeyToAccount(privateKey);
  console.log(`Árbitro: ${BASE}\nCasa:    ${owner}\n`);

  const r = await fetch(`${BASE}/agents?owner=${owner}`);
  if (!r.ok) throw new Error(`GET /agents -> ${r.status}`);
  const existing = (await r.json()) as { agents: { name: string; game: string }[] };
  const have = new Set(existing.agents.map((a) => `${a.game}:${a.name}`));

  let created = 0;
  let skipped = 0;
  for (const s of SEEDS) {
    if (have.has(`${s.game}:${s.name}`)) {
      skipped++;
      console.log(`= ya existe: [${s.game}] ${s.name}`);
      continue;
    }
    if (dryRun) {
      console.log(`~ crearía:   [${s.game}] ${s.avatar} ${s.name} (${s.strategyId})`);
      continue;
    }
    const ts = Date.now();
    const signature = await account.signMessage({
      message: agentAuthMessage("create", `${s.game}:${s.strategyId}:${s.name}`, owner, ts),
    });
    const res = await fetch(`${BASE}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, ...s, signature, ts }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
    if (!res.ok) throw new Error(`[${s.game}] ${s.name}: ${body.error ?? res.status}`);
    created++;
    console.log(`+ creado:    [${s.game}] ${s.avatar} ${s.name} -> ${body.id}`);
  }
  console.log(`\nListo: ${created} creados, ${skipped} ya existían, ${SEEDS.length} en total.`);
}

main().catch((e) => {
  console.error(`\nERROR: ${(e as Error).message}`);
  process.exit(1);
});
```

- [ ] **Step 3: Probar el dry-run (no necesita server)**

Run: `node --import tsx scripts/seed-house-agents.ts --dry-run --url http://localhost:9`
Expected: genera y guarda `.house-wallet.json`, imprime la address y después FALLA con `GET /agents -> …` o error de conexión — correcto: el dry-run igual consulta qué existe. Ajuste si molesta: probar el dry-run recién en la Task 6 con el server local levantado. Verificar acá solamente:

Run: `git status --short`
Expected: `.house-wallet.json` NO aparece (lo tapa el .gitignore).

- [ ] **Step 4: Typecheck del script**

Run: `npx tsc --noEmit --module nodenext --target es2022 --strict scripts/seed-house-agents.ts` — si el setup de tsconfig raíz no lo cubre, alcanza con que `node --import tsx scripts/seed-house-agents.ts --dry-run` arranque sin errores de sintaxis/tipos en runtime.
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-house-agents.ts .gitignore
git commit -m "feat(scripts): siembra idempotente de los 15 agentes de la casa (wallet local + firma)"
```

---

### Task 5: Keep-alive — cron de GitHub Actions que pinguea al árbitro

**Files:**
- Create: `.github/workflows/keep-alive.yml`

**Interfaces:**
- Consumes: endpoint público `GET /stats` del árbitro en `https://arcade1v1.onrender.com`.
- Produces: ping cada ~10 minutos para que el Render gratuito no duerma (riesgo señalado en el spec: sin tráfico, el runner de la casa se para).

- [ ] **Step 1: Crear el workflow**

Crear `.github/workflows/keep-alive.yml`:

```yaml
# Keep-alive del árbitro (v4.1 · Frente 1): el Render gratuito duerme sin
# tráfico y con él se para el runner de los agentes de la casa. Un ping cada
# ~10 minutos lo mantiene despierto. Limitaciones conocidas y aceptadas:
# el cron de GitHub puede atrasarse varios minutos, y GitHub desactiva los
# schedules si el repo pasa 60 días sin actividad (con commits regulares no
# nos toca; si pasa, se rehabilita con un click en Actions).
name: keep-alive

on:
  schedule:
    - cron: "*/10 * * * *"
  workflow_dispatch: {}

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping al árbitro
        run: curl -fsS --max-time 30 https://arcade1v1.onrender.com/stats > /dev/null
```

- [ ] **Step 2: Validar la sintaxis del YAML**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/keep-alive.yml','utf8'); console.log('bytes:', y.length)"` y revisar a ojo la indentación (no hay parser de YAML en el repo; el push a GitHub lo valida de verdad — si el workflow queda mal, Actions lo marca en la pestaña).
Expected: archivo legible, indentación consistente.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/keep-alive.yml
git commit -m "feat(ci): keep-alive del árbitro — ping cada 10 min para que Render no duerma"
```

---

### Task 6: Verificación local de punta a punta + runbook

**Files:**
- Modify: `DEPLOY.md` (nueva sección "Agentes de la casa")
- (Sin código nuevo: esta task es verificación real + documentación)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: evidencia de que el flujo completo funciona en local, y el runbook para repetirlo en producción.

- [ ] **Step 1: Levantar el server local como "casa"**

```bash
HOUSE_WALLETS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.house-wallet.json','utf8')).address)") npm run server
```

(en una terminal aparte; queda corriendo). Si `.house-wallet.json` no existe todavía, correr antes `node --import tsx scripts/seed-house-agents.ts --dry-run` una vez para generarla (va a fallar el fetch si no hay server — no importa, la wallet ya queda).

- [ ] **Step 2: Sembrar contra local**

Run: `node --import tsx scripts/seed-house-agents.ts`
Expected: `+ creado: …` ×15, `Listo: 15 creados, 0 ya existían`.

Run de nuevo: `node --import tsx scripts/seed-house-agents.ts`
Expected: `= ya existe: …` ×15, `Listo: 0 creados, 15 ya existían` (idempotencia verificada).

- [ ] **Step 3: Verificar el campo `house` y la exención**

```bash
OWNER=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.house-wallet.json','utf8')).address)")
curl -s "http://localhost:4000/agents?owner=$OWNER" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d).agents;console.log('agentes:',a.length,'| house:',a.every(x=>x.house===true))})"
```

Expected: `agentes: 15 | house: true`.

- [ ] **Step 4: Verlo en la web (una pasada visual)**

Con el server local corriendo y dejándolo jugar un par de minutos (el runner los empareja solo):

```bash
NEXT_PUBLIC_ARBITER_URL=http://localhost:4000 npm run web
```

Abrir `http://localhost:3000/leaderboard` y `http://localhost:3000/watch`: los agentes de la casa aparecen con el chip CASA (y en `/es/leaderboard` el texto es "CASA", en `/` "HOUSE"). Sacar captura para el reporte.

- [ ] **Step 5: Runbook en DEPLOY.md**

Agregar a `DEPLOY.md`, después de la sección del gas del árbitro, la sección:

```markdown
## Agentes de la casa (v4.1)

La arena la mantienen viva 15 agentes hosteados nuestros, dueños de la
**wallet de la casa** (sin fondos de valor: la ladder es gratis). La clave
está en `.house-wallet.json` (local, gitignoreado — el repo es público).

- **Server (Render):** la env `HOUSE_WALLETS` lista la address de la casa
  (minúsculas, separadas por coma si algún día hay más de una). Esa lista
  exime del tope de 3 agentes por owner y pinta el campo `house: true` en
  las vistas públicas (el chip CASA de la web sale de ahí). Cambiarla
  requiere redeploy (Render reinicia solo al guardar la env).
- **Sembrar / re-sembrar:** `node --import tsx scripts/seed-house-agents.ts
  --url https://arcade1v1.onrender.com` (idempotente: saltea los que ya
  existen). Sin `--url` apunta a localhost:4000.
- **Keep-alive:** `.github/workflows/keep-alive.yml` pinguea `/stats` cada
  ~10 min para que el Render gratuito no duerma (sin eso, el runner de la
  casa se para hasta la próxima visita). Si GitHub desactiva el cron por
  inactividad del repo (60 días), se rehabilita desde la pestaña Actions.
- **Verificar:** `curl -s "https://arcade1v1.onrender.com/agents?owner=<address>"`
  debe listar 15 agentes con `"house": true`, y el ranking de la web debe
  mostrar el chip CASA.
```

- [ ] **Step 6: Commit**

```bash
git add DEPLOY.md
git commit -m "docs: runbook de los agentes de la casa (HOUSE_WALLETS, siembra y keep-alive)"
```

---

## Cierre en producción (checkpoint con el dueño — NO automatizar)

Fuera del alcance de las tasks (requiere OK explícito y un paso manual en Render):

1. Mostrar al dueño el resultado local (captura del ranking con chips CASA).
2. El dueño (o quien tenga el dashboard de Render) agrega la env `HOUSE_WALLETS=<address de .house-wallet.json>` al servicio del árbitro. Render redeploya solo.
3. `git push` (auto-deploy de web y árbitro con el código nuevo).
4. Correr `node --import tsx scripts/seed-house-agents.ts --url https://arcade1v1.onrender.com`.
5. Verificar en prod: `/leaderboard` con chips, `/watch` con partidas de la casa, `curl /agents?owner=…` con `house: true` ×15.
6. Recién entonces: entrada 3.1.0 en `CHANGELOG.md` + tick del frente 1 en `docs/ROADMAP.md` + commit `docs: changelog 3.1.0 — agentes de la casa`.

## Self-review (hecho al escribir el plan)

- **Cobertura del spec (Frente 1):** wallet de la casa ✓ (Task 4), exención `HOUSE_WALLETS` sin subir el tope global ✓ (Task 1), etiqueta CASA en ranking/página/historial/espectador ✓ (Tasks 2-3), `house: true` derivado de config y no editable por terceros ✓ (Task 1), nombres/avatares con personalidad ✓ (Task 4, 15 seeds), 2-3 por juego en los 6 juegos ✓ (3+2+3+3+2+2=15), keep-alive del riesgo "Render duerme" ✓ (Task 5).
- **Tipos consistentes:** `isHouseWallet` (Task 1), `house?: boolean` en server y cliente (Tasks 1-2), `playerLabel(…, tag?)` (Task 3), `HouseChip` sin props (Tasks 2-3).
