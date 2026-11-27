# Agentes en las mesas 1v1 de plata — diseño

> Estado: diseño escrito el 2026-11-27 a partir de una conversación con el
> dueño, que decidió lo siguiente:
>
> 1. Los agentes juegan en las **mismas mesas** de plata que las personas, no en
>    mesas aparte. La web avisa que el rival puede ser un agente.
> 2. El camino es **"todo en una sola llamada"**, que se eligió frente a "pasos
>    separados".
> 3. Por ahora se usan **solo los juegos en vivo**.
>
> Las demás decisiones de este documento las tomé yo, y están marcadas como
> _(decisión mía)_ para que el dueño pueda revisarlas.

## Para qué

El sitio se presenta como pensado para agentes, pero un agente autónomo todavía
no puede jugar una mesa 1v1 de plata (1, 2, 5 o 10 USDC) sin una persona. El SDK
(`@arcade1v1/agent-sdk`) y el MCP (`@arcade1v1/mcp`) rechazan cualquier
`stake > 0` (`assertFreeTable`, `packages/agent-sdk/src/agent.ts:227-235`) y no
mandan el depósito (`open`/`join`) al contrato `Escrow1v1`. La única entrada que
tienen las mesas de plata es la web, con una wallet humana (QR, MetaMask).

El objetivo es que un agente haga todo solo: depositar, jugar y cobrar (o
recibir el reembolso). La única intervención humana que queda es la del
operador, que fondea una vez la wallet dedicada del agente con USDC y ETH para
el gas.

Esto alinea el producto con lo que ya promete: `llms.txt` dice que "humans and
autonomous AI agents stake equal amounts of USDC", y hoy eso no es cierto en el
1v1.

## Lo que ya existe y no hay que tocar

- **Contrato.** `Escrow1v1.open`/`join` acepta cualquier wallet que traiga el
  asiento firmado por el árbitro (`packages/contracts/src/Escrow1v1.sol:271-340`).
  No hace falta cambiar el contrato, y no se cambia: está congelado para la
  auditoría externa (`packages/contracts/AUDIT.md`).
- **Árbitro.**
  - Solo empareja con quien ya depositó (`waiterState`,
    `apps/server/src/matchmaking.ts:736-759`).
  - Saca de la fila al que no abre en 10 minutos (`OPEN_GRACE_MS`) y le da 10
    minutos al segundo jugador para unirse (`JOIN_WINDOW_MS`).
  - Paga al ganador y reembolsa por su cuenta: `kickSettle` y `requestRefund`
    (`matchmaking.ts:1222-1429`).
  - No deja jugar a quien no depositó (`assertDepositOnchain`,
    `matchmaking.ts:1021-1037`).
- **Aleph.** Su mesa de plata ya tiene, en el SDK y el MCP, todo el patrón de
  depósito seguro (`alephDeposit`, `agent.ts:561-838`):
  - la dirección del contrato la fija el operador;
  - el monto queda anclado a lo que eligió el propio agente;
  - el permiso de gasto es exacto;
  - se espera a que el bloque quede sellado;
  - un revert ya minado se detecta;
  - la idempotencia se resuelve leyendo la cadena;
  - sin configuración, falla cerrado.

  Este diseño lo copia para el 1v1.

## Metas

1. Con la configuración del operador, `agent.playAndSubmit({ game, stake })`
   con `stake > 0` revisa, se sienta, deposita, juega y devuelve el resultado
   en **una sola llamada**, igual que hoy con `stake: 0`.
2. El MCP ofrece lo mismo en **una sola herramienta**, para que un modelo de
   lenguaje juegue por plata sin escribir código.
3. Las personas que entran a una mesa de plata leen que **su rival puede ser un
   agente de IA**.
4. El agente puede **retirar** un pago que quedó acreditado en el contrato
   (cuando el USDC rechazó la transferencia) y **retomar** una partida pagada
   si se le cayó el proceso.
5. En testnet, el agente puede **conseguirse USDC de prueba** solo.

## Lo que no se hace (no-metas)

- **Agentes hosteados y de webhook.** Siguen solo en la ladder gratis: sus
  llaves viven en el servidor y `AGENT_STAKE = 0`
  (`apps/server/src/agent-runner.ts:46`). Que el servidor deposite por alguien
  significaría custodiar plata ajena.
- **Juegos con semilla en mesas de plata (2048, Tetris, Snake).** En esos juegos
  el agente recibe la semilla antes de depositar (`matchmaking.ts:1589`) y puede
  simular la partida entera contra una persona que no puede hacerlo. El SDK y
  el MCP los rechazan con `stake > 0`. Cada juego que pase a jugarse en vivo
  queda habilitado solo, sin cambiar código (ver "Qué juegos").
- **Ningún cambio de contrato**, y ningún cambio en la lógica de emparejamiento,
  en los plazos ni en cómo se paga y se reembolsa.
- **No se agrega un endpoint para "soltar el asiento".** El respaldo de 10
  minutos que ya tiene el árbitro alcanza, porque el SDK revisa todo antes de
  sentarse y deposita segundos después _(decisión mía)_.
- **El SDK no hace los reembolsos manuales.** `refundUnfunded`, `refundExpired`
  y `settle` con firma publicada sirven para cuando el árbitro está caído; la
  plata queda segura en el contrato y cualquiera puede dispararlos. Queda como
  trabajo futuro _(decisión mía)_.
- **El servidor no marca a los agentes.** No los distingue de las personas ni
  les pide declarar un modelo en el 1v1. El aviso de la web es genérico ("puede
  ser"), porque un agente que usa su propio código es una wallet más y no se
  puede verificar.
- **No hay presupuesto total por corrida.** El límite total es la wallet
  dedicada que fondea el operador, y por mesa rige el tope obligatorio
  _(decisión mía)_.

## Lo que sería un fracaso aunque funcione (anti-metas)

- Una persona queda emparejada con un agente que nunca deposita o nunca juega.
- Un agente pone más de un stake por partida, aprueba un permiso mayor al stake,
  o le manda plata a un contrato o una red que el operador no fijó.
- Un error filtra la llave privada o la URL del RPC (puede llevar una API key).
- Se rompe algo de lo que hoy funciona con `stake: 0` o en Aleph.

## Qué juegos

Una mesa de plata acepta a un agente solo si el juego se juega **en vivo** con
las reglas vigentes:

- `isLiveMatch(game, RULES_V[game])` de `@arcade1v1/game-sdk/live` es verdadero;
- el árbitro anuncia esa misma versión de reglas (ver `/health` más abajo);
- la vista que devuelve el emparejamiento trae `live: true`.

Hoy eso incluye Flappy y Carrera. Space Invaders entra cuando se mergee y
despliegue el PR #77, sin tocar este código.

## Cómo se ve para quien programa el agente

```ts
import { createAgent } from "@arcade1v1/agent-sdk";

const agent = createAgent({
  arbiterUrl: "https://arcade1v1.onrender.com",
  privateKey: process.env.AGENT_KEY, // wallet dedicada, con USDC y ETH
  paid1v1: {
    rpcUrl: process.env.BASE_RPC_URL,
    escrow: "0x…", // Escrow1v1 que el operador confía
    chainId: 84532, // 8453 en mainnet
    maxStake: 2, // tope por mesa, en USDC (obligatorio)
  },
});

const r = await agent.playAndSubmit({ game: "racing", stake: 1 });
// r: la vista de la partida + { deposit: { step, role, txHash } } + liveReceipt
// El cobro llega solo: agent.getResult(r.matchId) (nuevo) hasta ver settleTx o refund.
```

### API nueva del SDK

- **`createAgent({ paid1v1 })`**, un bloque **aparte** de las opciones de Aleph
  (`rpcUrl`, `escrow`):
  - **Campos:** `{ rpcUrl, escrow, chainId, maxStake, maxFeeBps? }`.
  - **Por qué aparte:** en mainnet el 1v1 corre en Base (8453) y las mesas de
    plata de Aleph siguen en Base Sepolia (84532), según la decisión 6 de
    `docs/MAINNET.md`. Además, `escrow` ya significa EscrowAleph en el SDK, el
    MCP y los errores.
  - **Se valida al crear el agente, sin tocar la red**, y es todo o nada:
    - `escrow`: 0x más 40 hex, distinto de la dirección cero;
    - `rpcUrl`: http o https;
    - `chainId`: uno de 8453, 84532 o 31337;
    - `maxStake`: número finito mayor que 0;
    - `privateKey`: obligatoria (la wallet efímera nunca puede tener USDC);
    - `maxFeeBps`: opcional, por defecto 1500.
  - **Los errores nombran la opción y nunca repiten su valor.** Es el mismo
    criterio que ya usa `agent.ts:189-212`.
- **`playAndSubmit({ game, stake, liveStrategy?, onPaidStep? })`:**
  - Con `stake: 0` se comporta igual que hoy.
  - Con `stake > 0`, hace el flujo completo de abajo.
  - `onPaidStep({ step: "seated" | "deposited", matchId })` le avisa al que
    llama, para que pueda guardar el `matchId` y retomar si se cae.
- **`agent.resume1v1(matchId)`** retoma una partida pagada de esta wallet.
  - Exige que el depósito esté en la cadena.
  - Abre o reanuda el intento en vivo y lo juega hasta el final.
  - El árbitro nunca reinicia un intento: `live/start` devuelve lo ya
    comprometido (`apps/server/src/live.ts:222-285`).
  - Si el depósito no está en la cadena, se niega.
  - Nunca deposita: solo deposita la llamada que se sentó, para que el monto
    sea siempre uno que eligió el propio agente.
- **`agent.getResult(matchId)`** es un atajo nuevo para `client.getMatch(matchId, address)`
  con la dirección del agente. Hoy `createAgent` no lo tiene (`agent.ts:887-897`).
- **`agent.withdraw1v1()`** es el espejo de `alephWithdraw` (`agent.ts:840-885`)
  contra el `Escrow1v1` fijado: lee `owed(me)` y, si es 0, no manda nada.
- **`agent.mintTestUsdc(amountUsdc)`** solo funciona en 84532 y 31337, y en
  8453 se niega antes de tocar la red.
  - Lee el token de `escrow.usdc()` del contrato fijado y llama a `mint`, que
    en el TestUSDC está abierto a cualquiera
    (`packages/contracts/src/TestUSDC.sol:17`).
  - El ETH de gas sigue saliendo de un faucet externo.
- **`agent.matchmake(game, stake > 0)` sigue rechazando**, aunque haya
  configuración. Un asiento de plata sin depósito deja a una persona esperando,
  así que las mesas de plata se juegan solo con `playAndSubmit`. El mensaje
  nuevo apunta ahí. `agent.client.matchmake` queda como la salida cruda sin
  frenos, y se documenta así.
- **`Paid1v1Error`**, con `matchId`, `stage` (`"check" | "seat" | "deposit" | "play"`)
  y `deposited: boolean`.
  - Cualquier falla después de sentarse lleva el `matchId`.
  - Si `deposited` es verdadero, el mensaje dice que hay que llamar a
    `resume1v1(matchId)`: una partida con depósito que no se juega la gana el
    rival por no presentarse.

### Las constantes del contrato, en el game-sdk

Hay un subpath nuevo, `@arcade1v1/game-sdk/escrow1v1`, sin viem, que es el
espejo de `aleph-escrow.ts`. Trae:

- el ABI de lo que usa el agente: `open`, `join`, `matches` con 8 salidas (sin
  `frozenFeeBps`, como en `apps/server/src/abi.ts:137-141`), `arbiter`, `usdc`,
  `feeBps`, `allowedStake`, `owed`, `withdraw` y `mint`, este último solo para
  el TestUSDC;
- el enum de estados;
- los tipos EIP-712 del asiento y `seatDomain(chainId, escrow)`;
- la dirección del USDC de Circle en Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`);
- `stakeToUnits`.

Las copias del ABI que tienen el árbitro y la web se quedan como están. Unificar
las tres copias queda para después, para no tocar más de lo necesario antes de
la auditoría _(decisión mía)_.

## El flujo de una mesa de plata

Todo lo que puede fallar sin gastar se revisa **antes** de sentarse. Así el
agente nunca ocupa el lugar de una persona sabiendo que no va a poder depositar.

### 1. Revisión previa (no se sienta ni manda transacciones)

1. Que `stake` sea mayor que 0 y no supere `maxStake`, que el juego cumpla lo de
   "Qué juegos" y que haya una estrategia en vivo.
2. `GET /health`: que `escrow` sea `"ok"` y que `rules[game]` sea igual a
   `RULES_V[game]`. Si el árbitro es viejo y no publica `rules`, esta revisión
   se hace después del emparejamiento, antes de depositar.
3. En el RPC del operador:
   - `getChainId()` debe ser igual a `paid1v1.chainId`;
   - tiene que haber código en `escrow`;
   - `escrow.arbiter()` debe ser igual a lo que devuelve `GET /arbiter`;
   - el USDC es `escrow.usdc()`, y en 8453 debe ser el de Circle;
   - `feeBps()` no puede superar `maxFeeBps` (es la comisión que queda
     congelada si el agente termina siendo p1);
   - `allowedStake(units)` tiene que ser verdadero.
4. El saldo de USDC tiene que cubrir el stake. El de ETH tiene que cubrir el
   gas estimado de approve más open/join, con margen.
5. No puede haber otra partida pagada **en juego** en este proceso. "En juego"
   va desde que se sienta hasta que termina su propio intento, es decir, hasta
   que `playAndSubmit` devuelve. Una partida ya jugada que espera rival o
   espera el pago no bloquea la siguiente. Aparte, hay un candado por wallet
   que cubre **solo el envío** de cada transacción, hasta su recibo. Lo
   comparten el 1v1 y Aleph para no chocar los nonces, y no bloquea un depósito
   de Aleph mientras se juega una partida 1v1 _(decisión mía)_.

### 2. Sentarse y verificar el asiento (todavía sin transacciones)

1. `POST /matchmake` firmado, con `ts` tomado de `clock()`; hoy usa
   `Date.now()` (`agent.ts:239-244`).
2. Se valida la vista contra lo que eligió el agente:
   - `stake` igual al pedido;
   - `role` es `p1` o `p2`;
   - vienen `seatSig`, `fundDeadline` y `playDeadline`;
   - `live: true` y `rulesV` vigente;
   - los plazos son razonables: `fundDeadline` en el futuro y a no más de 75
     minutos, y `playDeadline` a no más de una cota fija (por ejemplo 6 h) que
     frena a un árbitro mentiroso que quiera trabar la plata hasta los 2 días
     que permite el contrato.

   Si falta cualquiera de esos campos, la mesa no es de plata de verdad (por
   ejemplo, un árbitro sin escrow) y se aborta.

3. **El asiento se verifica localmente** con la firma EIP-712 (`seatDomain` con
   el `chainId` y el `escrow` fijados por el operador). El firmante tiene que
   ser `escrow.arbiter()`. Es la única prueba, independiente del árbitro, de que
   se le está por pagar al contrato y a la red correctos: la vista 1v1 no trae
   ni dirección ni red.
4. Se lee `matches(id)` en la cadena:
   - p1: `status` `None`. Si `p1 == yo`, el depósito ya está (ver el punto 7).
   - p2: `status` `Open`, el stake igual, `p1 != yo`, los plazos guardados
     iguales a los de la vista, y que falten al menos 60 s de tiempo de cadena
     para `fundDeadline`. La web revisa menos: solo `Open`, el stake y el plazo
     con el reloj local (`apps/web/app/lib/useEscrow.tsx:92-98, 212-215`). El
     agente es más estricto.
   - p2, comisión: `frozenFeeBps` (la novena salida de `matches`, que quedó
     fija cuando el p1 abrió) no puede superar `maxFeeBps`. Se lee con un
     fragmento de ABI aparte. Si el contrato no tiene ese campo, se usa
     `feeBps()` como respaldo _(decisión mía)_.
5. Si el asiento de un p2 no se verifica (por ejemplo, porque se rotó la llave
   del árbitro), se vuelve a pedir **una vez**. El árbitro le devuelve la misma
   partida firmada de nuevo (`matchmaking.ts:623-642`). Si sigue mal, se aborta.
6. Si se aborta en este paso no se pierde plata. Un p1 sin abrir sale solo de la
   fila a los 10 minutos. Un p2 que no se une libera el lugar de la persona en
   10 minutos, igual que hoy cuando una persona cierra la pestaña.
7. **Una partida propia que vuelve.** Si el agente ya abrió una partida en esta
   misma mesa (mismo juego y stake) y sigue esperando rival, el árbitro le
   devuelve esa misma partida (`matchmaking.ts:649-652`). Entonces no se
   deposita de nuevo:
   - si su intento no terminó (por ejemplo, porque se cayó el proceso), se
     juega; es una reanudación;
   - si ya terminó (`live/start` contesta `over`, `live.ts:254-258`), se
     devuelve la vista tal cual, con `deposit.step: "already"` y
     `waitingForRival: true`, sin jugar ni gastar nada.

   En la práctica, cada agente tiene como mucho una partida esperando rival por
   mesa: para jugar otra en paralelo tiene que elegir otra mesa u otro juego.

### 3. Depositar

1. **Permiso exacto:** si el `allowance` hacia el escrow fijado no alcanza, se
   hace un `approve(escrow, units)` exacto, nunca infinito. Un permiso sobrante
   se reusa.
2. **Pedir de nuevo justo antes de depositar.** Como hace la web
   (`apps/web/app/game/[gameId]/match/page.tsx:603-703`), se firma un
   emparejamiento nuevo y se pide otra vez **una sola vez**, antes de cualquier
   depósito.
   - Si el árbitro ahora lo sienta como p2 de alguien que ya abrió (porque su
     `open` todavía no se veía), se adopta esa partida y se repite el paso 2.
   - La espera vieja, que nunca se abrió, vence sola sin plata de por medio.
3. **Se marca "mandado" antes de transmitir.** Desde ese momento no se vuelve a
   pedir emparejamiento. Si un p1 vuelve a pedir mientras su `open` todavía no
   se ve, el árbitro puede sentarlo en otra partida y terminaría con dos
   depósitos (`matchmaking.ts:649-679`).
4. **El depósito:**
   - p1 manda `open(id, units, fundDeadline, playDeadline, seatSig)`;
   - p2 manda `join(id, seatSig)`.

   Igual que en `alephDeposit`, se simula, se estima el gas × 5/4, se espera el
   recibo, se espera a que el bloque quede sellado (`waitUntilSealed`) y se
   exige que el recibo diga `success`.

5. **Las carreras se resuelven leyendo la cadena, no adivinando.**
   - Un `match exists` con `p1 == yo` significa que el depósito ya está.
   - Un `not open` con `p2 == yo`, también.
   - Un `not open` con otro p2 es una carrera perdida: el error es claro y solo
     se perdió el gas.
   - Al terminar, se relee `matches(id)` para confirmar.
6. **No se deposita en el borde.** Si desde que se sentó pasaron más de
   10 minutos menos 60 segundos, no se deposita. Pasado ese plazo, el árbitro
   ya pudo sacar al p1 de la fila (`OPEN_GRACE_MS`) o darle el lugar del p2 a
   otro (`JOIN_WINDOW_MS`). Con todo en segundos no debería pasar nunca, pero
   igual se frena.

### 4. Jugar

1. `live/start` firmado. El árbitro lee el depósito con **su propio** RPC, que
   puede ir atrasado aunque el bloque ya esté sellado. La prueba en testnet ya
   necesitaba reintentar (`scripts/smoke-1v1-mesa-paga.mts:202-213`).
2. Reintentos acotados: solo si la lectura del propio agente ya mostró el
   depósito, y solo ante `no on-chain deposit found for this address in this match`
   o `could not verify your deposit on-chain`. La espera va creciendo (2, 4, 8,
   8, 8 s), con un máximo de unos 60 s en total y no más de un pedido cada 2 s,
   porque `live/start` está bajo el límite de 12 pedidos cada 10 s.
3. Después sigue el juego en vivo que ya existe (`playLive`, `agent.ts:303-375`),
   con sus reanudaciones y su `liveReceipt`.

### 5. Cobrar

- **Ganar y recibir reembolsos es pasivo:** el árbitro presenta `settle` o
  `cancelMatch` por su cuenta. El agente lee `GET /match/:id` hasta ver
  `settleTx`, `settleOutcome` o `refund: "done" | "none"`.
- **Un p1 que juega antes que exista rival** recibe la vista en `waiting`. Si no
  aparece nadie en 1 hora, el árbitro le devuelve el stake.
- **Pago acreditado:** si el USDC rechazó la transferencia (lista negra de
  Circle o token en pausa), lo pagado queda acreditado en `owed(me)` y se cobra
  con `withdraw1v1()`.
- **La partida se busca con `getResult(matchId)`, no con un emparejamiento
  nuevo.** Pedir emparejamiento solo devuelve la misma partida a un p1 que
  sigue esperando rival en esa mesa (`matchmaking.ts:649-652`). En los demás
  casos (un p2, o un p1 ya emparejado) crea otra o lo sienta en otra
  (`matchmaking.ts:627-683`).

## Cambios en el árbitro (chicos)

1. **Una falla actual en los errores.** Le pasa también a la web, no solo a los
   agentes.
   - Hoy, `no on-chain deposit found…` y `could not verify your deposit on-chain…`
     en `POST /match/:id/score` no coinciden con `ERRORES_ESPERABLES`
     (`apps/server/src/index.ts:96-115`), así que se contestan como
     `500 internal error` y se pierde el motivo. Lo mismo pasa con `not a player`
     y `too many failed verifications for this match`.
   - En `live/start`, los dos mensajes de depósito salen como `400` (`LiveError`).

   El arreglo:
   - una clase tipada, `DepositUnverifiedError`, que lanza `assertDepositOnchain`
     cuando falla la lectura de la cadena. En las dos rutas se contesta `503` con
     `Retry-After`, porque no se procesó nada y el cliente del SDK ya reintenta
     los 503;
   - `no on-chain deposit found…`, `not a player` y `too many failed verifications…`
     pasan a `400` con su texto.

   **Los textos no cambian.** Hoy nadie los compara, pero el SDK nuevo los va a
   usar para decidir cuándo reintentar, y desde entonces pasan a ser parte del
   contrato entre el árbitro y el SDK. Hay que revisar también cómo trata la web
   un 503 en `live/start`, que hoy recibe 400.

2. **`GET /health` publica `rules: RULES_V`**, para que el agente revise la
   versión de reglas antes de sentarse.
3. **El agente de ejemplo en HTTP crudo** (`apps/server/src/agent.ts:66-72`,
   enlazado desde `AGENTS.md`) hoy se empareja con stake 5 sin firma ni
   depósito. Pasa a stake 0, con una nota que apunta al flujo de plata.

No se cambian ni el emparejamiento ni los plazos, y no hay ningún endpoint
nuevo.

## MCP

- **Variables de entorno nuevas, separadas de las de Aleph:**
  - `ARCADE_1V1_ESCROW_ADDRESS`
  - `ARCADE_1V1_RPC_URL`
  - `ARCADE_1V1_CHAIN_ID`
  - `ARCADE_1V1_MAX_STAKE` (obligatoria)

  Las cuatro `ARCADE_1V1_*` van todas o ninguna. Si hay al menos una, también
  se exige `ARCADE_PRIVATE_KEY`, que se comparte con Aleph. `ARCADE_PRIVATE_KEY`
  sola sigue siendo válida, como hoy, para Aleph o para tener una identidad
  fija. Si la configuración del 1v1 está incompleta, el servidor no arranca y
  el error nombra las variables que faltan, sin mostrar valores. Sin ellas, las
  mesas 1v1 de plata quedan apagadas. Se valida con las
  mismas reglas de `apps/mcp/src/config.ts:21-90`. El RPC del 1v1 no hereda
  `RPC_URL`, para no terminar usando sin darse cuenta el RPC de testnet de Aleph
  _(decisión mía)_.

- **Herramienta nueva `play_paid { game, stake }`:** hace el flujo completo en
  una sola llamada.
  - Va con `destructiveHint: true` (mueve plata), como `aleph_deposit`. Si el
    cliente MCP pide confirmación, la pide **antes** de sentarse, así que nunca
    hay una persona esperando mientras alguien aprueba.
  - **Reintentar no abre una partida nueva.** Aprobar, depositar, esperar el
    bloque y jugar puede tardar más que el tiempo de espera del cliente MCP.
    Por eso, dentro de una misma corrida del servidor:
    - si una llamada anterior sigue en curso, `play_paid` espera ese mismo
      resultado y lo devuelve (`resumed: true`);
    - si una llamada anterior terminó pero su resultado nunca le llegó al
      modelo, el siguiente `play_paid` devuelve ese resultado pendiente
      (`resumed: true`) en vez de jugar. Para jugar otra partida, el modelo
      vuelve a llamar.

    Además, la mesa misma frena un segundo depósito cuando el agente es un p1
    que espera rival (ver el punto 7 del paso 2). _(decisión mía)_

- **`resume_paid { matchId }`**, **`withdraw_1v1 {}`** y, solo en testnet,
  **`mint_test_usdc { amount }`**: envuelven lo mismo del SDK.
- **`matchmake` y `play_and_submit` siguen siendo solo gratis.** Su texto de
  `stake` pasa a decir "solo 0; para plata, `play_paid`".
- **`get_result`** suma una línea de plata: qué se depositó, si espera rival,
  si el pago o el reembolso están pendientes o hechos, y cuánto se ganó o perdió
  en USDC. **`whoami`** muestra la red del 1v1, el saldo de USDC y ETH y lo
  acreditado.
- **Los errores de las herramientas de plata pasan por `errorWithoutUrls`**
  (`apps/mcp/src/tools.ts:222-256`), para que viem no le muestre al modelo la
  URL del RPC.
- **Descripciones en inglés**, como las de Aleph (es lo que lee el modelo).
- **`server.json`:** las variables nuevas van con su descripción, y la
  descripción general no puede pasar de 100 caracteres.

## Web

- **Aviso** "Tu rival puede ser un agente de IA autónomo", en dos lugares:
  - en la elección de mesa de plata (`apps/web/app/game/[gameId]/TableClient.tsx`,
    antes del botón);
  - en la pantalla de depósito (`match/page.tsx`, junto a `match.openHint` y
    `match.joinHint`).

  Va en inglés, español y francés (`apps/web/app/lib/i18n/{en,es,fr}.ts`; una
  prueba exige que estén los tres). Puede enlazar a `/agents` o a la ayuda de
  "agente".

- **`/agents`** (`apps/web/app/agents/content.ts`, en los tres idiomas, y el
  ejemplo de `page.tsx:146-149`) deja de decir "Agents play the free ladder
  (stake 0)".
- **No se cambian** los términos (`/terms`, congelados para lo legal, que ya
  dicen "player (or agent) skill") ni la frase "Cero riesgo" de `table.norisk`,
  que se refiere al reembolso cuando no aparece rival _(decisión mía)_.
- Se actualiza el comentario del modo estricto de las mesas de plata
  (`match/page.tsx:890-894`), que daba por hecho que el cliente siempre es un
  navegador.

## Documentación y versión

Siguiendo la regla del proyecto, todo va en el mismo PR:

- **CHANGELOG**, en `[Sin publicar]`.
- **`AGENTS.md`**: se van el bloque "Use `stake: 0`" y la línea "Phase 1",
  entra una sección "Paid 1v1 tables for agents", y se actualizan la lista de
  herramientas del MCP y el estado.
- **`llms.txt`**: líneas 52-54, 107-111 y 144-145, más la lista de
  herramientas. Cualquier enlace nuevo a arcade1v1.com tiene que estar en el
  sitemap.
- **README del SDK y del MCP**, con una sección de mesas de plata y la nota de
  versión. También el comentario de `examples/play-racing-llm.ts:240`.
- **README del game-sdk**, por el subpath nuevo.
- **`docs/ARCHITECTURE.md`**: `alephDeposit` deja de ser "la única transacción
  que manda un agente".
- **`docs/CONFIGURATION.md`**: invariante nueva,
  `ARCADE_1V1_ESCROW_ADDRESS == ESCROW_ADDRESS == NEXT_PUBLIC_ESCROW_ADDRESS`,
  y `ARCADE_1V1_CHAIN_ID == CHAIN_ID`.
- **`DEPLOY.md`, `docs/REDEPLOY-contratos-v2.md` y
  `docs/REDEPLOY-escrow1v1-preauditoria.md`**: en cada redeploy de `Escrow1v1`
  hay que avisar a los operadores de agentes que actualicen el pin. Hasta que lo
  hagan, la verificación del asiento falla y no se mueve plata.
- **`docs/MAINNET.md`**:
  - una decisión nueva: los agentes depositan USDC real en las mismas mesas,
    solo en juegos en vivo;
  - una nota: los filtros de la web antes de depositar (C11) no aplican a un
    agente que deposita desde su propio código.
- **`SECURITY.md`**: la promesa del lado del agente (pin, red fijada, asiento
  verificado, permiso exacto, monto anclado) se extiende al 1v1.
- **`docs/TESTING.md`** (además, corregir el conteo de pruebas del MCP, que dice
  6 y son 7) y **`docs/ROADMAP.md`**.

**Versión:** va **después de que se mergee el #77** (Invaders en vivo, 3.13.0,
paquetes 0.7.0). El #77 toca unos 25 de los mismos archivos (documentación,
READMEs, `server.json`, `server.ts`, versiones), así que el trabajo se apila
sobre su rama o se rebasa cuando se mergee. Sale como app 3.14.0 y paquetes
0.8.0, los cuatro juntos,
porque el game-sdk trae el subpath nuevo. Primero se despliega el árbitro (Render
lo hace solo con el merge), y se verifica en producción que `/health` traiga
`rules` y que los errores de depósito contesten 400 o 503. Después se publica en
orden: game-sdk, strategies, agent-sdk, mcp y mcp-publisher. Publicar lo hace el
dueño, con 2FA. El SDK funciona igual contra un árbitro que todavía no publica
`rules`.

## Pruebas

- **SDK, unitarias:**
  - Un árbitro falso que sirve vistas de p1 y p2 con asientos firmados por una
    llave de prueba sobre el dominio EIP-712 real.
  - Un RPC falso para el 1v1, en un archivo aparte de `fake-rpc.ts`, que hoy
    comparten las pruebas de Aleph del SDK y del MCP.

  Qué se prueba:
  - cada falla de la revisión previa: cero pedidos de emparejamiento y cero
    transmisiones;
  - un árbitro mentiroso después de sentarse (stake distinto, asiento ajeno, otra
    red, plazos absurdos, `live` falso): cero transmisiones;
  - el camino feliz de p1 (approve exacto y después `open` con los plazos de la
    vista) y el de p2 (revisión de la cadena, approve y `join`);
  - la rotación de llave;
  - la carrera perdida;
  - la idempotencia;
  - que no se vuelva a pedir emparejamiento después de "mandado";
  - el recibo preconfirmado;
  - los reintentos de `live/start`;
  - `resume1v1`, `withdraw1v1` y `mintTestUsdc`, este último negándose en 8453;
  - que la prueba que hoy exige el rechazo de las mesas de plata
    (`packages/agent-sdk/test/agent.test.ts:68-81`) se reescriba: sin
    configuración y con `matchmake` sigue rechazando.

- **Árbitro:** las rutas de verdad sobre HTTP. Los errores de depósito contestan
  400 o 503 (con `Retry-After`) en `/score` y en `live/start`, y `/health` trae
  `rules`.
- **MCP:**
  - configuración todo o nada, sin mostrar valores;
  - `play_paid` falla cerrado sin configuración, respeta el tope y oculta las
    URLs;
  - reintentar tras un corte devuelve la misma partida;
  - las herramientas gratis siguen rechazando `stake > 0`;
  - las anotaciones y la versión de `server.ts` coinciden con `package.json`.
- **De punta a punta en anvil** (CI, trabajo "Contrato (forge test + e2e)"),
  sobre el modelo de `aleph-onchain-e2e.ts`. Dos `createAgent({ privateKey, paid1v1 })`
  juegan Carrera con stake 1 por HTTP contra las rutas reales: uno abre, el otro
  se une, los dos juegan, el árbitro paga y se revisan los saldos. También:
  - un empate termina en reembolso;
  - un ganador en lista negra queda con el pago acreditado y lo cobra con
    `withdraw1v1()`.

  Ahí se mide el gas de `open` y `join` para fijar el margen de ETH de la
  revisión previa.

- **Web:** el aviso aparece en la mesa de plata y en el depósito, en los tres
  idiomas.
- **Testnet (lo corre el dueño):** `scripts/smoke-1v1-mesa-paga.mts`, reescrito
  sobre `playAndSubmit` con plata.

## Riesgos que quedan

- **Mainnet y lo legal:** un agente que deposita desde su propio código no pasa
  por los filtros de la web (edad, país, términos). Queda anotado en
  `docs/MAINNET.md`; no lo resuelve este cambio.
- **RPC del árbitro atrasado:** si el RPC público tarda más de lo que cubren los
  reintentos, el agente recibe `Paid1v1Error` con `deposited: true` y retoma con
  `resume1v1`. El arreglo de fondo es que el árbitro tenga su propio RPC, algo
  que ya está anotado antes de mainnet.
- **Errores distintos en mainnet:** el USDC de Circle revierte con mensajes de
  texto y el TestUSDC con errores tipados. Los mensajes del SDK se validan sobre
  todo en testnet.
- **Más gas para el árbitro:** con agentes jugando, el árbitro paga más
  cancelaciones y liquidaciones, así que hay que vigilar su saldo
  (`gas-monitor`).
- **Un agente con código propio** sigue pudiendo hacer lo mismo que hoy, por
  ejemplo jugar con semilla en mesas de plata. Este cambio no lo empeora; solo
  evita que las herramientas oficiales lo vuelvan el camino fácil.

## Qué decide quien lo construya

- Los nombres exactos de los tipos internos y de los archivos nuevos.
- La cota fija de `playDeadline` y el margen de ETH (sale de medir el gas en el
  e2e).
- Cómo se reparte el código nuevo dentro de `agent.ts` (un archivo aparte es
  razonable).
- El texto exacto del aviso en los tres idiomas y dónde va el enlace.
- El orden de los commits dentro del PR.
