# Agentes en las mesas 1v1 de plata — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que `agent.playAndSubmit({ game, stake > 0 })` (SDK) y `play_paid` (MCP)
jueguen una mesa 1v1 de plata de punta a punta, sin intervención humana, en las
mismas mesas que las personas y solo en juegos en vivo.

**Architecture:** el SDK gana un bloque de configuración `paid1v1` y un módulo
nuevo (`paid1v1.ts`) con cuatro pasos:
1. una revisión previa sin efectos;
2. la verificación del asiento contra el contrato que fijó el operador;
3. un depósito exacto (`open`/`join`) siguiendo el patrón de `alephDeposit`;
4. el juego en vivo, con reintentos acotados.

En el árbitro solo se arreglan los códigos HTTP de los errores de depósito, se
publica `rules` en `/health` y se sacan las rutas 1v1 a un router, para poder
probarlas. El MCP envuelve el SDK en herramientas nuevas. La web suma un aviso.

**Tech Stack:** TypeScript, viem 2, Express, `node:test` + tsx, Foundry/anvil
(e2e), Next.js (web), MCP SDK.

**Spec:** [`docs/superpowers/specs/2026-11-27-agentes-mesas-de-plata-1v1-design.md`](../specs/2026-11-27-agentes-mesas-de-plata-1v1-design.md)
(aprobada por el dueño el 2026-11-27). Leela entera antes de empezar: este plan
se apoya en ella.

## Global Constraints

- **El contrato no se toca.** Cero cambios en `packages/contracts/src/*.sol`.
- **Tampoco el emparejamiento ni sus plazos.** Cero cambios en `waiterState`,
  `OPEN_GRACE_MS`, `JOIN_WINDOW_MS`, `MAX_WAITERS_CHECKED`, `termsOf` ni en la
  lógica de pago y reembolso de `apps/server/src/matchmaking.ts`.
- **Mismas mesas:** ninguna fila aparte para agentes. La clave sigue siendo
  `game:stake`.
- **Solo juegos en vivo:** `isLiveMatch(game, RULES_V[game])` (de
  `@arcade1v1/game-sdk/live`) y `view.live === true`.
- **Los agentes hosteados y de webhook siguen en stake 0.** No se toca
  `AGENT_STAKE` (`apps/server/src/agent-runner.ts:46`).
- **`stake: 0` y Aleph no cambian de comportamiento.** Todas las pruebas que
  existen hoy siguen pasando sin tocarse, salvo las que este plan reescribe a
  propósito, que se nombran en su tarea.
- **Textos de error del árbitro que NO cambian** (el SDK nuevo los compara):
  - `no on-chain deposit found for this address in this match`
  - `could not verify your deposit on-chain — retry in a moment`
  - `this match is already settled or refunded on-chain`
  - `not a player`
  - `too many failed verifications for this match`
  - `paid tables disabled`
- **Permisos de gasto:** solo `approve(escrowFijado, unidadesExactas)`, nunca
  infinito y nunca a otra dirección. El monto sale de `stakeToUnits(stake)`,
  con el `stake` que pidió el agente; nunca de una cifra que mande el árbitro.
- **Ningún error repite un valor de configuración:** ni la llave, ni la URL del
  RPC, ni el pin. Los errores de plata del MCP pasan por `errorWithoutUrls`.
- **Antes de mandar cualquier transacción:** `simulateContract`, gas estimado ×
  5/4, `waitForTransactionReceipt`, `waitUntilSealed` y
  `receipt.status === "success"`.
- **Valores fijos:**

  | Constante | Valor | Para qué |
  | --- | --- | --- |
  | `DEFAULT_MAX_FEE_BPS` | `1500` | comisión máxima por defecto |
  | `MAX_FUND_AHEAD_S` | `75 * 60` | tope de `fundDeadline − ahora` |
  | `MAX_PLAY_AHEAD_S` | `6 * 3600` | tope de `playDeadline − ahora` |
  | `CHAIN_MARGIN_S` | `60` | margen de tiempo de cadena antes de `join` |
  | `SEAT_DEPOSIT_WINDOW_MS` | `9 * 60_000` | 10 min de `OPEN_GRACE_MS`/`JOIN_WINDOW_MS` menos 60 s |
  | `LIVE_START_RETRY_DELAYS_MS` | `[2000, 4000, 8000, 8000, 8000, 10000, 10000, 10000]` | 60 s en total |
  | `CIRCLE_USDC_BASE` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | USDC de Circle en Base |
  | redes aceptadas | `8453`, `84532`, `31337` | — |
- **Idioma:**
  - comentarios de código, en español (como el resto del repo);
  - errores nuevos del SDK y descripciones de herramientas del MCP, en inglés;
  - commits, en español, terminados en
    `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Documentación en el mismo PR:** cada tarea agrega su línea al CHANGELOG
  bajo `## [Sin publicar]`, en `### Agregado`, `### Cambiado`, `### Corregido`
  o `### Seguridad`. Cada entrada lleva una frase en negrita, una explicación
  simple y cómo se probó. Además, cada tarea actualiza la documentación que toca
  su cambio.
- **Pruebas:**
  - un archivo: `node --import tsx --test <ruta>`;
  - todo, antes de cada commit de cierre de tarea: `npm run check`.
- **Rama:** `feat/agentes-mesas-plata-1v1`, en el worktree
  `.claude/worktrees/agentes-mesas-plata`. Antes de abrir el PR se rebasa sobre
  `main` cuando se mergee el #77 (Tarea 11).

## Review Focus

Los cinco casos que la spec implica y que es más probable que le peguen a
alguien. Cada uno tiene su prueba en la tarea que es dueña del código:

1. **El RPC del árbitro tarda más que los reintentos.** Se espera que
   `playAndSubmit` tire `Paid1v1Error` con `deposited: true` y el `matchId`, y
   que `resume1v1(matchId)` juegue la partida más tarde sin depositar de nuevo
   (Tarea 5, `resume1v1 juega una partida cuyo live/start falló de más`).
2. **Dos `playAndSubmit` pagados a la vez en el mismo agente** (un bucle o un
   modelo). Se espera que el segundo se rechace sin emparejar ni transmitir
   (Tarea 5, `una segunda partida pagada en juego se rechaza sin emparejar`).
3. **Al pedir de nuevo, el agente pasa de p1 a p2 de la partida de una persona,
   y esa segunda vista es inválida** (stake distinto o asiento ajeno). Se espera
   que aborte sin transmitir ningún `open`/`join`; a lo sumo queda el approve
   (Tarea 5, `re-pedido que cambia a p2 inválido aborta sin depositar`).
4. **El ETH alcanza para el approve pero no para el depósito.** Se espera un
   error antes del depósito, con el `matchId` y `deposited: false`, y que la
   llamada siguiente reuse el permiso sin un segundo approve (Tarea 4,
   `sin ETH para el depósito: error claro y el permiso se reusa`).
5. **El modelo pide en el MCP un stake mayor que `ARCADE_1V1_MAX_STAKE` o uno
   que no es una mesa (por ejemplo 3).** Se espera un rechazo sin tocar la red
   (Tarea 8, `play_paid rechaza un stake fuera de tope o de mesa sin tocar la
   red`).

---

### Task 1: el contrato 1v1 en el game-sdk (`/escrow1v1`)

**Files:**
- Create: `packages/game-sdk/src/escrow1v1.ts`
- Modify: `packages/game-sdk/package.json` (exports: `"./escrow1v1": "./src/escrow1v1.ts"`)
- Modify: `packages/game-sdk/README.md` (sección del subpath)
- Test: `packages/game-sdk/test/escrow1v1.test.ts`
- Test: `apps/server/test/seat-domain.test.ts`

**Interfaces:**
- Produces:
  - `escrow1v1Abi`: `as const`, con `open`, `join`, `matches` (8 salidas, sin
    `frozenFeeBps`, igual que `apps/server/src/abi.ts:137-141`), `arbiter`,
    `usdc`, `feeBps`, `allowedStake`, `owed` y `withdraw`.
  - `escrow1v1MatchFeeAbi`: solo el fragmento `matches` con 9 salidas, la
    novena `frozenFeeBps` (`uint16`).
  - `testUsdcMintAbi`: `mint(address,uint256)`.
  - `ESCROW1V1_STATUS = { None: 0, Open: 1, Funded: 2, Settled: 3, Refunded: 4 } as const`.
  - `SEAT_TYPES`, idéntico al de `apps/server/src/sign.ts:21-29`.
  - `seatDomain(chainId: number, escrow: `0x${string}`): { name: "Arcade1v1Escrow"; version: "2"; chainId: number; verifyingContract: `0x${string}` }`.
  - `CIRCLE_USDC_BASE`.
  - `stakeToUnits` y `erc20MinimalAbi`, reexportados desde `./aleph-escrow`.

- [ ] **Step 1: Write the failing tests**
  - `escrow1v1.test.ts`:
    - `seatDomain fija nombre y versión del contrato`: `seatDomain(84532, X)`
      devuelve `{ name: "Arcade1v1Escrow", version: "2", chainId: 84532, verifyingContract: X }`.
    - `el ABI decodifica matches de 8 y de 9 salidas`: el fragmento de 8
      salidas no tiene `frozenFeeBps` y el de 9 sí (inspeccionar `outputs`).
    - `ESCROW1V1_STATUS sigue el enum del contrato`: con los 5 valores de arriba.
  - `seat-domain.test.ts`, con las mismas variables de entorno que
    `apps/server/test/live-deposit.test.ts:12-17`:
    - `el asiento que firma el árbitro se recupera con el dominio del game-sdk`:
      se firma con `signSeat` y se recupera con `recoverTypedDataAddress`
      usando `seatDomain(31337, ESCROW_ADDRESS)` y `SEAT_TYPES` del game-sdk. El
      resultado tiene que ser igual a `arbiterAddress()`.
- [ ] **Step 2: Run them and see them fail**

  Run: `node --import tsx --test packages/game-sdk/test/escrow1v1.test.ts apps/server/test/seat-domain.test.ts`

  Expected: FAIL, "Cannot find module …/escrow1v1".
- [ ] **Step 3: Implement `packages/game-sdk/src/escrow1v1.ts`** sin importar
  viem (como `aleph-escrow.ts`), y agregar el export a `package.json`.
- [ ] **Step 4: Run them and see them pass.** Mismo comando. Expected: PASS.
- [ ] **Step 5: Documentar y commitear**
  - README del game-sdk: una sección sobre `/escrow1v1`.
  - CHANGELOG, en Agregado: "**El game-sdk publica el contrato 1v1**…".
  - `npm run check`, y después:

    ```bash
    git add packages/game-sdk apps/server/test/seat-domain.test.ts CHANGELOG.md
    git commit -m "game-sdk: subpath /escrow1v1 con el ABI, los estados y el dominio del asiento"
    ```

### Task 2: árbitro, errores de depósito con su código, rutas 1v1 en un router y `rules` en `/health`

**Files:**
- Create: `apps/server/src/http-errors.ts` (pasan acá `ERRORES_ESPERABLES` y `responderError`, desde `index.ts:94-116`)
- Create: `apps/server/src/match-routes.ts`
- Create: `apps/server/src/health.ts`
- Modify:
  - `apps/server/src/index.ts` (montar el router y usar `healthBody()`)
  - `apps/server/src/onchain.ts` (clase de error)
  - `apps/server/src/matchmaking.ts:1030-1033` (lanzarla)
  - `apps/server/src/live.ts:260-264` (no envolverla)
  - `apps/server/src/live-routes.ts:29-41` (mapearla)
  - `apps/server/src/agent.ts:66-72` (el demo pasa a stake 0)
  - la llamada de la web a `live/start`: buscar `liveStart` en `apps/web/app`, para que un 503 muestre el aviso de reintento del patrón `app/lib/errors.ts`
- Test: `apps/server/test/deposit-errors-http.test.ts`
- Test: `apps/server/test/health-rules.test.ts`

**Interfaces:**
- Produces:
  - `export class DepositUnverifiedError extends Error`, en `onchain.ts`, con el
    mensaje `could not verify your deposit on-chain — retry in a moment`.
  - `export function responderError(req, res, e): void`, en `http-errors.ts`.
    `DepositUnverifiedError` contesta 503 con `Retry-After: 3`. Al regex se le
    suman `no on-chain deposit found|not a player|too many failed verifications`
    y esos mensajes contestan 400.
  - `export function matchRouter(limits: { score: RequestHandler }): Router`,
    con `GET /arbiter`, `POST /matchmake`, `POST /match/:id/score` y
    `GET /match/:id`, movidos sin cambios de `index.ts:296-358`. El
    `POST /match/:id/bot` queda en `index.ts`.
  - `export function healthBody(): { ok: true; commit: string; mode: string; escrow?: string; rules: Record<string, number> }`,
    con `rules: RULES_V`.
  - En `live-routes.ts`, `fail()`: `DepositUnverifiedError` contesta 503 con
    `Retry-After: 3`.

- [ ] **Step 1: Write the failing tests**
  - `deposit-errors-http.test.ts`: monta `matchRouter` y `liveRouter` en un
    `express()` en el puerto 0. Toma el entorno y el escrow verificado de
    `live-deposit.test.ts:12-22`, con un RPC que no contesta.
    - `live/start sin poder leer la cadena contesta 503 con Retry-After`:
      status 503, header `retry-after` igual a `"3"`, body `{ error: /could not verify your deposit on-chain/ }`.
    - `score sin poder leer la cadena contesta 503`: lo mismo sobre
      `/match/:id/score`, con la rendición vacía de flappy
      `{ ticks: 0, flaps: [], v: 2 }`.
    - `score sin depósito contesta 400 con el motivo`: con un escrow falso
      (`setEscrowChainForTest`) que lee `status: None`, se espera 400 y
      `{ error: "no on-chain deposit found for this address in this match" }`.
    - `not a player contesta 400`: un address ajeno manda un score, y se espera
      400 con `/not a player/`.
  - `health-rules.test.ts`:
    - `healthBody publica las reglas vigentes`: `healthBody().rules` es
      `deepEqual` a `RULES_V`.
- [ ] **Step 2: Run them and see them fail**

  Run: `node --import tsx --test apps/server/test/deposit-errors-http.test.ts apps/server/test/health-rules.test.ts`

  Expected: FAIL, porque no existen los módulos.
- [ ] **Step 3: Implementar.** Mover el código sin cambiar comportamiento, salvo
  lo que dice Interfaces. `assertDepositOnchain` lanza `DepositUnverifiedError`
  en el `catch` de la lectura de la cadena. `live.ts` la deja pasar tal cual
  (`if (e instanceof DepositUnverifiedError) throw e;` antes del `LiveError`).
  El demo `apps/server/src/agent.ts` pasa a stake 0, con un comentario que
  apunta a `playAndSubmit` con `paid1v1`.
- [ ] **Step 4: Run them and see them pass.** Correr también, sin tocarlas,
  `apps/server/test/live-deposit.test.ts`, `deposito-onchain.test.ts`,
  `paid-settle.test.ts` y `escrow-gate-matchmake.test.ts`. Expected: PASS.
- [ ] **Step 5: Web.** Si `live/start` en la web trata un no-400 como
  "error interno", hacer que un 503 muestre el aviso de reintento
  (`err.*`, patrón de `apps/web/app/lib/errors.ts`). Correr las pruebas web que
  toquen esa llamada.
- [ ] **Step 6: Documentar y commitear**
  - CHANGELOG, en Corregido: "**Un depósito que el árbitro todavía no ve ya no
    contesta 'error interno'**…".
  - CHANGELOG, en Cambiado: "**`/health` publica las reglas vigentes**".
  - `docs/ARCHITECTURE.md`: las rutas 1v1 viven en `match-routes.ts`.
  - `npm run check`, y después:

    ```bash
    git commit -am "Árbitro: los errores de depósito contestan 400/503, rutas 1v1 en un router y reglas en /health"
    ```

### Task 3: SDK, configuración `paid1v1`, mensajes de rechazo y `getResult`

**Files:**
- Create: `packages/agent-sdk/src/paid1v1-config.ts`
- Modify: `packages/agent-sdk/src/agent.ts`
  - opciones de `createAgent`, `:98-130`;
  - `assertFreeTable` y `matchmake`, `:227-246`;
  - el objeto que devuelve, `:887-897`.
- Modify: `packages/agent-sdk/src/index.ts` (exports)
- Test: `packages/agent-sdk/test/paid1v1-config.test.ts`
- Test: `packages/agent-sdk/test/agent.test.ts:68-81` (se reescribe)

**Interfaces:**
- Produces:
  - `export interface Paid1v1Config { rpcUrl: string; escrow: `0x${string}`; chainId: 8453 | 84532 | 31337; maxStake: number; maxFeeBps?: number }`
  - `export function validatePaid1v1(cfg: unknown, hasPrivateKey: boolean): Paid1v1Config | undefined`.
    Con `undefined` devuelve `undefined`. Si no, tira `createAgent: paid1v1.<campo> …`
    nombrando cada campo inválido o faltante, sin su valor. Reglas:
    - `escrow`: 0x más 40 hex, distinto de la dirección cero;
    - `rpcUrl`: `http:` o `https:`;
    - `chainId`: uno de los tres aceptados;
    - `maxStake`: finito y mayor que 0;
    - `maxFeeBps`: si viene, entero entre 0 y 2000;
    - sin `privateKey`: `createAgent: paid1v1 needs privateKey (the ephemeral wallet can never hold USDC)`.
  - `createAgent` acepta `paid1v1?: Paid1v1Config` y llama a `validatePaid1v1`
    antes de cualquier otra cosa.
  - `agent.getResult(matchId: string): Promise<MatchView>`, que equivale a
    `client.getMatch(matchId, address)`.
  - `agent.matchmake(game, stake > 0)` tira siempre
    `matchmake only takes free seats (stake 0): paid tables go through playAndSubmit({ game, stake }) with paid1v1 configured in createAgent`.
  - `agent.matchmake` firma con `ts: clock()`.

- [ ] **Step 1: Write the failing tests**
  - `paid1v1-config.test.ts`. Una prueba por regla:
    - `escrow cero`, `escrow corto`, `rpcUrl sin esquema`, `chainId 1`,
      `maxStake 0`, `maxStake Infinity`, `maxFeeBps 2001`, `sin privateKey`;
    - cada una con `assert.throws` sobre el nombre del campo y
      `assert.doesNotMatch(err.message, <valor de entrada>)`;
    - un control positivo que devuelve la configuración.
  - `agent.test.ts`, en lugar de la prueba de `:68-81`:
    - `matchmake con stake > 0 se rechaza aunque haya paid1v1`: con un cliente
      falso cuyo `matchmake` cuenta llamadas, el conteo queda en 0.
    - `playAndSubmit con stake > 0 sin paid1v1 se rechaza sin emparejar`:
      `/needs paid1v1/`, conteo en 0.
    - `stake 0 sigue igual`: la prueba feliz de stake 0 que ya existe.
    - `getResult pide la vista con la propia dirección`.
- [ ] **Step 2: Run them and see them fail.**

  Run: `node --import tsx --test packages/agent-sdk/test/paid1v1-config.test.ts packages/agent-sdk/test/agent.test.ts`
- [ ] **Step 3: Implementar.** `playAndSubmit` con `stake > 0` y sin `paid1v1`
  tira `playAndSubmit with stake > 0 needs paid1v1 { rpcUrl, escrow, chainId, maxStake } and privateKey in createAgent — not taking a seat`.
  Con `paid1v1`, por ahora tira `not implemented` (lo completa la Tarea 5).
- [ ] **Step 4: Run them and see them pass.** Además, el resto de
  `packages/agent-sdk/test/*.test.ts` sin cambios.
- [ ] **Step 5: Commit.** CHANGELOG, en Agregado (SDK): "**Configuración
  `paid1v1`**…".

### Task 4: SDK, revisión previa, verificación del asiento y depósito

**Files:**
- Create: `packages/agent-sdk/src/paid1v1.ts`
- Create: `packages/agent-sdk/src/tx-lock.ts`
- Create: `packages/agent-sdk/test/fake-rpc-1v1.ts`. Es un archivo **aparte**:
  `fake-rpc.ts` no se toca, porque lo comparte `apps/mcp/test/tools-aleph.test.ts`.
- Modify: `packages/agent-sdk/src/agent.ts` (el `send` y el approve de
  `alephDeposit`/`alephWithdraw` pasan por el candado)
- Test: `packages/agent-sdk/test/agent-1v1-money.test.ts`
- Test: `packages/agent-sdk/test/tx-lock.test.ts`

**Interfaces:**
- Consumes:
  - de la Tarea 1: `escrow1v1Abi`, `escrow1v1MatchFeeAbi`, `ESCROW1V1_STATUS`,
    `SEAT_TYPES`, `seatDomain`, `CIRCLE_USDC_BASE`, `stakeToUnits`,
    `erc20MinimalAbi`;
  - de la Tarea 3: `Paid1v1Config`.
- Produces:
  - `export type TxLock = <T>(fn: () => Promise<T>) => Promise<T>` y
    `export function createTxLock(): TxLock`. Es un candado por wallet que
    cubre solo envío + recibo + sellado.
  - `export class Paid1v1Error extends Error { readonly stage: "check" | "seat" | "deposit" | "play"; readonly matchId?: string; readonly deposited: boolean }`
  - `export interface Paid1v1Deposit { step: "open" | "join" | "already"; role: "p1" | "p2"; txHash?: `0x${string}`; approveTx?: `0x${string}`; reseatedFrom?: string }`
  - `export interface Preflight { units: bigint; usdc: `0x${string}`; arbiter: `0x${string}`; chainId: number }`
  - `export function createPaid1v1(d: { cfg: Paid1v1Config; privateKey: `0x${string}`; client: ArbiterClient; clock: () => number; txLock: TxLock })`,
    que devuelve:
    - `preflight(game: string, stake: number): Promise<Preflight>`: la
      revisión previa de la spec ("Revisión previa", puntos 1 a 4). Lanza
      `Paid1v1Error` con stage `"check"` y sin `matchId`. Pide
      `client.health()` (método nuevo de `ArbiterClient`: `GET /health`) y
      `GET /arbiter` (método nuevo `client.arbiterAddress()`).
    - `verifySeat(view: MatchView, stake: number, pre: Preflight): Promise<void>`:
      la spec, "Sentarse y verificar el asiento", puntos 2 a 4, incluida la
      comisión del p2 con `escrow1v1MatchFeeAbi` y el respaldo `feeBps()`.
      Lanza `Paid1v1Error` con stage `"seat"`.
    - `approveIfNeeded(pre: Preflight): Promise<`0x${string}` | undefined>`
    - `deposit(view: MatchView, pre: Preflight): Promise<Paid1v1Deposit>`: la
      spec, "Depositar", puntos 4 a 6. Lanza `Paid1v1Error` con stage
      `"deposit"`, y `deposited` según lo que diga la cadena después.
    - `depositedRole(matchId: string): Promise<"p1" | "p2" | null>`: lee
      `matches(id)` y devuelve el rol de esta wallet si su depósito está en la
      cadena (`Open` o `Funded` si es p1, `Funded` si es p2).
  - `fake-rpc-1v1.ts`: `fakeRpc1v1(chainIdHex, state)`, con
    `state: { usdcBalance?, ethBalance?, allowance?, feeBps?, frozenFeeBps?, allowed?: bigint[], arbiter, usdc, matches?: Record<Hex, {p1,p2,stake,fundDeadline,playDeadline,status}>, blockTimestamp?, preconfirm?, minedRevert?: string, rivalJoinsFirst?, ethForGas?: "approveOnly" }`.
    Contesta `eth_chainId`, `eth_getCode`, `eth_getBalance`,
    `eth_call` (las funciones del ABI de la Tarea 1 más ERC20),
    `eth_estimateGas` y `eth_sendRawTransaction` (decodifica `approve`, `open`
    con el orden de argumentos del 1v1, `join`, `withdraw` y `mint`). Expone
    `calls` y `broadcasts`, como `fake-rpc.ts`.

- [ ] **Step 1: Write the failing tests.** En `agent-1v1-money.test.ts`, los
  asientos los firma una llave de prueba en el dominio real (`seatDomain`). El
  árbitro falso registra un `calls`.
  - `revisión previa: cada falla corta antes de emparejar`. Una prueba por
    caso: red distinta, sin código en el pin, `arbiter()` distinto de
    `/arbiter`, `usdc()` distinto del de Circle en 8453, `feeBps` 1600,
    `allowedStake` falso, stake mayor que `maxStake`, USDC corto, ETH corto,
    `/health escrow: "blocked"`, `/health rules` distinto y un juego con
    semilla (`"2048"`). Cada una: el árbitro falso tiene 0 `matchmake` y
    `broadcasts` está vacío.
  - `árbitro mentiroso: nada se transmite`. Una prueba por caso, sobre la vista
    que devuelve el emparejamiento: `stake` distinto, sin `seatSig`, asiento
    firmado por otra llave, asiento de otra red (`seatDomain(8453, …)`),
    `playDeadline` en ahora + 2 días, `live: false` y `rulesV` distinto. Cada
    una: `broadcasts` vacío.
  - `p1 feliz`: `broadcasts` es
    `[approve(escrow, 1_000_000n), open(id, 1_000_000n, fd, pd, seatSig)]`, con
    los plazos de la vista.
  - `p2 feliz`: se lee `matches(id)` antes de transmitir, y `broadcasts` es
    `[approve, join(id, seatSig)]`.
  - `p2 con poco margen`: con `blockTimestamp` a 30 s de `fundDeadline` se
    rechaza sin transmitir.
  - `p2 con comisión congelada alta`: `frozenFeeBps` 1600 se rechaza.
  - `carrera perdida`: `rivalJoinsFirst` hace que un `join` revertido "not
    open" con otro p2 termine en `Paid1v1Error` con stage `"deposit"` y
    `deposited: false`. Un segundo depósito no hace approve nuevo.
  - `ya depositado`: `matches` con `p1 = yo` y `Open` devuelve
    `step: "already"`, sin transmitir.
  - `recibo preconfirmado`: con `preconfirm`, el `open` se simula después del
    sellado. Positivo: un `open` minado.
  - `revert minado`: `minedRevert` termina en error con `deposited: false`.
  - **Review Focus 4.** `sin ETH para el depósito: error claro y el permiso se
    reusa`: con `ethForGas: "approveOnly"` el primer intento hace el approve y
    falla antes del `open` con `deposited: false`. Al restaurar el ETH, el
    segundo intento transmite solo `open`.
  - `tx-lock.test.ts`: `dos envíos concurrentes se serializan` (el segundo
    `fn` arranca después de que el primero resuelve) y `un error libera el
    candado`.
- [ ] **Step 2: Run them and see them fail.**

  Run: `node --import tsx --test packages/agent-sdk/test/agent-1v1-money.test.ts packages/agent-sdk/test/tx-lock.test.ts`
- [ ] **Step 3: Implementar `paid1v1.ts`.**
  - Seguir el orden y los controles de `alephDeposit` (`agent.ts:561-838`).
  - Usar `chainFor`: se mueve sin cambios de `agent.ts:89-96` a un archivo
    nuevo, `packages/agent-sdk/src/chains.ts` (`export function chainFor(id: number): Chain`),
    y lo importan los dos.
  - El ETH necesario se estima con
    `(APPROVE_GAS + DEPOSIT_GAS) * maxFeePerGas * 3n / 2n`, con
    `APPROVE_GAS = 70_000n` y `DEPOSIT_GAS = 250_000n` mientras no estén
    medidos. La Tarea 7 los ajusta.
  - En `alephDeposit` y `alephWithdraw`, cada `writeContract` + recibo +
    sellado pasa por el mismo `txLock` de la wallet.
- [ ] **Step 4: Run them and see them pass.** Además,
  `node --import tsx --test packages/agent-sdk/test/agent-aleph.test.ts apps/mcp/test/tools-aleph.test.ts`
  tiene que pasar sin cambios.
- [ ] **Step 5: Commit.** CHANGELOG, en Seguridad: "**Los agentes verifican el
  asiento contra el contrato fijado antes de pagar**…".

### Task 5: SDK, `playAndSubmit` con plata y `resume1v1`

**Files:**
- Modify: `packages/agent-sdk/src/agent.ts`
  - `playAndSubmit`, `:248-278`;
  - `playLive`, `:303-375`: `live/start` pasa a reintentarse;
  - el objeto que devuelve.
- Modify: `packages/agent-sdk/src/index.ts` (exports: `Paid1v1Error`,
  `Paid1v1Deposit`, `PaidStepEvent` y `Paid1v1Config`)
- Test: `packages/agent-sdk/test/agent-1v1-play.test.ts`

**Interfaces:**
- Consumes: `createPaid1v1`, `Paid1v1Error`, `Paid1v1Deposit`, `createTxLock`
  (Tarea 4) y `validatePaid1v1` (Tarea 3).
- Produces:
  - `export interface PaidStepEvent { step: "seated" | "deposited"; matchId: string }`
  - `playAndSubmit(args: { game; stake; strategy?; liveStrategy?; onPaidStep?: (e: PaidStepEvent) => void }): Promise<MatchView & { liveReceipt?: LiveReceipt; deposit?: Paid1v1Deposit; waitingForRival?: boolean }>`
  - `agent.resume1v1(matchId: string, opts?: { liveStrategy?: LiveStrategy }): Promise<MatchView & { liveReceipt?: LiveReceipt }>`

- [ ] **Step 1: Write the failing tests.** Con el árbitro falso de la Tarea 4
  más `liveStart`/`liveCommit` que sirven una partida de Carrera corta (el
  formato de `packages/agent-sdk/test/live-client.test.ts`) y el
  `fakeRpc1v1`.
  - `flujo pagado completo como p1`: el orden de llamadas es `health`,
    `arbiter`, `matchmake`, approve, `matchmake` (el re-pedido, con firma
    nueva), `open`, `liveStart`, commits. `onPaidStep` recibe `seated` y
    después `deposited`. La respuesta trae `deposit.step === "open"`.
  - `re-pedido que cambia a p2 válido adopta la partida nueva`: el segundo
    `matchmake` devuelve otro `matchId` con rol p2, y se transmite `join` sobre
    ese `matchId`. `deposit.reseatedFrom` es el primero.
  - **Review Focus 3.** `re-pedido que cambia a p2 inválido aborta sin
    depositar`: el segundo `matchmake` trae stake 2 en vez de 1. Termina en
    `Paid1v1Error` con stage `"seat"`, y ningún `open`/`join` en
    `broadcasts`.
  - `nunca se re-pide después de mandar`: si el `open` tira después de
    transmitir, el conteo de `matchmake` queda en 2.
  - `asiento de p2 que no verifica se re-pide una vez`: el primer asiento lo
    firma otra llave (rotación) y el segundo la buena. Se espera `join` con el
    segundo `seatSig`. Si los dos fallan, `Paid1v1Error` con stage `"seat"` y
    sin transmitir.
  - `árbitro sin rules en /health revisa las reglas después de emparejar`:
    `/health` sin `rules` y una vista con `rulesV` distinto. Se espera
    `Paid1v1Error` con stage `"seat"`, con 1 `matchmake` y sin transmitir.
  - `partida propia que vuelve, sin jugar`: `matchmake` devuelve una partida
    donde `p1 = yo`, ya en la cadena, y `liveStart` contesta `over: false`. Se
    juega y no se transmite nada.
  - `partida propia que vuelve, ya jugada`: `liveStart` contesta
    `{ over: true }`. Devuelve `waitingForRival: true` y
    `deposit.step === "already"`, sin transmitir ni comprometer jugadas.
  - **Review Focus 2.** `una segunda partida pagada en juego se rechaza sin
    emparejar`: dos `playAndSubmit` pagados a la vez. El segundo tira
    `Paid1v1Error` con stage `"check"` y `matchmake` se llama una sola vez. Un
    `playAndSubmit` con stake 0 en paralelo sí pasa.
  - `live/start reintenta el depósito todavía no visible`: dos respuestas 400
    `no on-chain deposit found…` y después éxito. Un solo intento, y nunca dos
    `liveStart` a menos de 2 s, con reloj falso.
  - **Review Focus 1.** `resume1v1 juega una partida cuyo live/start falló de
    más`:
    - `live/start` falla todo el presupuesto (los 60 s de
      `LIVE_START_RETRY_DELAYS_MS`, con reloj falso). Se espera
      `Paid1v1Error` con stage `"play"`, `deposited: true` y el `matchId`, y
      un mensaje que menciona `resume1v1`.
    - Después `resume1v1(matchId)` juega con `liveStart` OK y sin transmitir
      nada.
  - `resume1v1 sin depósito en la cadena se niega`.
  - `stake 0 sigue sin tocar el RPC`: `fakeRpc1v1.calls` vacío.
- [ ] **Step 2: Run them and see them fail.**

  Run: `node --import tsx --test packages/agent-sdk/test/agent-1v1-play.test.ts`
- [ ] **Step 3: Implementar.**
  - **El orden:** preflight; `matchmake` firmado; verificación; approve si hace
    falta; re-pedido una vez; verificación de nuevo si cambió algo; marca
    "mandado"; depósito; `playLive` con reintentos de `live/start`.
  - **La marca "en juego"** es una variable del cierre de `createAgent`: se
    pone antes de la revisión previa y se saca en un `finally` al terminar el
    intento propio.
  - **Desde "mandado" en adelante**, cualquier error sale como `Paid1v1Error`,
    con el `matchId` y `deposited` leído de la cadena (`depositedRole`).
  - **El plazo de 9 minutos:** si pasaron más de `SEAT_DEPOSIT_WINDOW_MS` desde
    el primer `matchmake`, no se deposita.
- [ ] **Step 4: Run them and see them pass.** Además, toda la carpeta
  `packages/agent-sdk/test`.
- [ ] **Step 5: Commit.** CHANGELOG, en Agregado: "**Un agente juega una mesa
  1v1 de plata en una sola llamada**…".

### Task 6: SDK, `withdraw1v1`, `mintTestUsdc`, `paid1v1Balances` y README

**Files:**
- Modify: `packages/agent-sdk/src/paid1v1.ts`
- Modify: `packages/agent-sdk/src/agent.ts` (el objeto que devuelve)
- Modify: `packages/agent-sdk/README.md`: se reemplazan `:312-319`, entra una
  sección "Paid 1v1 tables" y la nota de versión.
- Modify: `packages/agent-sdk/examples/play-racing-llm.ts:240` (el comentario)
- Test: `packages/agent-sdk/test/agent-1v1-money.test.ts`

**Interfaces:**
- Produces:
  - `agent.withdraw1v1(): Promise<{ amount: bigint; txHash?: `0x${string}` }>`
  - `agent.mintTestUsdc(amountUsdc: number): Promise<{ amount: bigint; txHash: `0x${string}` }>`:
    en 8453 tira
    `mintTestUsdc only works on test networks (84532, 31337): not minting`
    antes de tocar la red.
  - `agent.paid1v1Balances(): Promise<{ chainId: number; usdc: bigint; eth: bigint; owed: bigint }>`

- [ ] **Step 1: Write the failing tests.**
  - `withdraw1v1 sin nada acreditado no transmite`.
  - `withdraw1v1 con acreditado manda un withdraw al pin`.
  - `mintTestUsdc en 8453 se niega sin tocar la red` (`calls` vacío).
  - `mintTestUsdc en 84532 manda mint(yo, unidades) al usdc() del pin`.
  - `paid1v1Balances lee usdc, eth y owed`.
  - Cualquiera de estos sin `paid1v1` tira `/needs paid1v1/`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implementar**, como espejo de `alephWithdraw`
  (`agent.ts:840-885`), contra `paid1v1.escrow`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: README y commit.**
  - El README cubre: la configuración, el ejemplo de la spec, qué juegos, cómo
    se cobra, `resume1v1`, `withdraw1v1`, `mintTestUsdc`, "una wallet
    dedicada por agente, un proceso por wallet" y que `client.matchmake` es la
    salida cruda sin frenos.
  - CHANGELOG.

### Task 7: de punta a punta en anvil (CI)

**Files:**
- Create: `apps/server/src/sdk-1v1-onchain-e2e.ts`, sobre el modelo de
  `apps/server/src/aleph-onchain-e2e.ts`
- Create: `packages/contracts/check-payment-sdk-e2e.sh`, una copia de
  `check-payment-e2e.sh` que corre el archivo nuevo
- Modify: `.github/workflows/ci.yml`: un paso más, después de `:106`, que
  corre `bash packages/contracts/check-payment-sdk-e2e.sh`
- Modify: `packages/agent-sdk/src/paid1v1.ts` (`APPROVE_GAS` y `DEPOSIT_GAS`
  pasan a los valores medidos × 1,5)

**Interfaces:**
- Consumes: `matchRouter` y `healthBody` (Tarea 2), `liveRouter`, y
  `createAgent({ privateKey, paid1v1 })` (Tareas 3 a 6).

- [ ] **Step 1: Write the e2e.**
  - **El servidor:** un `express()` con `matchRouter({ score: noLimit })`,
    `liveRouter`, `GET /health` → `healthBody()`, en el puerto 0, con el
    entorno de `offline-env` que usa `live-sdk-e2e.test.ts`. La compuerta del
    escrow tiene que pasar como en `onchain-e2e.ts`.
  - **El dinero:** se acuña el USDC con el owner, como en
    `aleph-onchain-e2e.ts:294`.
  - **Escenario 1, "gana uno y cobra":** A juega con `defaultLiveStrategy` y B
    con una estrategia que no se mueve nunca. Los dos con stake 1 en
    `"racing"`. A abre y B se une. El árbitro paga: se espera un saldo final
    de A igual a `inicial − 1 + 1,70` USDC y `settleTx` en la vista.
  - **Escenario 2, "empate y reembolso":** los dos con la misma estrategia por
    defecto, misma partida y mismo secreto, así que sacan el mismo puntaje.
    Se espera `refund === "done"` y los saldos de vuelta.
  - **Escenario 3, "ganador en lista negra cobra después":** se pone a A en
    la lista negra (`BlacklistUSDC`) después de que los dos depositaron.
    Después del pago, `owed(A) = 1,70` USDC; se le saca de la lista y
    `withdraw1v1()` cobra.
  - **La medición:** se imprime el gas usado por `approve`, `open` y `join`.
- [ ] **Step 2: Correrlo.** `bash packages/contracts/check-payment-sdk-e2e.sh`.
  Expected: los tres escenarios en OK y el gas impreso.
- [ ] **Step 3: Ajustar** `APPROVE_GAS` y `DEPOSIT_GAS` a lo medido × 1,5 y
  volver a correr las Tareas 4 y 5.
- [ ] **Step 4: Commit.** `docs/TESTING.md`: la fila del e2e nueva.

### Task 8: MCP, `play_paid`, `resume_paid`, `withdraw_1v1`, `mint_test_usdc`

**Files:**
- Modify: `apps/mcp/src/config.ts` (`WalletEnv.paid1v1` y su validación)
- Modify: `apps/mcp/src/index.ts` (pasar `paid1v1` a `createAgent` y
  `paid1v1Enabled` a `buildServer`, y el comentario de cabecera)
- Modify: `apps/mcp/src/tools.ts` (herramientas nuevas y libreta de partidas
  pagadas)
- Modify: `apps/mcp/src/server.ts`: registrar las herramientas, los textos de
  `stake` de `matchmake` y `play_and_submit`, y que la versión salga de
  `package.json` (hoy `"0.6.0"` fijo en `:58`)
- Modify: `apps/mcp/src/present.ts` (`summarizeMatch`: la línea de plata)
- Modify: `apps/mcp/server.json` (las cuatro variables nuevas, y
  `ARCADE_PRIVATE_KEY` descrita sin decir "solo Aleph"; la descripción no puede
  pasar de 100 caracteres)
- Modify: `apps/mcp/README.md`
- Test: `apps/mcp/test/config.test.ts`, `apps/mcp/test/tools-paid.test.ts`
  (nuevo), `apps/mcp/test/server.test.ts`, `apps/mcp/test/manifest.test.ts`,
  `apps/mcp/test/present.test.ts`

**Interfaces:**
- Consumes: `playAndSubmit`, `resume1v1`, `withdraw1v1`, `mintTestUsdc` y
  `paid1v1Balances` (Tareas 5 y 6).
- Produces:
  - En `config.ts`: `WalletEnv.paid1v1?: Paid1v1Config`, leído de
    `ARCADE_1V1_ESCROW_ADDRESS`, `ARCADE_1V1_RPC_URL`, `ARCADE_1V1_CHAIN_ID` y
    `ARCADE_1V1_MAX_STAKE`. Van las cuatro o ninguna, y cualquiera exige
    `ARCADE_PRIVATE_KEY`. El error nombra las variables, no los valores.
  - En `tools.ts`:
    - `export interface PaidLedger { inFlight?: Promise<PaidResult>; undelivered?: PaidResult }`,
      donde `PaidResult` es lo que devuelve `agent.playAndSubmit` con `stake > 0`.
    - `export function createPaidLedger(): PaidLedger`. Guarda la promesa en
      curso y el resultado que todavía no se le entregó al modelo. Un resultado
      cuenta como entregado cuando la herramienta lo devolvió.
    - `playPaidTool(agent, ledger, game, stake, enabled)`
    - `resumePaidTool(agent, matchId)`
    - `withdraw1v1Tool(agent)`
    - `mintTestUsdcTool(agent, amount)`
    - Si `enabled` es falso, todas tiran: `<refused>: paid 1v1 tables are off
      on this MCP server. Its operator has to set ARCADE_1V1_ESCROW_ADDRESS,
      ARCADE_1V1_RPC_URL, ARCADE_1V1_CHAIN_ID and ARCADE_1V1_MAX_STAKE,
      together with ARCADE_PRIVATE_KEY, and restart it. The free ladder
      (stake 0) needs none of them.`
  - Las herramientas:
    - `play_paid {game, stake}`: `destructiveHint: true`,
      `idempotentHint: true`.
    - `resume_paid {matchId}`: `PLAY`.
    - `withdraw_1v1 {}`: `{ ...PLAY, idempotentHint: true }`.
    - `mint_test_usdc {amount}`: `PLAY`; se niega fuera de testnet.
    - Todas con descripción en inglés.
  - `whoamiTool` suma `paid1v1?: { chainId; usdc; eth; owed }`, en
    micro-unidades como strings, cuando está habilitado.

- [ ] **Step 1: Write the failing tests.**
  - `config.test.ts`:
    - `ARCADE_1V1_* van todas o ninguna`;
    - `ARCADE_1V1_* sin ARCADE_PRIVATE_KEY no arranca`;
    - `ARCADE_PRIVATE_KEY sola sigue valiendo`;
    - ninguna repite el valor.
  - `tools-paid.test.ts` (agente real con `fakeRpc1v1` y árbitro falso):
    - `play_paid sin configuración falla cerrado y nombra las variables`;
    - **Review Focus 5.** `play_paid rechaza un stake fuera de tope o de mesa
      sin tocar la red`: stake 5 con tope 2, y stake 3. En los dos casos
      `calls` y el conteo de `matchmake` quedan vacíos;
    - `un error de plata no muestra la URL del RPC`;
    - `reintentar mientras sigue en curso devuelve el mismo resultado`;
    - `un resultado sin entregar se devuelve en el siguiente play_paid` (la
      segunda llamada no empareja);
    - `play_and_submit y matchmake con stake > 0 siguen rechazando`.
  - `server.test.ts`:
    - la lista de herramientas incluye las cuatro nuevas;
    - `play_paid` tiene `destructiveHint: true`;
    - el texto de `stake` de `matchmake` y `play_and_submit` dice
      `/stake 0 only.*play_paid/`.
  - `manifest.test.ts`:
    - las variables nuevas están en `server.json`;
    - la versión de `server.ts` es igual a la de `package.json`.
  - `present.test.ts`: un resumen pagado con `settleTx`, uno con
    `refund: "pending"` y uno con `waitingForRival`.
- [ ] **Step 2: Run them and see them fail.**

  Run: `node --import tsx --test apps/mcp/test/*.test.ts`
- [ ] **Step 3: Implementar.**
  - Los errores de plata pasan por `errorWithoutUrls` (`tools.ts:222-256`).
  - Las herramientas gratis siguen mandando `stake` al SDK, que ya rechaza
    `stake > 0`.
- [ ] **Step 4: Run them and see them pass.** También `npm run build -w apps/mcp`.
- [ ] **Step 5: README y commit.**
  - El README cubre: las variables, la wallet dedicada, el tope obligatorio,
    testnet y mainnet, el orden "`play_paid`, después `get_result`", y que
    reintentar no abre otra partida.
  - CHANGELOG.

### Task 9: web, aviso "tu rival puede ser un agente" y `/agents`

**Files:**
- Modify: `apps/web/app/lib/i18n/en.ts`, `es.ts` y `fr.ts` (claves
  `table.agentNotice` y `match.agentNotice`)
- Modify: `apps/web/app/game/[gameId]/TableClient.tsx`: el aviso va después
  de `table.async` (`:122-124`) y antes del botón, con `<HelpTip k="agent" />`.
- Modify: `apps/web/app/game/[gameId]/match/page.tsx`: el aviso va debajo de
  `match.openHint`/`match.joinHint` (`:1083`), y se actualiza el comentario del
  modo estricto (`:890-894`).
- Modify: `apps/web/app/agents/content.ts`: la viñeta `testnetMainnet` en los
  tres idiomas (en `:144-145`, es `:227-228`, fr `:311-312`).
- Modify: `apps/web/app/agents/page.tsx:146-149` (el comentario del ejemplo
  y un ejemplo pagado corto)
- Test: `apps/web/test/agent-notice.test.ts`, al estilo de
  `apps/web/test/strict-mesa.test.ts`

**Interfaces:** ninguna con otras tareas.

- [ ] **Step 1: Write the failing test.**
  - `el aviso existe en los tres idiomas`.
  - `TableClient y la pantalla de depósito lo muestran`: las dos fuentes
    referencian `t("table.agentNotice")` y `t("match.agentNotice")`.
  - `/agents ya no dice que los agentes juegan solo stake 0`: `content.ts` no
    contiene `Agents play the free ladder (stake 0)`.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implementar.** Textos iniciales; quien lo construye puede
  ajustarlos:
  - en: "Your rival may be an autonomous AI agent. Agents sit at these same tables, deposit the same stake and are verified by replay like everyone else."
  - es: "Tu rival puede ser un agente de IA autónomo. Los agentes se sientan en estas mismas mesas, depositan lo mismo y se verifican por replay como todos."
  - fr: "Votre adversaire peut être un agent IA autonome. Les agents jouent à ces mêmes tables, déposent la même mise et sont vérifiés par replay comme tout le monde."
  - `/terms` y `table.norisk` no se tocan.
- [ ] **Step 4: Run it and see it pass**, junto con `apps/web/test/i18n.test.ts`
  y `npm run typecheck:web`.
- [ ] **Step 5: Commit.** CHANGELOG, en Agregado (web).

### Task 10: documentación transversal y prueba de testnet

**Files:**
- Modify:
  - `AGENTS.md`: se van `:213-217` y `:228`, entra la sección "Paid 1v1 tables
    for agents", se actualizan la lista de herramientas del MCP, `:334`
    (webhook y hosteados siguen gratis), `:341` (el demo crudo) y el estado.
  - `apps/web/public/llms.txt`: `:52-54`, `:107-111`, `:113-128` y
    `:144-145`, más una entrada en "What's new".
- Modify: `docs/CONFIGURATION.md`. Invariantes:
  `ARCADE_1V1_ESCROW_ADDRESS == ESCROW_ADDRESS == NEXT_PUBLIC_ESCROW_ADDRESS`
  y `ARCADE_1V1_CHAIN_ID == CHAIN_ID`. También una sección de variables del
  MCP.
- Modify: `DEPLOY.md`, `docs/REDEPLOY-contratos-v2.md:167-176` y
  `docs/REDEPLOY-escrow1v1-preauditoria.md` (avisar a los operadores que
  actualicen el pin)
- Modify: `docs/MAINNET.md`: la decisión nueva y la nota de C11.
- Modify: `SECURITY.md`: la promesa del lado del agente, extendida al 1v1.
- Modify: `docs/ROADMAP.md` ("v4.2+ — Agentes de IA") y `docs/TESTING.md`
  (que diga 7 pruebas del MCP y las nuevas)
- Modify: `docs/ARCHITECTURE.md`: `alephDeposit` deja de ser "la única
  transacción".
- Modify: `scripts/smoke-1v1-mesa-paga.mts`, reescrito sobre
  `playAndSubmit({ stake: 1 })` con `paid1v1` y `mintTestUsdc`.

- [ ] **Step 1: Buscar lo que quedó viejo**, con
  `grep -rnE "stake: 0\`?\.?\*\*|Use stake 0|cannot fund a USDC table|Phase 1|no las juegan agentes|only transaction" AGENTS.md apps/web/public/llms.txt docs packages/agent-sdk/README.md apps/mcp/README.md`.
  Expected: cada línea encontrada se corrige o se justifica.
- [ ] **Step 2: Editar los archivos de la lista.** Cualquier enlace nuevo a
  arcade1v1.com en `llms.txt` tiene que estar en el sitemap.
- [ ] **Step 3: Verificar.** `node --import tsx --test apps/web/test/seo.test.ts`
  y `npm run check`.
- [ ] **Step 4: Commit.** CHANGELOG, en Cambiado: la documentación.

### Task 11: rebase sobre el #77, versión y publicación

Esta tarea arranca **solo cuando el dueño mergeó el #77** en `main`.

- [ ] **Step 1: Rebasar.** `git fetch origin && git rebase origin/main`, y
  resolver los conflictos de documentación y versiones a favor de lo que trajo
  el #77, sumando lo de este PR. El `[Sin publicar]` de este PR queda arriba
  del `[3.13.0]`.
- [ ] **Step 2: Invaders.** Con el #77 adentro, `isLiveMatch("invaders", RULES_V.invaders)`
  es verdadero. Correr el flujo pagado de la Tarea 5 con `"invaders"` (agregar
  ese caso a `agent-1v1-play.test.ts`).
- [ ] **Step 3: Versiones.**
  - Paquetes a `0.8.0`: `packages/game-sdk`, `packages/strategies`,
    `packages/agent-sdk`, `apps/mcp/package.json` y `server.json`
    (`:10` y `:15`).
  - La app a `3.14.0`: `[Sin publicar]` pasa a `## [3.14.0] — <fecha>`.
  - Los encabezados de versión de `AGENTS.md` y `llms.txt`.
- [ ] **Step 4: Verificar.** `npm run check`,
  `bash packages/contracts/check-payment-e2e.sh`,
  `bash packages/contracts/check-payment-sdk-e2e.sh` y
  `bash packages/contracts/check-aleph-e2e.sh`, todo en OK.
- [ ] **Step 5: Commit, push y PR.** Push y PR con el OK del dueño. El merge lo
  hace el dueño desde GitHub.
- [ ] **Step 6: Producción, después del merge.**
  - `curl -s https://arcade1v1.onrender.com/health` trae `rules` y el `commit`
    del merge.
  - Un `POST /match/<id>/score` sin depósito contesta 400 con el motivo.
- [ ] **Step 7: Publicación y prueba de testnet, las hace el dueño.**
  - Publicar en orden, con 2FA: `node scripts/publish-sdk.mjs game-sdk`, después
    `… strategies`, después `… agent-sdk`, después `(cd apps/mcp && npm publish)`,
    y por último `mcp-publisher publish`.
  - Tag y release `v3.14.0` en GitHub.
  - Correr `scripts/smoke-1v1-mesa-paga.mts` en Base Sepolia.
