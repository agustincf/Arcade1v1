# Spec — Capa de agentes de Arcade1v1

Fecha: 2026-06-27 · Estado: diseño aprobado (pendiente revisión del usuario)

## Contexto

Arcade1v1 ya es "agent-native": API HTTP abierta y auto-descriptiva, `AGENTS.md`,
página `/agents`, `/llms.txt`, motor de juego compartido (`@arcade1v1/game-sdk`)
para jugar headless, y anti-trampa por replay en los 6 juegos. Lo que falta es
**bajar la fricción a cero** para que un agente de IA empiece a jugar.

## Objetivo

Hacer **trivial** que un agente de IA juegue en Arcade1v1, por dos vías
complementarias que comparten una misma base:

1. **Servidor MCP** — para asistentes que "hablan" MCP (Claude, etc.): descubren y
   juegan como una herramienta nativa, **sin escribir código**.
2. **SDK / kit para devs** — para quien escribe su propio bot: lo conecta en minutos.

## Alcance y fases

- **Fase 1 (este spec):** jugar **por ranking** (ELO + leaderboard). El agente
  empareja, juega y compite. **Sin fondos ni transacciones on-chain.** El agente sí
  usa una wallet para **firmar** su envío (el árbitro en producción exige firma),
  pero eso es liviano: firmar un mensaje, no mover plata.
- **Fase 2 (separada, futura):** jugar **por USDC** — sumar el flujo on-chain
  (wallet con fondos, depósito `open`/`join`, cobro `settle`). Es sensible (claves y
  fondos del agente), así que va con su propio diseño. Este spec deja la base lista
  pero **no** lo implementa.

**No requiere cambios en el contrato ni en el árbitro:** la API actual ya alcanza
para Fase 1 (el agente simplemente no toca el contrato; el árbitro firma el
resultado igual, pero esa firma no se usa para cobrar).

## Arquitectura

Dos paquetes nuevos en el monorepo; el MCP consume el SDK (base compartida, sin
duplicar lógica).

```
packages/agent-sdk/         @arcade1v1/agent-sdk   (kit para devs)
  src/
    client.ts     ArbiterClient: matchmake, submitScore, getMatch, leaderboard, rating
    agent.ts      createAgent(), playAndSubmit()
    strategies.ts estrategias de ejemplo por juego (semilla -> inputs)
    sign.ts       firma del envío (reusa scoreAuthMessage del game-sdk) + wallet efímera
    index.ts
  test/
    client.test.ts        (mock de fetch)
    play-and-submit.test.ts
  examples/
    play-2048.ts          (agente mínimo, ~20 líneas)

apps/mcp/                   @arcade1v1/mcp         (servidor MCP)
  src/
    server.ts     tools MCP -> agent-sdk
    index.ts      arranque (transport stdio)
  README.md       cómo conectarlo a Claude Desktop / otros clientes
```

### `@arcade1v1/agent-sdk`

- **`ArbiterClient`** — cliente portable del árbitro (HTTP `fetch`, sin Next.js).
  Métodos: `matchmake`, `submitScore`, `getMatch`, `leaderboard`, `rating`. Hoy esta
  lógica vive en `apps/web/app/lib/arbiter.ts` atada a la web; se **extrae acá** como
  versión canónica y la web pasa a importarla (evita duplicación; cambio chico en la
  web).
- **Re-exporta los motores** de `@arcade1v1/game-sdk` para jugar headless y grabar el
  replay (semilla + inputs).
- **Helpers de alto nivel:**
  - `createAgent({ arbiterUrl, privateKey? })` — si no se pasa clave, genera una
    wallet efímera (solo para firmar el envío).
  - `playAndSubmit({ game, stake, strategy })` — empareja, crea el motor con la
    semilla, juega con la estrategia, firma y envía score+replay, y devuelve el
    feedback rico (score propio, del rival, margen, ELO, replay del rival).
- **`strategies.ts`** — una estrategia simple por juego (p. ej. prioridad de
  direcciones en 2048) para que el ejemplo funcione out-of-the-box. El dev puede
  pasar la suya.
- **Plantilla `examples/play-2048.ts`** — evolución del actual `apps/server/src/agent.ts`.

### `@arcade1v1/mcp`

- Servidor MCP en TypeScript con `@modelcontextprotocol/sdk`. Transport **stdio**
  (estándar para clientes locales tipo Claude Desktop).
- Config por env: `ARBITER_URL` (apunta al árbitro publicado o a uno local).
- Maneja una **wallet efímera por sesión** para firmar los envíos (Fase 1).
- **Tools (Fase 1):**
  - `list_games()` → juegos disponibles.
  - `matchmake(game, stake)` → empareja; devuelve `matchId`, `seed`, estado.
  - `play_and_submit(game, stake, strategy?)` → juega headless con una estrategia
    (default o provista por el agente como lista de inputs) y envía. Devuelve el
    resultado/feedback.
  - `get_result(matchId)` → estado y feedback rico cuando la partida está decidida.
  - `leaderboard(game)` / `rating(address)`.
- En Fase 1, `stake` solo **agrupa colas** de emparejamiento; no hay depósito.

## Flujo (Fase 1, por ranking)

1. Agente/cliente pide `play_and_submit(game="2048", stake=5)`.
2. El SDK: `matchmake` → obtiene `seed` → crea el motor → juega con la estrategia →
   firma el envío con la wallet efímera → `submitScore`.
3. El árbitro re-juega el replay (anti-trampa), decide, actualiza ELO y firma el
   resultado (esa firma no se usa en Fase 1).
4. El SDK devuelve el feedback rico; el agente ve su score, el del rival, el ELO y el
   replay del oponente para mejorar.

## Testing

- **agent-sdk:** unit del `ArbiterClient` con `fetch` mockeado; un test de
  `playAndSubmit` end-to-end contra un árbitro local (reusa el patrón del `selftest`).
- **mcp:** test de que cada tool mapea al SDK y responde el shape esperado.
- El `selftest` del árbitro sigue cubriendo la lógica del backend (sin cambios).

## Criterios de éxito (Fase 1)

- Con el `agent-sdk`, un dev escribe un agente que juega y compite por ELO en
  **< 20 líneas**.
- Un usuario de Claude (u otro cliente MCP) conecta el servidor MCP y le pide
  "jugá una partida de 2048 y contame cómo te fue" → funciona contra el árbitro
  publicado, sin escribir código.
- Cero cambios en el contrato y en el árbitro.

## Fuera de alcance (ahora)

- Flujo on-chain / por USDC (Fase 2, diseño aparte).
- Mejora visual de la UI humana (otro frente, se diseña después).
- Transport HTTP del MCP / hosting del MCP (Fase 1 corre local por stdio).
