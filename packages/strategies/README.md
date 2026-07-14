<!-- generated-by: gsd-doc-writer -->
# @arcade1v1/strategies

Estrategias parametrizables y **deterministas** para los seis juegos de Arcade1v1. Cada
estrategia maneja el motor real de [`@arcade1v1/game-sdk`](../game-sdk) tick a tick (nunca
simula por fuera del motor salvo para *evaluar* jugadas), así que el replay que produce
siempre pasa la reverificación del árbitro. Es el motor detrás del **builder no-code** de
la web: elegís juego + estrategia + parámetros, y el agente resultante juega solo.

Paquete interno del monorepo (`private: true`), no se publica a npm.

## Qué contiene

- **Un contrato** (`src/types.ts`): toda estrategia es un `StrategyDef` con un `id` estable
  (p. ej. `"snake.greedy"`), el `game` al que pertenece, una lista de `params` (`ParamSpec`)
  y una función `play(seed, params) -> { score, replay }`.
- **Un registro único** (`src/registry.ts`): la lista default-deny (`STRATEGIES`) que
  comparten el builder de la web (para dibujar los controles), el servidor (para validar y
  correr agentes hosteados) y el `agent-sdk` (estrategias por defecto).
- **Nueve estrategias**, dos juegos con dos estilos alternativos:

| Id | Juego | Idea | Parámetros |
| --- | --- | --- | --- |
| `2048.priority` | 2048 | Prioridad de direcciones + "codicia" por el puntaje inmediato de fusión | `priority` (orden), `greed` (0–1) |
| `2048.corner` | 2048 | "Esquinero": ordena el tablero hacia una esquina, fusiona solo por paciencia | `corner` (esquina), `patience` (0–1) |
| `snake.greedy` | Snake | Persigue la comida (distancia con wrap), con cautela opcional por espacio libre | `caution` (0–1) |
| `snake.survivor` | Snake | El espacio libre alcanzable manda; solo va por la comida cuando es seguro | `foodPull` (0–1) |
| `flappy.threshold` | Flappy | Aletea por umbral: cuando cae por debajo del centro del próximo hueco | `riskOffset` (-40–40), `reaction` (1–8) |
| `racing.dodger` | Racing | Sigue en un carril preferido, esquiva cuando un obstáculo entra en su distancia de mirada | `lookahead` (80–240), `preferredLane` (carril) |
| `racing.weaver` | Racing | Encara siempre el carril con más pista despejada por delante, de a un paso | `boldness` (0–1) |
| `invaders.hunter` | Invaders | Persigue la columna de aliens más cercana (o el OVNI), dispara alineado y esquiva bombas | `aggression` (0–1), `dodge` (0–1) |
| `tetris.heuristic` | Tetris | Para cada pieza evalúa (rotación, columna) con la heurística clásica de 4 pesos | `holes`, `height`, `bumpiness`, `lines` (0–10) |

Los tests (`test/strategies.test.ts`) exigen que, para cada par de estrategias del mismo
juego (`2048.priority`/`2048.corner`, `snake.greedy`/`snake.survivor`,
`racing.dodger`/`racing.weaver`), los replays y algún puntaje difieran: tienen que jugarse
visiblemente distinto, no ser variaciones cosméticas.

- **Parámetros tipados** (`ParamSpec` en `src/types.ts`): cada uno mapea 1:1 a un control
  del builder — `slider` (input range con `min`/`max`/`step`), `priority` (lista
  reordenable, una permutación exacta de `options`) o `choice` (select entre `options`).
  Cada spec trae su `labelKey` (clave i18n que resuelve la web) y un `def` (valor por
  defecto).
- **Lectura defensiva de parámetros** (`src/params.ts`): los helpers `num`, `choice` y
  `priority` degradan al default de la spec si el valor guardado es inválido o falta, en
  vez de romper la partida.
- **Allowlist de avatares** (`src/avatars.ts`, `AGENT_AVATARS`): los emojis permitidos para
  agentes creados en el builder — default-deny compartido entre web y servidor.

## Instalación

Es un workspace del monorepo — no requiere instalación aparte. Cualquier paquete o app del
repo lo declara como dependencia de workspace:

```json
"dependencies": {
  "@arcade1v1/strategies": "*"
}
```

## Uso

### Correr una estrategia directamente

```ts
import { runStrategy } from "@arcade1v1/strategies";

const { score, replay } = runStrategy(
  { game: "snake", strategyId: "snake.greedy", params: { caution: 0.8 } },
  seed, // el mismo seed que reparte el matchmaking
);
// score y replay están listos para firmar y enviar al árbitro (POST /match/:id/score).
```

`runStrategy` valida que la estrategia exista y que sea del juego pedido (si no, tira),
y sanea los `params` con `validateParams` antes de jugar — así un caller no puede colar
valores fuera de rango.

### Consultar y validar estrategias (builder / rutas del servidor)

```ts
import { STRATEGIES, strategiesFor, defaultParams, validateParams } from "@arcade1v1/strategies";

strategiesFor("racing"); // -> [racing.dodger, racing.weaver]
defaultParams(STRATEGIES["racing.weaver"]); // -> { boldness: 0.3 }
validateParams(STRATEGIES["racing.weaver"], rawFromClient); // default-deny: clave desconocida
                                                             // afuera, número clampeado
```

Esto es exactamente lo que hace `apps/server` en `agents.ts` (al dar de alta o editar un
agente) y en `agents-routes.ts` (al servir el catálogo de estrategias al builder). El
servidor **siempre** revalida con `validateParams` en cada alta/edición, así un cliente
hostil no puede persistir parámetros corruptos.

`apps/server/src/agent-runner.ts` es quien llama `runStrategy` en producción: cuando le
toca jugar a un agente hosteado, corre su estrategia sobre el `seed` de la partida, firma
el puntaje con la wallet del agente y lo somete por el mismo code path que un jugador
externo (matchmaking → firma → verificación de replay → ELO).

### Uso desde un agente (vía `@arcade1v1/agent-sdk`)

[`@arcade1v1/agent-sdk`](../agent-sdk) re-exporta este paquete tal cual
(`packages/agent-sdk/src/strategies.ts`) para cubrir los 6 juegos con estrategias por
defecto, así un agente externo puede jugar sin reimplementar lógica de juego:

```ts
import { STRATEGIES, defaultParams, runStrategy } from "@arcade1v1/agent-sdk";
```

## Contrato para agregar una estrategia

1. Implementar el `StrategyDef` en un archivo nuevo bajo `src/` (ver cualquiera de los
   existentes como referencia): `id` estable, `game`, `labelKey`/`descKey` (i18n), `params`
   y `play(seed, params)` manejando el motor real de `game-sdk`.
2. Sumarla al arreglo `ALL` en `src/registry.ts`.
3. `play()` tiene que aplicar SIEMPRE sus decisiones sobre el motor real (nunca inventar un
   replay a mano): es la única forma de garantizar que el verificador del árbitro
   reproduzca el mismo puntaje.

## Tests

El paquete usa el test runner nativo de Node (`node:test`), sin configuración aparte.

Desde la raíz del monorepo:

```bash
npm test
```

Esto corre `node --import tsx --test "{packages,apps}/*/test/*.test.ts"`, que incluye
`packages/strategies/test/strategies.test.ts`.

Para correr solo los tests de este paquete:

```bash
node --import tsx --test packages/strategies/test/strategies.test.ts
```

La garantía central que cubren los tests: **toda estrategia, con cualquier parámetro
válido y cualquier semilla, produce un replay que el verificador del árbitro reproduce con
el mismo puntaje** (usan los verificadores de `game-sdk`: `verify2048`, `verifyTetris`,
`verifyFlappy`, `verifyRacing`, `verifySnake`, `verifyInvaders`). Si esto se cumple, un
agente creado en el builder nunca puede ser rechazado por "score mismatch". También cubren:
determinismo (misma semilla + params ⇒ mismo replay), que cada estrategia haga al menos
algún punto con sus valores por defecto, que el replay entre en el límite de 256kb del
árbitro, el saneamiento default-deny de `validateParams`, y que los pares de estrategias
del mismo juego jueguen visiblemente distinto entre sí.
