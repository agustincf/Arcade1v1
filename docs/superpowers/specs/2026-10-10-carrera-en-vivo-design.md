# Carrera en vivo — diseño (C13, segundo juego en vivo)

> Estado: aprobado por el dueño en el chat el 2026-10-10 ("Carrera primero" y
> "Dale"). El dueño pidió no revisar specs: este documento queda como registro
> para las sesiones que sigan. Protocolo base: el de Flappy,
> [`2026-09-16-benchmark-en-vivo-design.md`](2026-09-16-benchmark-en-vivo-design.md).

## Problema

C13 de [`docs/MAINNET.md`](../../MAINNET.md): cinco juegos todavía le entregan
la semilla al jugador antes de jugar, así que un agente puede simular la partida
entera y buscar la mejor secuencia. Flappy ya se juega en vivo (reglas v2). Este
diseño pasa **Carrera** al mismo modelo y deja el modo en vivo listo para los
otros cuatro.

## Decisiones (2026-10-10)

1. **Carrera primero.** Es el único de los cinco que encaja en el modelo de
   Flappy sin dilemas: las filas de obstáculos nacen arriba de la pantalla con
   un reloj que no depende de las jugadas. 2048 queda para después (tiene que
   elegir el dueño entre demora por movimiento o mostrar la ficha que viene).
2. **El mismo margen que Flappy:** cada fila se revela `LIVE_LEAD_TICKS` (15
   ticks, 0,25 s) antes de nacer. Nada más adelante.
3. **Nada nuevo de infraestructura.** Medido con las estrategias de la casa:
   una carrera son 35–57 compromisos y 12–63 KB a Upstash por jugador.
4. **Dos PRs:** el PR 1 trae todo apagado (`RULES_V.racing` sigue en 2); el
   PR 2 es el interruptor (reglas v3, docs, paquetes 0.6.0) y se mergea el día
   que el dueño publica en npm.

## Qué es, en ocho líneas

1. Carrera pasa a las **reglas v3**: se juega en vivo. La física no cambia.
2. `matchmake` deja de entregar su semilla: publica `secretHash`, como Flappy.
3. En vivo, **cada fila sale de un solo valor al azar**. El motor lo expande
   con un `mulberry32` propio de esa fila para sortear carriles, vallas,
   paredes-salto y monedas con las mismas probabilidades de siempre.
4. Por eso cuántos valores consume el juego en los próximos N ticks es la
   cantidad de filas que nacen en esos ticks: no depende del azar ni de las
   jugadas (`drawsWithin`, exacto, como en Flappy).
5. El jugador compromete sus jugadas (`inputs`: `{ t, a }` con `a` en
   `l`/`r`/`j`) y recibe los valores de las filas que nacen antes de
   `to + LIVE_LEAD_TICKS`.
6. El árbitro simula a la par; al chocar (o con `final`) tiene el puntaje.
7. Al decidirse se publica el secreto y cualquiera re-verifica con
   `verifyRacingLive(secret, { ticks, inputs })`.
8. Con semilla (las partidas viejas, la práctica de la web y las vistas previas
   de las estrategias) el motor sigue exactamente igual que en v2.

## Motor (`packages/game-sdk`)

- `RacingEngine(source: number | RandomSource)`. Con un número: el
  `mulberry32(seed)` de siempre, valor por valor (v2 intacto; un test de
  caracterización lo fija). Con una fuente: **un valor por fila**, expandido
  con `mulberry32(floor(v · 2³²))`.
- El reloj de filas (`elapsedMs`, `spawnTimer`, `spawnInterval`) sale a un
  ayudante compartido por `update` y `drawsWithin`, con las mismas operaciones
  de punto flotante en el mismo orden: si no, la predicción y el juego real
  podrían diferir en un tick.
- `drawsWithin(ticks)`: filas que nacen en los próximos `ticks` ticks, sin
  tocar el motor y sin mirar el auto (un choque no cambia el reloj). Con la
  partida terminada da 0.

## Núcleo genérico del modo en vivo

Hoy el driver, la sesión de la web y el árbitro están atados a Flappy (los
"aleteos"). Pasan a trabajar con una **definición de juego en vivo**:

```ts
interface LiveGame<E> {
  id: string;
  create(src: RandomSource): E;
  /** Aplica las acciones de este tick y avanza un tick. */
  step(e: E, actions: readonly string[]): void;
  over(e: E): boolean;
  score(e: E): number;
  drawsWithin(e: E, ticks: number): number;
  /** Flappy: antes del primer aleteo el motor no corre (esos ticks no cuentan). */
  idle?(e: E, actions: readonly string[]): boolean;
  /** Cómo viajan las jugadas: Flappy manda `flaps` (ticks); el resto, `inputs`. */
  wire: "flaps" | "inputs";
  actions: readonly string[];
  maxActionsPerTick: number;
  /** Tope de acciones de un intento según los ticks jugados (o Infinity). */
  inputBudget(ticks: number): number;
}
```

- `playLive(game, …)`, `LiveSession` y `verifyLive(game, …)` son genéricos.
  `playFlappyLive`, `FlappyLiveSession` y `verifyFlappyLive` quedan como
  envoltorios con la misma firma: la web de Flappy y los clientes publicados no
  cambian.
- Las jugadas se manejan por dentro como `{ t, a }`; Flappy usa `a = "f"` y
  sigue viajando como `flaps`. El cable de Flappy no cambia ni un campo.
- `decide(engine, tick)` puede devolver `boolean` (Flappy), una acción, una
  lista o nada, **o una promesa**: el ejemplo de Claude piensa en vivo.

### Tope de jugadas (nuevo, por Carrera)

En Flappy el registro de un intento crece a lo sumo un aleteo por tick y solo
mientras el pájaro vive. En Carrera hay jugadas que no cambian nada (ir a la
izquierda en el carril izquierdo, saltar en el aire): sin tope, un cliente
malicioso que sobrevive podría inflar su registro, y cada compromiso lo reescribe
entero en Upstash. Carrera acepta **a lo sumo 3 acciones por tick** y **un
promedio de una cada 4 ticks** (`floor(ticks / 4) + 64`). La sesión y el driver
aplican el mismo tope antes de jugar (descartan lo que sobra), así que un
cliente honesto nunca recibe un rechazo; el árbitro rechaza el compromiso que lo
pasa. Las estrategias de la casa cambian de carril como mucho cada 8 ticks.

## Árbitro (`apps/server`)

- `live.ts` toma la definición del juego de la partida. `LiveAttempt` suma
  `inputs` (Carrera); Flappy sigue guardando `flaps`. `live-store.ts` acepta los
  dos registros.
- `POST /match/:id/live/commit` y `POST /agents/:id/live/commit` aceptan
  `inputs` (Carrera) o `flaps` (Flappy). La apertura devuelve lo mismo que se
  comprometió, en el formato del juego.
- La rendición de un juego en vivo pasa a ser genérica: puntaje 0 y el replay
  vacío del juego (`{ ticks: 0, inputs: [], v: 3 }` en Carrera).
- Los agentes de la casa juegan Carrera en vivo con `step` de su estrategia.

## Clientes

- **Estrategias:** `racing.dodger` y `racing.weaver` suman `step`, con la misma
  decisión que `play` (un test lo fija).
- **SDK:** `playAndSubmit` juega Carrera en vivo con la estrategia por defecto
  o con `liveStrategy`. `LiveStrategy.decide` acepta las respuestas nuevas.
- **Ejemplo LLM:** `play-racing-llm.ts` juega en vivo: Claude decide sin ver
  el futuro.
- **MCP:** sin código propio; cambia el texto y la versión en el PR 2.
- **Web:** `RacingGame` recibe la semilla (práctica) o un controlador en vivo;
  la página de la partida le pasa el mismo controlador que a Flappy, y
  `ReplayPlayer` re-juega con el secreto.

## Por qué alcanza

- Igual que Flappy: el secreto es de 256 bits, el hash se publica al emparejar
  y el secreto al decidir; el intento es único; las jugadas comprometidas no se
  reescriben.
- **Margen aceptado:** una fila se conoce 0,25 s antes de nacer. La fila de
  monedas se conoce entera al nacer, aunque sus últimas monedas entren a la
  pantalla un poco después: es menos de lo que ya se aceptó en Flappy.
- Los valores revelados después de un choque no sirven: el intento terminó.

## Tests

- Motor: caracterización con semilla (v2 idéntico), un valor por fila,
  `drawsWithin` exacto mientras el auto vive y que no toca el motor,
  `verifyRacingLive`.
- Núcleo: los tests de Flappy pasan sin cambios; driver y sesión de Carrera
  contra un árbitro de referencia en memoria (mismo puntaje que de corrido,
  resincronización, la propiedad de no revelar más allá de `to + 15`, topes).
- Árbitro: apertura, compromiso, 409, `have`, choque y `final`, rendición, topes
  de jugadas, restauración, BYO, agentes de la casa y que nada del secreto sale
  antes de decidir.
- SDK: `playAndSubmit` en vivo contra un árbitro en proceso da lo mismo que la
  estrategia jugada de corrido con el secreto publicado.
- Web: piezas puras (fuente del replay, rendición) y prueba manual en el
  navegador antes del interruptor.

## Despliegue

1. **PR 1, apagado.** Todo lo anterior con `RULES_V.racing = 2` y
   `LIVE_SINCE_RULES_V.racing = 3`: en producción nada cambia. Los tests
   prenden Carrera en vivo subiendo `RULES_V.racing` a 3 dentro del test.
2. **PR 2, el interruptor.** `RACING_RULES_V = 3`, selftest, CHANGELOG,
   AGENTS.md, llms.txt, READMEs, MAINNET.md (C13: Carrera hecha) y paquetes
   0.6.0. Antes de pedir el merge: prueba manual de la web contra un árbitro
   local. Ese día el dueño publica los cuatro paquetes y el MCP.

## Fuera de alcance

- 2048, Tetris, Snake e Invaders.
- Escribir solo el tramo nuevo de cada intento en Upstash (hoy se reescribe el
  intento entero en cada compromiso, también en Flappy): queda como mejora
  aparte.
