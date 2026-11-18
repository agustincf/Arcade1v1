# Space Invaders en vivo — diseño (C13, tercer juego en vivo)

> Estado: el dueño eligió Invaders el 2026-11-18 ("Sí, Invaders"), con la
> propuesta de revelar de a un segundo y de guardar solo lo nuevo de cada tramo.
> Como con Carrera, pidió no revisar specs: este documento queda como registro.
> Protocolo base: el de Flappy
> ([`2026-09-16-benchmark-en-vivo-design.md`](2026-09-16-benchmark-en-vivo-design.md)),
> generalizado con Carrera
> ([`2026-10-10-carrera-en-vivo-design.md`](2026-10-10-carrera-en-vivo-design.md)).

## Problema

C13 de [`docs/MAINNET.md`](../../MAINNET.md): 2048, Tetris, Snake e Invaders
todavía le entregan la semilla al jugador antes de jugar, así que un agente
puede simular la partida entera y buscar la mejor secuencia. En Invaders eso
quiere decir saber de antemano cada bomba de la partida (cuándo y desde qué
columna) y cada pasada del OVNI. Este diseño pasa Invaders al modo en vivo, el
que ya usan Flappy y Carrera.

## Por qué Invaders antes que Snake y Tetris

Medido con las estrategias de la casa (20 semillas, parámetros por defecto):

| Juego    | De dónde sale el azar                                      | ¿Lo dispara la jugada?            |
| -------- | ---------------------------------------------------------- | --------------------------------- |
| Invaders | tirada de bomba cada tick (y su columna), pasada del OVNI  | No: los aliens tienen su reloj    |
| Snake    | la fruta nueva al comer, la tirada de moneda en cada paso  | Sí: comer pide la fruta siguiente |
| Tetris   | la bolsa de 7 piezas; cada pieza apoyada pide la siguiente | Sí: apoyar pide la pieza          |

Snake y Tetris tienen el dilema de 2048 (o el jugador conoce de antemano lo que
va a salir, o el juego se frena un instante después de cada jugada): los decide
el dueño. Invaders encaja como Carrera: el azar corre con un reloj que no
depende de lo que haga el jugador. Detalle de las mediciones en las notas de la
sesión (Invaders: 5.651 ticks, 59 bombas, 6 OVNIs y 849 jugadas de mediana).

## Decisiones (2026-11-18)

1. **Invaders primero**, elegido por el dueño.
2. **Un valor por bloque de 60 ticks (un segundo).** Los aliens tiran los dados
   60 veces por segundo: con un valor por tick, el jugador tendría que
   comprometer en cada tick (no hay árbitro ni límite de pedidos que lo
   aguante). Con bloques de 60 ticks son ~95 compromisos por partida (Carrera:
   ~56). Cada bloque se revela `LIVE_LEAD_TICKS` (15 ticks) antes de empezar,
   así que **una bomba se conoce como mucho 74 ticks (1,23 s) antes de caer**.
   Una bomba tarda unos 2 s en bajar a la vista de todos, y un OVNI unos 3 s en
   cruzar la pantalla: el adelanto es menor que lo que ya muestra la pantalla.
   Medido para elegir el tamaño (por jugador, por partida):

   | Bloque    | Adelanto máx. | Compromisos | Upstash (hoy) |
   | --------- | ------------- | ----------- | ------------- |
   | 15 ticks  | 0,48 s        | 378         | 3,0 MB        |
   | 30 ticks  | 0,73 s        | 189         | 1,5 MB        |
   | **60**    | **1,23 s**    | **95**      | **780 KB**    |
   | 120 ticks | 2,23 s        | 48          | 403 KB        |
   | Carrera   | 0,25 s        | 56          | 54 KB         |

3. **Guardar solo lo nuevo de cada tramo** (requisito del interruptor, no de
   este PR). Hoy cada compromiso reescribe el intento entero en Upstash; con las
   ~850 jugadas de Invaders (Carrera: ~90) eso son ~780 KB por jugador y
   partida, 15 veces lo de Carrera. Escribiendo solo el tramo nuevo queda en el
   tamaño del registro final (~20 KB). Va en un PR propio, antes del interruptor,
   porque toca el registro durable de Flappy y Carrera, que ya están en
   producción: este PR 1 deja todo apagado y no puede cambiar nada de lo que
   corre.
4. **Dos PRs, como Carrera:** el PR 1 trae todo apagado (`INVADERS_RULES_V`
   sigue en 1); el PR 2 es el interruptor (reglas v2, docs, paquetes) y sale
   después del PR del registro.

## Qué es, en ocho líneas

1. Invaders pasa a las **reglas v2**: se juega en vivo. La física no cambia.
2. `matchmake` deja de entregar su semilla: publica `secretHash`.
3. En vivo, **cada bloque de 60 ticks sale de un solo valor al azar**. El motor
   lo expande con un `mulberry32` propio del bloque y saca **4 sub-valores por
   tick, se usen o no**: tirada de bomba, columna, tirada del OVNI y sentido.
   Mismas probabilidades de siempre.
4. Cuántos valores consume el juego en los próximos N ticks es cuántos bloques
   empiezan en esos ticks: no depende del azar ni de las jugadas
   (`drawsWithin`, exacto mientras el jugador vive).
5. El jugador compromete sus jugadas (`inputs`: `{ t, a }` con `a` en
   `l1`/`l0`/`r1`/`r0`/`f1`/`f0`, las mismas de siempre) y recibe los valores
   de los bloques que empiezan antes de `to + LIVE_LEAD_TICKS`.
6. El árbitro simula a la par; al perder las vidas, la invasión o con `final`,
   tiene el puntaje.
7. Al decidirse se publica el secreto y cualquiera re-verifica con
   `verifyInvadersLive(secret, { ticks, inputs })`.
8. Con semilla (las partidas viejas, la práctica de la web y las vistas previas
   de las estrategias) el motor sigue exactamente igual que en v1.

## Motor (`packages/game-sdk/src/invaders.ts`)

- `InvadersEngine(source: number | RandomSource)`. Con un número: el
  `mulberry32(seed)` de siempre, con las tiradas en el mismo orden y en los
  mismos lugares (un test de caracterización lo fija). Con una fuente: un valor
  por bloque de `INVADERS_LIVE_BLOCK = 60` ticks.
- `tickCount`: ticks jugados (cuenta en los dos modos). Al empezar cada tick
  vivo (después del "si terminó, nada"), si `tickCount % 60 === 0` se toma el
  valor del bloque; después se sacan los 4 sub-valores del tick. Se sacan antes
  de cualquier salida temprana (oleada despejada) y se usen o no: así ninguna
  jugada puede correr el azar de los ticks siguientes del bloque (matar al
  OVNI, despejar la oleada).
- Las cuatro tiradas usan los sub-valores en lugar de `rng()`: bomba si
  `dado < chance`, columna `cols[floor(dado · cols.length)]`, OVNI si
  `dado < UFO_CHANCE`, sentido `dado < 0.5 ? 1 : -1`. Con semilla, cada una
  sigue llamando a `rng()` donde lo hacía.
- `drawsWithin(ticks)`: bloques que empiezan en `[tickCount, tickCount + ticks)`.
  Con la partida terminada, 0. Si la partida termina dentro de la ventana, la
  cuenta sobra (un valor revelado de más, que ya no sirve): igual que Carrera.
- `held`: qué teclas tiene apretadas el motor (`{ left, right, fire }`). Lo usan
  la estrategia y la web en vivo para mandar solo cambios.
- `INVADERS_RULES_V = 1` (sube a 2 en el PR 2); `rules.ts` lo toma de acá.
  `ReplayInvaders` suma `v?` (la rendición en vivo es `{ ticks: 0, inputs: [], v: 2 }`).

## Definición en vivo (`packages/game-sdk/src/invaders-live.ts`)

- `invadersLive: LiveGame<InvadersEngine>`: acciones `l1 l0 r1 r0 f1 f0`,
  aplicadas en orden y después `tick()`, como en `verifyInvaders`; `wire:
"inputs"`.
- **Topes:** a lo sumo 6 acciones por tick (cada tecla, una vez apretar y una
  soltar) y `floor(ticks / 3) + 64` en el intento. La estrategia de la casa
  llega a una cada 6,9 ticks en el peor caso medido; una persona que toca el
  disparo como loca, a una cada 4–5. El tope existe por lo mismo que en
  Carrera: hay jugadas que no cambian nada (soltar una tecla suelta) y el
  registro se guarda en cada compromiso.
- `verifyInvadersLive(secret, replay)` con `verifyLive`.
- `live-games.ts` suma `invaders`; `LIVE_SINCE_RULES_V.invaders = 2`; subpath
  `@arcade1v1/game-sdk/invaders-live`.

## Árbitro (`apps/server`)

Nada específico: desde Carrera el árbitro trabaja con la definición del juego
(`liveGameFor`), valida las jugadas con sus acciones y topes, y la rendición, el
cierre al vencer, BYO y la casa son genéricos. Este PR suma los tests de
Invaders en vivo (subiendo `RULES_V.invaders` a 2 dentro del test).

## Clientes

- **Estrategia:** `invaders.hunter` pasa a una decisión compartida por `play`
  (con semilla) y `step` (en vivo). La decisión mira el motor del tick (y
  `held` para saber qué teclas están apretadas, así un recorte o un intento
  retomado no la confunden) y devuelve las acciones sin tocar el motor. La
  caracterización fija que `play` no cambió ni una partida; otro test, que
  `step` decide lo mismo que `play`.
- **SDK:** `playAndSubmit` ya juega cualquier juego en vivo; exporta
  `verifyInvadersLive` y la documentación de `LiveStrategy` nombra las acciones
  de Invaders.
- **Web:** `InvadersGame` recibe la semilla (práctica y v1) o el controlador en
  vivo, como `RacingGame`. En vivo, en cada tick manda la diferencia entre las
  teclas que el jugador tiene apretadas y las que tiene el motor (`held`): solo
  cambios, y si un tope recortara algo se corrige solo en el tick siguiente (en
  vez de dejar una tecla "pegada"). Sin el azar del tick siguiente se congela y
  avisa "conectando…"; el puntaje lo confirma el árbitro. La página de la
  partida le pasa el controlador a Invaders y `ReplayPlayer` re-juega con el
  secreto publicado. Avisos en es/en/fr.

## Por qué alcanza

- Igual que Flappy y Carrera: secreto de 256 bits, hash al emparejar y secreto
  al decidir, un intento por jugador, jugadas comprometidas que no se
  reescriben.
- **Margen aceptado:** a lo sumo 1,23 s de bombas y OVNI por adelantado. Saber
  dónde cae una bomba un segundo antes no cambia mucho (se ve bajar durante
  ~2 s) y al OVNI se le pega reaccionando (cruza en ~3 s, la bala sube en
  ~1,2 s).
- Los 4 sub-valores fijos por tick hacen que lo que el jugador sabe no se pueda
  "correr": su azar no depende de cuándo mata un alien o al OVNI.

## Tests

- Motor: caracterización con semilla (v1 idéntico), un valor por bloque,
  4 sub-valores por tick aunque la oleada se despeje, `drawsWithin` exacto y
  sin tocar el motor, `held`, `verifyInvadersLive`.
- Núcleo: driver y sesión de Invaders contra el árbitro de referencia en
  memoria (mismo puntaje que de corrido, no revelar más allá de `to + 15`,
  topes).
- Árbitro: apertura, compromiso, choque y `final`, rendición, topes, casa y BYO
  con Invaders en vivo.
- SDK: `playAndSubmit` en vivo contra un árbitro en proceso da lo mismo que la
  estrategia jugada de corrido con el secreto publicado.
- Web: piezas puras (fuente del replay, diferencia de teclas) y prueba manual
  en el navegador antes del interruptor.

## Despliegue

1. **PR 1, apagado (este).** Todo lo anterior con `INVADERS_RULES_V = 1` y
   `LIVE_SINCE_RULES_V.invaders = 2`: en producción nada cambia.
2. **PR del registro:** guardar solo el tramo nuevo de cada intento (Flappy,
   Carrera e Invaders), con lectura de los registros viejos.
3. **PR 2, el interruptor.** `INVADERS_RULES_V = 2`, selftest, CHANGELOG,
   AGENTS.md, llms.txt, READMEs, MAINNET.md (C13: Invaders hecho) y paquetes.
   Antes de pedir el merge: prueba manual de la web contra un árbitro local. Ese
   día el dueño publica los paquetes y el MCP.

## Fuera de alcance

- 2048, Tetris y Snake (esperan decisión del dueño).
- El PR del registro (punto 2 del despliegue).
