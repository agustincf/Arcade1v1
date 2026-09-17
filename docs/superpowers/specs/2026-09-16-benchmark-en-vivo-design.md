# Benchmark en vivo — diseño (piloto: Flappy)

**Fecha:** 2026-09-16
**Estado:** diseño aprobado por el dueño; falta el plan de implementación.
**Encuadre:** cierra el flanco abierto #1 de la auditoría del 2026-08-09, "el
flanco del benchmark". El cambio de pestaña ya se cerró en las mesas de plata
(PR #5). Este diseño ataca la otra mitad: que una partida no se pueda conocer
entera antes de jugarla.

---

## Problema

Hoy `matchmake` le entrega la semilla al jugador antes de jugar
(`MatchView.seed`, `apps/server/src/matchmaking.ts`). Los seis motores son
determinísticos a partir de `mulberry32(seed)` y están publicados en npm
(`@arcade1v1/game-sdk` 0.3.0). Entonces un agente puede simular la partida
entera en su máquina, buscar la mejor secuencia de jugadas y mandar solo esa,
dentro de los `SUBMIT_WINDOW_MS` (2 h). El ranking mide cuánto cómputo pone
cada uno para buscar, no qué tan bien decide. Un humano no puede competir con
eso, y el roadmap promete un "benchmark de IA en vivo" y, más adelante,
reputación on-chain construida sobre ese ELO.

No es un bug suelto: en el modelo asincrónico el primero en llegar juega antes
de que exista rival, así que necesita la semilla antes. La auditoría ya probó
que acortar la ventana no sirve: se optimiza mientras se espera, y además
rompería a los agentes de la casa, que reciben la semilla y juegan recién con
el rival sentado (`agent-runner.ts`).

---

## Decisiones del dueño (2026-09-16)

1. **El ranking mide decidir en vivo.** Nadie ve más adelante de lo que vería un
   humano mirando la pantalla.
2. **Sin límite de tiempo por tramo, por ahora.** Se puede pensar lo que se
   quiera entre revelado y revelado, dentro de la ventana de 2 h que ya existe.
   El diseño deja lugar para sumar un límite después.
3. **Enfoque: revelado progresivo con compromiso.** Se descartó que el árbitro
   corra la partida en el servidor: más costo en Render, lag en los juegos
   rápidos y la reescritura más grande.
4. **Piloto: Flappy.** Los otros cinco juegos siguen como hoy hasta migrarlos
   de a uno, cada uno con su propio plan.

---

## Qué es, en ocho líneas

1. Flappy pasa a ser un juego **en vivo** (reglas v2). La física no cambia ni
   una línea.
2. `matchmake` ya no entrega la semilla de Flappy. El árbitro la guarda hasta
   que la partida se decide.
3. Para jugar, el jugador abre un **intento** con una firma. El intento es
   único: no se reinicia.
4. El juego sigue corriendo en el navegador o en el agente, pero el azar llega
   de a poco. La altura de cada tubo se recibe 15 ticks (0,25 s) antes de que
   el tubo aparezca (el primero es una excepción: ver los riesgos aceptados).
5. Para recibir lo que viene, primero se **comprometen** las jugadas hechas.
   Ese registro solo crece: lo que ya pasó no se reescribe.
6. El árbitro simula a la par con las jugadas comprometidas. Cuando el pájaro
   muere ya tiene el puntaje, así que no hay "enviar" al final.
7. Al decidirse la partida se publica la semilla, y cualquiera re-verifica con
   `verifyFlappy`, como hoy.
8. Se despliega en tres PR: la base apagada, los clientes apagados, y el
   interruptor el mismo día que se publica en npm.

---

## Reglas del intento

### Abrir

`POST /match/:id/live/start` con `{ address, signature, ts }`.

- La firma es sobre `liveStartAuthMessage(matchId, address, ts)`, un mensaje
  nuevo en `packages/game-sdk/src/auth.ts`, válido por `MATCHMAKE_AUTH_TTL_MS`.
  Se exige con la misma política que el resto (`AUTH_REQUIRED`).
- Solo pueden abrir `p1` o `p2` de esa partida, con la partida sin decidir y sin
  vencer.
- En una mesa de plata se hace acá el control de depósito on-chain que hoy hace
  `submitScore` (`readMatchOnchain` + `razonRechazoDeposito`): no se abre un
  intento sin depósito.
- Si el intento no existe, se crea. Si ya existe, **no se reinicia**: se
  devuelve el mismo, con un token nuevo que invalida el anterior. Así una
  recarga del navegador puede retomar, y un token viejo robado deja de servir.
- Respuesta: `{ token, tick, flaps, reveal }`. `tick` y `flaps` son lo ya
  comprometido y `reveal` son todos los valores revelados hasta ahora, en orden
  de consumo. Con eso el cliente reconstruye el motor y sigue.

### Comprometer y recibir

`POST /match/:id/live/commit` con
`{ address, token, from, to, flaps, have, final? }`.

- `from` es el último tick comprometido que el cliente cree que tiene el
  árbitro. Si no coincide, responde 409 con `{ tick, revealed, reveal }` y el
  cliente reenvía desde `tick`. Cubre dos casos: la caída del árbitro (perdió
  compromisos) y un reintento cuya respuesta se perdió (el árbitro ya lo había
  aplicado).
- `have` es cuántos valores revelados tiene el cliente. **Toda respuesta**, la
  de éxito y la 409, trae en `reveal` los valores desde `have` hasta `revealed`.
  Así perder una respuesta no obliga a volver a abrir el intento, que en la web
  pediría otra firma de la wallet. Mandar un `have` más bajo solo repite valores
  que ese jugador ya recibió.
- Topes: `from < to ≤ from + MAX_COMMIT_TICKS` (3600, un minuto de juego) y
  `to ≤ MAX_REPLAY_TICKS`. `flaps` va en ticks absolutos, estrictamente
  creciente y dentro de `[from, to)`.
- La semántica es la de `verifyFlappy`: en cada tick `t`, si `t` está en
  `flaps` aletea, y después `update(FLAPPY_DT)`. Al morir se corta.
- El árbitro avanza su motor de `from` a `to`.
  - **Si el pájaro murió**, o vino `final: true`, o se llegó a
    `MAX_REPLAY_TICKS`: el intento termina. Se guarda
    `m.scores[address] = score` y `m.replays[address] = { ticks, flaps, v: 2 }`,
    se llama a `settleIfReady`, y responde `{ tick, over: true, score }`.
    `final` reemplaza al `ticks` que hoy elige el cliente en su replay: parar
    antes nunca suma puntaje, así que no da ventaja.
  - **Si sigue vivo:** revela los valores que el motor va a consumir hasta
    `to + LIVE_LEAD_TICKS` (15) si nadie más aletea, y responde
    `{ tick, over: false, reveal, revealed }`. `revealed` es el total revelado,
    para que el cliente detecte un desfase.
- Comprometer más allá del próximo tubo sin conocer su altura está permitido:
  esas jugadas quedan fijas igual y no dan información extra.

### Rendirse y abandonar

- **Rendición.** La web y el runner ya se rinden con `submitScore` con puntaje
  0 y un replay vacío. En un juego en vivo, `submitScore` acepta **solo** esa
  forma (puntaje 0, sin aleteos, `v: 2`, sin semilla): cierra el intento con 0,
  y lo crea si no existía. Cualquier otro envío a un juego en vivo se rechaza
  con `flappy is live: play through /match/:id/live/start and /live/commit`.
- **Abandono.** Un intento abierto que no terminó no suma. Al vencer la ventana,
  la partida sigue el camino de hoy (el barrendero la da por empate y
  reembolsa). Es lo mismo que pasa hoy al cerrar la pestaña.

### Lo que ve cada uno

- `MatchView` suma `live: true` y **omite `seed`** en juegos en vivo mientras la
  partida no esté `settled` o `draw`.
- `GET /match/:id/replay` no cambia: sigue devolviendo solo partidas decididas,
  con la semilla, así que cualquiera re-verifica.
- La notificación a un agente BYO por webhook de un juego en vivo va **sin
  `seed`** y con `live: true`.
- El anti-espionaje de puntajes no cambia.

---

## Por qué alcanza, y qué no cubre

- **Mirar y reiniciar:** el intento es único y `start` nunca lo resetea.
- **Mirar lejos comprometiendo sin jugar:** las jugadas quedan fijas. Sin
  aletear, el pájaro cae y muere en alrededor de un segundo. El árbitro revela
  según su propio estado en `to`, nunca más de 15 ticks adelante.
- **Exactitud del margen:** en Flappy el horario de tubos no depende de los
  aleteos. La velocidad depende del puntaje, y el puntaje solo de la posición
  de los tubos contra `BIRD_X`. Por eso "cuántos valores se consumen en los
  próximos 15 ticks" se calcula exacto sin conocer las jugadas futuras.
- **Suplantación:** el token es por intento y solo lo recibe quien firmó. Se
  guarda hasheado (sha256), se compara en tiempo constante y rota en cada
  `start`.
- **Agentes de la casa:** juegan con el mismo protocolo, en proceso. Nunca leen
  la semilla guardada, y hay un test que lo fija.
- **Riesgo aceptado 1, caída dura del árbitro.** La persistencia agrupa
  escrituras cada 20 s (`PERSIST_DEBOUNCE_MS`). Si el proceso muere de golpe,
  se pueden perder hasta 20 s de compromisos; un redeploy no, porque hace flush
  al recibir SIGTERM. Con la resincronización, el jugador podría reenviar
  distintas esas jugadas perdidas, habiendo visto hasta 20 s de revelados.
  Hacer flush en cada compromiso subiría el blob entero de partidas por cada
  tubo, y eso ya fundió la cuota de ancho de banda de Render. Se acepta:
  requiere una caída que el jugador no controla.
- **Riesgo aceptado 2, el margen:** se conoce la altura de un tubo 0,25 s antes
  de verlo. Es mínimo comparado con conocer la partida entera.
- **Riesgo aceptado 3, el primer tubo:** el motor crea el primer tubo al
  construirse, fuera de pantalla (`WIDTH + 80`), y los tubos no se mueven hasta
  el primer aleteo. Por eso su altura se revela al abrir el intento y se puede
  mirar antes de arrancar. Es un solo tubo. Evitarlo obligaría a cambiar cuándo
  nace ese tubo, o sea la física, y este piloto no la toca.
- **No cubre:**
  - el tiempo de pensar entre tramos (decisión del dueño);
  - los otros cinco juegos;
  - contar como derrota un intento abandonado.

---

## Arquitectura

### Motor: `packages/game-sdk`

- **`RandomSource`** (`{ next(): number }`): `FlappyEngine` acepta
  `seed | RandomSource`. Con una semilla usa `mulberry32(seed)` como hoy:
  `verifyFlappy` y todos los usos actuales no cambian.
- **`BufferedRandom`**, en el subpath nuevo `@arcade1v1/game-sdk/live`: una
  fuente alimentada con los valores revelados. Informa cuántos le quedan y tira
  `NeedsReveal` si se le pide uno que no llegó.
- **`FlappyEngine.drawsWithin(ticks)`:** cuántos valores consumirían los
  próximos `ticks` sin aleteos. Simula solo el horario de tubos sobre una copia
  y sin tocar el motor. Respeta el estado: sin el primer aleteo los tubos no se
  mueven (da 0), y con la partida terminada tampoco se consume nada. No mira la
  altura del pájaro, que no afecta a los tubos. Lo usan el árbitro para revelar
  y el cliente para saber cuándo comprometer.
- **Constantes en `live`:** `LIVE_LEAD_TICKS = 15` y
  `MAX_COMMIT_TICKS = 3600`.
- **Interruptor:** `LIVE_SINCE_RULES_V = { flappy: 2 }` más
  `isLiveMatch(game, rulesV)`. `RULES_V.flappy` pasa de 1 a 2 **recién en el
  PR 3**.
- **`runLive`:** un driver genérico para quien juega sin bucle de tiempo real
  (el SDK y el runner). Recibe el motor, la fuente, una decisión por tick y una
  función `commit`, y se encarga de cuándo comprometer, de la resincronización
  y del cierre.

### Árbitro: `apps/server`

- **`live.ts`** (nuevo): `liveStart` y `liveCommit`.
  - El estado vive en el `Match` como
    `live?: Record<address, LiveAttempt>`, con
    `LiveAttempt { tokenHash, startedAt, tick, flaps, revealed, over?, score? }`.
    Se persiste con la partida.
  - Una caché de motores en memoria por intento: se borra al terminar o vencer
    el intento y se reconstruye repitiendo el registro después de un reinicio.
- **`matchmaking.ts`:**
  - `view()` omite la semilla y marca `live`.
  - `submitScore` acepta solo la rendición en un juego en vivo.
  - Las partidas creadas con las reglas viejas quedan en el corte seco que ya
    existe ("rules version mismatch").
- **`index.ts`:** las dos rutas nuevas, con un limitador propio `RL_MAX_LIVE`
  (default 60 cada 10 s). El estricto, de 12 cada 10 s, se queda corto si hay
  varios jugadores detrás de la misma IP. También se agregan al índice de la API.
- **Agentes BYO:** `POST /agents/:id/live/start` y `/agents/:id/live/commit`,
  autenticados con el secreto del webhook. Llaman a las mismas funciones con la
  dirección del agente; el secreto ya prueba el control, así que no hace falta
  firma de wallet. Cambia el payload de la notificación y se actualizan sus
  docs. El plazo de 10 min (`WEBHOOK_PLAY_DEADLINE_MS`) pasa a contar hasta
  terminar el intento. Al vencer: si el agente nunca abrió el intento, se rinde
  con 0 como hoy; si lo dejó abierto, el runner lo cierra con `final` en el
  último tick comprometido y cuenta el puntaje alcanzado.
- **Agentes de la casa:** `agent-runner.ts` juega los juegos en vivo con
  `runLive` y la decisión por tick de la estrategia, en proceso y sin HTTP.
  Firma la apertura con la clave del agente, como hoy firma el puntaje. La
  rendición no cambia.

### Estrategias: `packages/strategies`

- `StrategyDef` suma un `step(params)` opcional que devuelve
  `{ decide(engine, tick): boolean }`.
- `flappy.threshold` lo implementa con la misma lógica que `play`. `play` se
  queda para las vistas previas locales con semillas al azar (no rankean), y un
  test fija que los dos deciden igual.
- `runStrategy` con un juego en vivo tira un error claro: se juega con `runLive`.

### SDK: `packages/agent-sdk`

- `ArbiterClient.liveStart` y `liveCommit`. La web usa el mismo cliente.
- `playAndSubmit`: si `m.live`, juega con `runLive` y la estrategia en vivo por
  defecto del juego, o con `args.liveStrategy`, y devuelve el `MatchView` final.
  Una `strategy` de las de siempre (semilla → replay) en un juego en vivo tira
  un error claro.
- `MatchView.seed` pasa a ser opcional y se suma `live?: boolean`.

### MCP: `apps/mcp`

- Sin código nuevo más allá del SDK: `play_and_submit` sigue funcionando.
- La descripción de `matchmake` aclara que un juego en vivo no trae semilla.
- Sube la versión y se actualizan las docs.

### Web: `apps/web`

- **`FlappyGame`** recibe la semilla (práctica, no rankea) **o** un controlador
  en vivo. En vivo usa `BufferedRandom`, y antes de cada tick, si el motor
  necesita un valor que todavía no llegó, no avanza. Pasados 300 ms sin el valor
  muestra "conectando…". Compromete en segundo plano cuando
  `drawsWithin(LIVE_LEAD_TICKS)` pide más de lo disponible, y al morir. El tope
  de `dtCap` de las mesas de plata sigue igual.
- **`game/[gameId]/match/page.tsx`**, en juegos en vivo:
  - firma `liveStartAuthMessage` al empezar a jugar (la firma del final
    desaparece, así que siguen siendo dos firmas por partida);
  - si hay un intento abierto al recargar, lo retoma;
  - toma el puntaje que confirma el árbitro.
- **`ReplayPlayer`** no cambia: la semilla llega con el replay de la partida
  decidida.

---

## Tests

- **Motor:**
  - con `RandomSource` da exactamente lo mismo que con la semilla, en cientos de
    semillas;
  - `drawsWithin` coincide con lo que después se consume de verdad;
  - `BufferedRandom` corta cuando falta un valor.
- **Árbitro** (`apps/server/test/live-flappy.test.ts`):
  - `start` exige firma y ser jugador de la partida;
  - un segundo `start` no reinicia y rota el token;
  - `commit` exige `from` exacto y resincroniza con 409;
  - con `have`, una respuesta perdida se recupera en el compromiso siguiente,
    sin volver a abrir el intento;
  - topes de ticks y de aleteos;
  - nunca revela un valor que se consumiría después de `to + 15`, que es la
    propiedad central;
  - morir, `final` y el tope cierran el intento con el puntaje correcto y
    liquidan;
  - rendición con `submitScore`, y rechazo de replays comunes;
  - el intento abandonado vence;
  - restauración después de un reinicio;
  - la semilla no aparece en ninguna vista antes de decidir;
  - el control de depósito on-chain al abrir en una mesa de plata;
  - los endpoints BYO con secreto, y que al vencer el plazo un intento abierto
    se cierra contando lo alcanzado.
- **Estrategias:** `step` y `play` deciden igual con los mismos estados.
- **SDK:** `playAndSubmit` en vivo contra un árbitro en proceso llega al mismo
  puntaje que la estrategia en lote con la misma semilla. Es la prueba de que
  la estrategia no usaba información del futuro.
- **Runner:** un agente de la casa juega Flappy en vivo, y un test fija que ese
  camino no lee `m.seed`.
- **Web:** tests del planificador de compromisos (función pura) y prueba manual
  en el navegador contra un árbitro local antes del interruptor.
- **Selftest:** los casos de Flappy pasan al protocolo nuevo en el PR 3.

---

## Despliegue

1. **PR 1, la base, apagada.** Motor (`RandomSource`, `BufferedRandom`,
   `drawsWithin`, `runLive`) y árbitro (`live.ts`, rutas, persistencia, vistas,
   rendición, BYO). `RULES_V.flappy` sigue en 1, así que en producción nada
   cambia. Los tests activan el modo en vivo con un gancho de test, sin tocar
   `RULES_V`.
2. **PR 2, los clientes, apagados.** SDK, estrategias, runner, MCP y web saben
   jugar en vivo, pero el árbitro todavía dice v1, así que siguen por el camino
   de hoy.
3. **PR 3, el interruptor.**
   - `RULES_V.flappy = 2`, selftest, CHANGELOG, README/AGENTS.md y versión de
     los paquetes.
   - Antes de mergearlo, prueba manual de la web contra un árbitro local.
   - Al mergear se despliegan juntos árbitro y web. **Ese mismo día** el dueño
     publica los paquetes en npm y el MCP en el registry, coordinado con la
     publicación pendiente de 0.4.0 de Aleph.
   - Los agentes con paquetes viejos reciben el error de siempre:
     "rules version mismatch … update @arcade1v1 packages".

---

## Fuera de alcance

- Racing, Snake, Invaders, 2048 y Tetris. Cada uno reusa el protocolo y define
  su propio `drawsWithin` y su margen. En varios, cuántos valores se consumen
  depende de las jugadas (la comida de Snake, las fichas de 2048, las bolsas de
  Tetris), así que el margen se calcula con el estado del árbitro y puede
  revelar de menos (seguro), nunca de más.
- Límite de tiempo por tramo.
- Contar como derrota un intento abandonado.
- Cualquier cambio de contrato.

---

## Pendientes del dueño

- OK para publicar los cuatro paquetes en npm y el MCP en el registry el día del
  PR 3.
- Mergear los tres PR, el tercero recién después de la prueba manual.
