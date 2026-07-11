# Fase 5 — Más de una estrategia por juego (diseño)

> Spec de diseño de la Fase 5 del milestone v3. Estructura y criterios en
> [../v3/PLAN.md](../v3/PLAN.md) (Fase 5). Protocolo en
> [../v3/OPERATIVA.md](../v3/OPERATIVA.md). Aprobada por el dueño el 2026-07-11.

## Objetivo

Que el builder tenga un paso de **elección real de estrategia**: hoy hay
exactamente una por juego y al elegir el juego se asigna sola. Se agrega una
**segunda estrategia con un estilo de juego claramente distinto** en 3 juegos, y
un selector en el builder cuando un juego tiene más de una.

**Alcance decidido en el brainstorm:** 3 juegos — **2048, Snake y Carrera** —
elegidos porque el contraste entre los dos estilos se ve a simple vista en el
sandbox (el criterio "partidas visiblemente distintas"), son de lógica pura y
fáciles de testear, y ninguno tiene líos de tamaño de replay.

**Fuera de alcance (YAGNI):** las segundas estrategias de flappy, invaders y
tetris (su contraste es más sutil o el segundo estilo menos obvio); un tercer
estilo por juego; rediseñar el contrato de parámetros. Los 3 juegos no tocados
siguen con una sola estrategia y **el builder los muestra exactamente igual que
hoy**.

## Principio de las estrategias nuevas

Cada estrategia nueva maneja el **motor real tick a tick** (igual que las
actuales), así el replay que produce lo reproduce el verificador del árbitro con
el mismo puntaje **por construcción** — la garantía central de
[types.ts](../../../packages/strategies/src/types.ts). No se toca ningún motor
ni el verificador. Cada una vive en su propio archivo, una estrategia por
archivo, como las existentes.

El objetivo de diseño no es "la mejor IA" sino **dos estilos que jueguen
distinto de verdad y ambos sean viables** (hacen puntos). El estilo existente y
el nuevo son las dos caras del mismo juego.

## Las tres estrategias nuevas

### 2048 — `2048.corner` ("Esquinero")

**Contraste.** El existente `2048.priority` ("Fusionador") maximiza la fusión
inmediata siguiendo un orden de direcciones → arma un tablero caótico. El
esquinero **ordena el tablero hacia una esquina** y pospone fusiones para no
romper el orden → apila prolijo hacia un rincón.

**Algoritmo.** Anticipación de 1 jugada sobre una copia PURA del tablero
(reusando la lógica de `slide`/`evalMove` que ya existe en
[g2048.ts](../../../packages/strategies/src/g2048.ts), extraída a un helper
`applyDir(board, dir) -> { board, gained, changed }`). Para cada dirección
legal, simular el tablero resultante (pre-spawn, determinista) y puntuarlo con
una **función de calidad** hacia la esquina elegida:

- **Celdas vacías** (más = mejor: supervivencia).
- **Monotonía**: filas y columnas ordenadas de forma creciente hacia la esquina
  (penaliza romper el gradiente).
- **Fusión inmediata** con peso chico, modulado por `patience` (paciente = pesa
  poco la fusión, prioriza orden; impaciente = se acerca al fusionador).

Elegir la dirección de mayor calidad y aplicarla al motor real (`g.move(dir)`),
registrando `moves` igual que el existente. Sin spawn a predecir: se evalúa el
tablero post-slide, que es determinista.

**Parámetros:**

- `corner` (choice): esquina objetivo — `down-left` (default), `down-right`,
  `up-left`, `up-right`.
- `patience` (slider 0..1, def 0.7): peso del orden/vacíos vs. fusión inmediata.

### Snake — `snake.survivor` ("Superviviente")

**Contraste.** El existente `snake.greedy` ("Cazador") va derecho a la comida
(la distancia manda; la cautela es un ajuste menor) → se lanza directo. El
superviviente **prioriza no encerrarse**: el espacio libre manda y solo se
acerca a la comida cuando es seguro → serpentea metódico y sobrevive más.

**Algoritmo.** Reusa los helpers de
[snake.ts](../../../packages/strategies/src/snake.ts) (`freeSpace` flood-fill
acotado, `wrapDist`, `DELTA`). Para cada acción legal (no reversa, no a celda
ocupada), el valor invierte los pesos del cazador: **el espacio alcanzable
domina** y la cercanía a la comida entra con peso chico:

```
value = freeSpace(next) + foodPull * (-wrapDist(next, food)) * 0.3
```

Con `foodPull` bajo por defecto, el superviviente elige casi siempre la salida
con más aire (efecto: pega a los bordes y evita bolsillos), y solo se desvía por
comida cuando no sacrifica espacio. Registra `inputs` solo al cambiar de
dirección, como el existente.

**Parámetros:**

- `foodPull` (slider 0..1, def 0.35): cuánto se arriesga por comida vs. espacio
  puro. (El cazador ya cubre el otro extremo, así que el default va bajo para
  que el estilo se note.)

### Carrera — `racing.weaver` ("Serpenteador")

**Contraste.** El existente `racing.dodger` ("Prudente") se queda en su carril
preferido y esquiva **solo cuando su propio carril tiene peligro** → casi no se
mueve. El serpenteador **busca proactivamente el carril despejado más lejos** y
fluye entre carriles → cambia todo el tiempo.

**Algoritmo.** Reusa el motor y constantes de
[racing.ts](../../../packages/strategies/src/racing.ts). Cada tick de decisión,
para cada carril calcular la **holgura** = distancia al obstáculo más cercano
por delante en ese carril (o un tope si está limpio). Moverse **un carril** (±1,
como el dodger) hacia el carril de mayor holgura, con cooldown/histéresis para
no vibrar y un **margen** (`boldness`): solo cambia si la holgura del destino
supera a la del carril actual por ese margen. `boldness` bajo = serpentea
seguido; alto = solo cambia cuando es claramente mejor.

**Parámetros:**

- `boldness` (slider 0..1, def 0.3): cuánta ventaja de holgura exige para
  cambiar de carril. Bajo por defecto para que el serpenteo se vea.

## Contrato: descripción de estrategia

El selector del builder necesita, además del nombre, una **línea de qué hace**
cada estilo. Se agrega un campo **opcional** a `StrategyDef`:

- `descKey?: string` — clave i18n de la descripción en una línea.

Es opcional: se completa solo en las 6 estrategias de los 3 juegos con elección
(las dos de 2048, snake y racing). Los otros 3 juegos no lo necesitan (nunca se
muestra el selector para ellos). El selector renderiza `def.descKey ?
t(def.descKey) : ""`.

## Registro

En [registry.ts](../../../packages/strategies/src/registry.ts), sumar las 3
nuevas al array `ALL`, **cada una inmediatamente después de su hermana** (para
que `strategiesFor(game)` devuelva primero la existente = el default del
builder):

```
strategy2048Priority, strategy2048Corner,
strategySnakeGreedy,  strategySnakeSurvivor,
strategyRacingDodger, strategyRacingWeaver,
... (invaders, flappy, tetris sin cambios)
```

`strategiesFor()`, `validateParams()`, `getStrategy()` y `runStrategy()` **no
cambian**: ya soportan N estrategias por juego. El servidor valida el
`strategyId` contra el registro, así que las nuevas quedan desplegables
automáticamente; los agentes hosteados existentes conservan su `strategyId` y no
se ven afectados.

## Builder (web)

En [build/page.tsx](../../../apps/web/app/build/page.tsx), sin agregar pasos
(sigue siendo un asistente de 5):

- **`pickGame(id)`** mantiene `strategiesFor(id)[0]` como default → los juegos
  de una sola estrategia quedan idénticos; los de dos arrancan con la existente.
- **Paso 2**, arriba de la caja de perillas, un **selector de estilo**
  (`StrategyChooser`, componente nuevo en el mismo archivo) que se renderiza
  **solo si `strategiesFor(game).length > 1`**: una tarjeta por estrategia con
  `t(labelKey)` (nombre) + `t(descKey)` (línea en simple). Al elegir:
  `setStrategyId(s.id)`, `setParams(defaultParams(s))`, `setSandbox(null)`. La
  tarjeta activa se marca con el borde de acento (mismo patrón visual que la
  grilla de juegos del paso 1).
- El resto ya reacciona a `strategyId`: el `def` recalculado dibuja las perillas
  correctas, el efecto del **score estimado en vivo** ya depende de `strategyId`
  y recomputa solo, y el resumen del paso 5 muestra `t(def.labelKey)`.

Regla de la casa: una sola acción primaria por zona — el selector es una
elección de radio (una activa), no botones de acciones distintas.

Boceto del paso 2 con dos estilos:

```
┌─ Paso 2: Elegí el estilo y ajustá ─────────┐
│  ● Cazador          ○ Superviviente         │
│    va directo a       no se encierra,        │
│    la comida          sobrevive más          │
│  ──────────────────────────────────────────  │
│  Tirón a la comida  ▓▓▓░░░░░  0.35           │
│  [ score estimado: 1240 ]                    │
└─────────────────────────────────────────────┘
```

## i18n (los 4 idiomas: en/es/hi/fr)

En [i18n-dict.ts](../../../apps/web/app/lib/i18n-dict.ts), sin excepciones ni
"TODO traducir":

- **Encabezado del selector:** `build.style` ("Elegí un estilo de juego").
- **Nombres nuevos:** `strat.2048.corner.name`, `strat.snake.survivor.name`,
  `strat.racing.weaver.name`.
- **Descripciones (`descKey`) de las 6:** `strat.2048.priority.desc`,
  `strat.2048.corner.desc`, `strat.snake.greedy.desc`,
  `strat.snake.survivor.desc`, `strat.racing.dodger.desc`,
  `strat.racing.weaver.desc`.
- **Perillas nuevas:** `strat.2048.corner.corner`, `strat.2048.corner.patience`,
  `strat.snake.survivor.foodPull`, `strat.racing.weaver.boldness`.
- **Opciones de choice nuevas** (para `t("strat.opt.<opt>")`):
  `strat.opt.down-left`, `strat.opt.down-right`, `strat.opt.up-left`,
  `strat.opt.up-right`.

## Testing

**Herencia automática.** La suite
[strategies.test.ts](../../../packages/strategies/test/strategies.test.ts) está
parametrizada sobre `STRATEGIES`: al registrar las 3 nuevas, cada una hereda sin
escribir nada los tests de (1) el verificador reproduce el puntaje exacto con
default y alternativo, (2) determinismo, (3) hace puntos con el default, (4) el
replay entra en 256kb. Esa es la garantía anti-trampa y de viabilidad.

**Test nuevo — distinción (el criterio de la fase).** Agregar un test que, para
cada uno de los 3 juegos con dos estrategias, corra ambas sobre las mismas
semillas y afirme que **producen partidas distintas**: los replays difieren
(secuencia de jugadas) y, en al menos una semilla, el puntaje difiere. Esto
codifica "dos estrategias del mismo juego producen partidas visiblemente
distintas en el sandbox".

## Verificación real (no solo tests)

Levantar la web y recorrer el builder: elegir 2048 → aparece el selector con
Fusionador/Esquinero → cambiar entre estilos mueve las perillas y el score
estimado → probar en el sandbox y ver que el Esquinero apila hacia la esquina y
el Fusionador no. Repetir con Snake (cazador se lanza / superviviente serpentea)
y Carrera (prudente quieto / serpenteador zigzaguea). Confirmar que un juego de
una sola estrategia (p. ej. tetris) se ve igual que hoy (sin selector).

## Archivos

Nuevos:

- `packages/strategies/src/g2048-corner.ts` — `strategy2048Corner`
- `packages/strategies/src/snake-survivor.ts` — `strategySnakeSurvivor`
- `packages/strategies/src/racing-weaver.ts` — `strategyRacingWeaver`

Modificados:

- `packages/strategies/src/types.ts` — `descKey?` opcional en `StrategyDef`
- `packages/strategies/src/g2048.ts` — extraer `applyDir` puro reusable (o
  exportar el helper) para el esquinero, sin cambiar el comportamiento del
  fusionador
- `packages/strategies/src/registry.ts` — registrar las 3 nuevas
- `packages/strategies/src/index.ts` — reexportar lo que haga falta
- `packages/strategies/test/strategies.test.ts` — test de distinción por juego
- `apps/web/app/build/page.tsx` — `StrategyChooser` en el paso 2; `pickGame`
  intacto
- `apps/web/app/lib/i18n-dict.ts` — claves nuevas ×4 idiomas

## Reglas de la casa respetadas

- **Default-deny**: `validateParams` ya sanea los params nuevos por su
  `ParamSpec` (slider clampeado, choice de la allowlist). No hay validación
  paralela.
- **Honestidad**: nada sintético; los estilos juegan de verdad el motor real y
  el score estimado sale de correr las mismas semillas que verifica la suite.
- **Jerarquía de CTAs**: el selector es una sola elección, no compite con la
  navegación del asistente.
- **4 idiomas de primera**: todo texto nuevo va en en/es/hi/fr.
- **Agentes existentes intactos**: su `strategyId` sigue válido; solo se **suman**
  opciones.
