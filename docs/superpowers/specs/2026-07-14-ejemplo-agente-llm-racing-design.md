# Ejemplo de agente con cerebro LLM (Racing) — diseño

**Fecha:** 2026-07-14
**Estado:** aprobado (diseño)
**Rama:** `feat/agente-llm-racing`
**Encuadre:** primer recorte de v4.2 "Agentes de IA". Adelanta la pieza más
barata y demostrativa: un ejemplo de referencia donde un LLM (Claude) juega de
verdad y su replay pasa la verificación anti-trampa del árbitro.

## Problema

Hoy un agente que llega por MCP y usa `play_and_submit` no demuestra ninguna
capacidad propia: dispara una estrategia heurística enlatada
(`DEFAULT_STRATEGIES`) y firma ese resultado. El único ejemplo de código
(`examples/play-2048.ts`) tampoco muestra decisión propia — usa la estrategia
por defecto. Para los otros 5 juegos, `AGENTS.md` literalmente dice "bring your
own — that's the game", pero no hay ni un molde de cómo se mete razonamiento
real en el loop de juego.

El propio ROADMAP reconoce el hueco: hoy "agente" significa "heurística con
perillas", y v4.2 apunta a "agentes con cerebro LLM". Este spec construye el
recorte mínimo que valida esa promesa **sin costo recurrente**: un ejemplo
ejecutable, no un agente CASA hosteado que queme tokens 24/7.

## Alcance

**Dentro:**
- Un ejemplo ejecutable de referencia: un LLM elige los movimientos de una
  partida de **Racing** en vivo; el replay resultante pasa `verifyRacing()`.
- Funciones puras testeables (describir estado, parsear respuesta, detectar
  punto de decisión) + un test que prueba la propiedad central sin red ni key.
- Docs: script npm, sección corta en `AGENTS.md`, mención en el README del SDK.

**Fuera (queda para v4.2+ más grande):**
- Hostear el agente LLM como agente CASA jugando en producción (quema tokens
  reales; necesita presupuesto y límites de gasto).
- Extender el contrato `Strategy` del SDK a asíncrono.
- BYO-agent por webhook, sandbox JS/WASM, torneos.

## Elección de juego: Racing

Racing sobre Flappy, por el motor real (`packages/game-sdk/src/racing.ts`):

- **Puntos de decisión discretos y espaciados.** El auto se queda en su carril
  hasta que uno decide cambiarlo; solo hay que decidir cuando un obstáculo se
  acerca al carril actual. Un LLM interviene decenas de veces por partida, no
  ~1800.
- **Estado trivial de serializar a texto.** Carril actual (0/1/2) + obstáculos
  próximos (carril + distancia) + velocidad. Una o dos líneas.
- **Acción discreta simple.** `moveLeft` / `moveRight` / quedarse → `L`/`R`/`S`.

Flappy queda descartado: física continua (gravedad) que exige timing fino de
aleteo a 60 ticks/s; delegar eso a un LLM sería lentísimo y de baja calidad.

## Arquitectura

### Por qué flujo manual (y no `play_and_submit` / `playAndSubmit`)

El contrato `Strategy` actual es **síncrono**: `(seed: number) => PlayResult`
(ver `packages/agent-sdk/src/agent.ts:42`). Un LLM es asíncrono. En vez de
tocar el core del SDK, el ejemplo arma el flujo completo a mano con las piezas
que el SDK **ya exporta** (`packages/agent-sdk/src/index.ts`):

`randomWallet` · `signMatchmake` · `ArbiterClient` · `signScore`

Ventajas: (a) no modifica el SDK publicado; (b) es más didáctico — muestra cada
paso; (c) es exactamente lo que un dev externo copiaría para su propio agente.

### Flujo del ejemplo

1. `randomWallet()` → wallet efímera (solo firma; sin fondos, Fase 1).
2. `signMatchmake()` + `client.matchmake(game, stake, address, auth)` → `matchId`
   + `seed`. Stake 0 (ladder gratis / ranked, sin on-chain).
3. Loop de juego con `RacingEngine(seed)` corriendo tick a tick; en cada
   **punto de decisión** consulta al cerebro; construye `ReplayRacing`
   (`{ seed, ticks, inputs: [{t, a}] }`).
4. `signScore()` + `client.submitScore(matchId, address, score, replay, sig)`.
5. Imprime el estado del match y, si se decidió, el resultado (score propio,
   rival, ELO).

### El cerebro (decisión event-driven)

Un LLM no puede opinar en cada tick. El loop solo consulta en **puntos de
decisión**:

- **Cuándo:** el obstáculo relevante más cercano (en el carril actual o en un
  carril adyacente candidato) entra dentro de una distancia de peligro `D`, y
  no consultamos en los últimos `T` ticks (throttle anti-spam). Umbrales como
  constantes nombradas en el ejemplo.
- **Qué se le manda:** el estado serializado a texto (carril actual; para cada
  carril, distancia al próximo obstáculo o "libre"; velocidad). System prompt
  corto con las reglas y el formato de respuesta exigido (`L`/`R`/`S`).
- **Qué se hace con la respuesta:** parseo estricto → acción; si la respuesta
  no es válida, default = quedarse (`S`). Se aplica al motor
  (`moveLeft`/`moveRight`) y, si hubo movimiento, se registra `{t, a}` en el
  replay.

La función de decisión se **inyecta** al loop:
`decide(stateText: string) => Promise<"L" | "R" | "S">`. El ejemplo real la
instancia con Claude; el test la instancia con un doble determinista.

### Por qué pasa el anti-trampa

El árbitro re-simula el replay (semilla + inputs) con `verifyRacing()`; **no
vuelve a llamar al LLM**. El cerebro solo influye en *qué* inputs se eligen;
una vez elegidos, el replay es determinístico y verificable como el de
cualquier jugador. Mismo principio que con un humano: el cerebro es libre, el
resultado se verifica.

## Piezas concretas

- **`packages/agent-sdk/examples/play-racing-llm.ts`** — el ejemplo. Exporta
  las funciones puras (`describeState`, `parseAction`, `isDecisionPoint`) y el
  loop `playRacingWithBrain(seed, decide, opts)` que devuelve `{ score, replay }`.
  `main()` cablea Claude + árbitro.
- **`@anthropic-ai/sdk`** como **devDependency** de `agent-sdk`. `examples/` no
  se publica (el publish solo compila los `ENTRIES` de `scripts/publish-sdk.mjs`),
  así que no infla el paquete npm.
- **Modelo por defecto: Claude Haiku 4.5** — barato y rápido para elegir carril
  (una partida hace decenas de llamadas). Configurable por env
  (`ARCADE_LLM_MODEL`). El ID exacto del modelo se confirma consultando la skill
  `claude-api` al implementar.
- **`ANTHROPIC_API_KEY`** requerida por `main()`; si falta, error claro que
  aclara que el ejemplo corre con la key de quien lo lanza.
- **`ARBITER_URL`** — igual que el ejemplo de 2048 (default arbiter público o
  local).
- **`packages/agent-sdk/test/racing-llm.test.ts`** — inyecta un `decide` falso
  determinista, corre `playRacingWithBrain`, y verifica que:
  (a) el replay producido pasa `verifyRacing()`, y
  (b) el `score` devuelto coincide con el que re-simula el árbitro.
  Prueba la propiedad central **sin red ni API key**. Además, tests unitarios de
  `parseAction` (respuestas válidas e inválidas) y `describeState`.
- **`package.json` de agent-sdk** — script `example:racing-llm`:
  `tsx examples/play-racing-llm.ts`.
- **Docs:**
  - `AGENTS.md`: sección corta "Bring an LLM brain" apuntando al ejemplo, cerca
    de donde hoy dice "for the other games you bring your own".
  - README del `agent-sdk`: una línea mencionando el ejemplo LLM.

## Honestidad operativa (documentado en el propio ejemplo)

- Cada partida hace decenas de llamadas secuenciales a Claude → tarda del orden
  de minutos de reloj y consume tokens de quien lo corre.
- Es una demo del **patrón**, no una policy optimizada para escalar el ranking.
- Cap de seguridad `MAX_TICKS` (como en las estrategias existentes) para que una
  partida no se eternice.

## Testing y verificación

- El motor de Racing ya está testeado en el repo.
- El test nuevo prueba el loop del cerebro con un doble inyectado — la propiedad
  "el replay del cerebro pasa la verificación" queda cubierta en CI sin
  depender de la red ni de una API key.
- Verificación manual del camino real (llamada a Claude + árbitro) queda como
  ejecución del ejemplo, fuera de CI.
- `npm run check` (typecheck + lint + format + test + selftest) debe pasar.

## Riesgos y mitigaciones

- **Costo/latencia al correrlo:** documentado; modelo barato por defecto; cap de
  ticks. No corre solo (sin agente hosteado).
- **Respuestas basura del LLM:** parseo estricto con default seguro (`S`).
- **Deriva del ID de modelo:** se confirma vía skill `claude-api` al implementar,
  y es configurable por env.
- **No romper el paquete publicado:** la dependencia nueva es devDependency y
  `examples/` no entra al publish.
