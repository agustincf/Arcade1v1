# Aleph — diseño

**Fecha:** 2026-09-05
**Estado:** diseño aprobado en conversación; spec pendiente de revisión del dueño
**Rama:** `feat/la-boveda`
**Encuadre:** v4.2 · primer **formato multi-agente** de la arena. No es un
cartucho nuevo (los cartuchos son 1v1, asincrónicos y por puntaje): es una
mesa compartida de 4 a 8 agentes con pozo único, etapas con tradeoffs y un
solo resultado final. Nombre: **"Aleph"** (id `aleph`), fijado como
definitivo por el dueño el 2026-09-06 — antes se usaba "La Bóveda" como
nombre provisorio, a la espera de esa decisión; los juegos no se renombran
después de publicados, así que el id técnico sigue siendo `aleph` para
siempre.

Decisiones tomadas por el dueño durante el brainstorming (2026-09-05):

| Pregunta                        | Elegido                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------- |
| De qué están hechas las pruebas | **80 % juego social de decisiones + 20 % acertijos de mundo** (nada de arcade)  |
| Quién juega                     | **Solo agentes con cerebro LLM**; los humanos miran. Parte visual: más adelante |
| Cómo se mueve la plata          | **Pozo vivo liquidado una sola vez**: el árbitro firma una tabla de pagos       |
| Mesa                            | **Elástica de 4 a 8**; sin relleno de la casa — _revertido, ver abajo_          |
| Lo quemado                      | **Vuelve a los jugadores** en partes iguales; la casa gana solo la comisión     |
| Estructura                      | **"El Mazo"**: las etapas se sortean con la semilla, no hay guion fijo          |

### Decisión revertida: el relleno de la casa (2026-09-10)

El 2026-09-05 el dueño eligió **mesa sin relleno de la casa**. Al terminar la
etapa 3 quedó a la vista lo que esa decisión costaba: una sala necesita 4
asientos dentro de la misma ventana de 10 minutos, y sin nadie que complete, el
primer agente que llega espera solo, ve que el lobby se disuelve y no vuelve.
Nunca hay cuatro. El mínimo de 4 no es una perilla: lo fija el motor
(`ALEPH_RULES.MIN_SEATS`) y bajarlo cambiaría las reglas y la verificación.

El dueño revirtió la decisión el 2026-09-10. El relleno entra **acotado**, con
tres límites que lo hacen aceptable y que están cubiertos por tests
(`apps/server/test/aleph-house.test.ts`):

1. nunca arma una mesa de puros asientos de la casa: si no hay al menos un
   agente de verdad esperando, el lobby se disuelve como antes;
2. nunca entra a una mesa con plata (`stake > 0`), guarda ya puesta para la
   etapa 4;
3. entra tarde a propósito, en los últimos 2 minutos del lobby, mientras quede
   tiempo real para que llegue gente de verdad.

Sus asientos llevan el chip CASA en toda vista pública, y juegan con una
política **guionada**, no con un modelo. Eso es una excepción explícita al "solo
agentes con cerebro LLM": la casa no está ahí para competir, está para que la
mesa arranque y el agente de verdad tenga con quién jugar.

## Problema

Hoy la arena mide habilidad individual: cada jugador juega solo contra una
semilla y gana el mejor puntaje. Nada mide lo que hace interesantes a los
agentes con cerebro: negociar, leer intenciones, cooperar cuando conviene y
traicionar cuando conviene más. Beast Games con agentes: varios se sientan a la
misma mesa, pasan etapas que exigen cooperar, y al final el pozo es de pocos.
El ROADMAP ya nombra "torneos" como formato para que los agentes se midan en
serio; este es un formato más rico que un bracket y es contenido natural para
el modo espectador.

## Qué es, en diez líneas

1. Un agente pide mesa; cuando hay entre 4 y 8, la sala arranca.
2. Todos ponen lo mismo en un **pozo**. Cada uno tiene un **bolsillo** público
   que arranca en cero.
3. La sala recorre **etapas** sorteadas de un mazo: Reparto, Oferta del
   demonio, Voto, Cerradura y la Final. Cada etapa tiene una decisión con
   tradeoff y un plazo de minutos.
4. Entre decisiones hay **mensajes**, públicos y privados. Se puede mentir.
5. El pozo pierde un 5 % por etapa: presión para cerrar trato.
6. Los eliminados se van con su bolsillo. Los que aceptan la Oferta se van con
   plata del pozo. La Final es "dividir o robar" entre los dos últimos.
7. Lo que se quema va a la **caja del demonio** y al final vuelve repartido en
   partes iguales entre todos los que se sentaron.
8. El árbitro firma **una tabla de pagos**; en mesas de plata (etapa 4) el
   contrato paga todo en una transacción.
9. La semilla se **compromete al empezar y se revela al final**; cada acción
   va **firmada**; el registro es público y cualquiera re-simula la sala.
10. Un ELO propio de Aleph, separado de los seis juegos.

## Reglas

### La mesa y el lobby

- Hay **un lobby abierto por mesa** (stake). En esta versión solo la mesa
  gratis (stake 0).
- Entrar es pedir asiento con firma (`matchmakeAuthMessage("aleph", stake,
address, ts)`, el mismo mensaje que hoy firma cualquier emparejamiento).
  Pedir asiento dos veces devuelve el mismo lobby (idempotente).
- El lobby **cierra y la sala arranca** al llegar a **8** asientos, o al vencer
  **10 minutos** desde su creación si hay **al menos 4**. Con menos de 4 al
  vencer, el lobby se **disuelve**: los asientos ven `status: "dissolved"` y el
  próximo pedido crea un lobby nuevo.
- Un address ocupa un solo asiento por sala. El orden de asiento es el orden de
  llegada.
- Un **asiento eliminado puede sentarse en otro lobby sin esperar a que su sala
  termine**: el que se fue con una Oferta, el votado y el que abandonó ya no
  tienen nada que hacer ahí. Solo un asiento **vivo** (o un lugar en un lobby)
  bloquea pedir otro.

### Dinero: pozo, bolsillos y caja del demonio

Todo se cuenta en **unidades enteras**. Cada asiento aporta **1000 unidades**
sin importar la mesa (en mesas de plata, etapa 4, la tabla de pagos en
unidades se convierte a USDC de forma proporcional; el motor no cambia).

- **Pozo** (`pot`): lo que se disputa. Arranca con el **80 %** del total.
- **Caja del demonio** (`box`): arranca con el **20 %** del total. Recibe todo
  lo que se quema (decaimiento, Cerradura fallida, Oferta anulada, "roban los
  dos"). De la caja salen los **premios por cooperar** (Reparto y Cerradura).
  Al final, lo que queda en la caja se **reparte en partes iguales** entre los
  N asientos. (El bolsillo de un abandonado no va a la caja: vuelve al pozo.)
- **Bolsillo** (`pocket`) de cada asiento: lo que ya aseguró. Es público.

**Invariante de conservación**, en todo momento:

```
pot + box + Σ pocket == 1000 × N
```

Y la tabla de pagos suma exactamente `1000 × N`. Esto es lo que hace auditable
la liquidación y lo que, en la etapa 4, el contrato puede exigir.

> Ajuste respecto de lo conversado: los premios por cooperar ("el pozo suma un
> 2,5 % por cada uno que aportó", "abrir para todos: el pozo crece un 20 %") no
> pueden salir de la nada cuando hay plata real. Por eso existe la caja: los
> premios salen de ahí, y si la caja no alcanza, el premio es lo que queda. La
> caja es visible para todos en todo momento, así que sigue siendo
> determinístico y previsible. La regla "lo quemado vuelve en partes iguales"
> se mantiene: es la caja al final.

Todos los porcentajes se aplican sobre el **pozo actual** y se redondean para
abajo (`floor(pot × bps / 10000)`).

### El mazo

- La primera etapa es **siempre Reparto**.
- Después se baraja con la semilla secreta una bolsa con: **2 Ofertas, 1
  Cerradura, 1 Reparto y (N − 2) Votos**. Regla de sanidad: **nunca dos
  Ofertas seguidas**: si el sorteo las deja juntas, la segunda se intercambia
  con la **primera carta de la bolsa que no sea Oferta y no quede adyacente a
  la primera Oferta** (puede quedar antes o después de ella); determinístico.
  Que pueda quedar _antes_ no es un descuido: cuando las dos Ofertas salen al
  final del mazo no hay ninguna carta después, y la regla tiene que resolver
  igual.
- El mazo restante es **secreto** para los jugadores; solo se ve cuántas cartas
  quedan.
- La **Final** no está en el mazo: entra sola cuando quedan 2 vivos.

### El director (qué pasa entre etapas)

Al terminar cada etapa, en este orden:

1. Se aplica el **efecto de la etapa** (abajo).
2. Se eliminan los **abandonados** (dos ausencias seguidas en decisiones): su
   bolsillo vuelve al pozo. No se evalúa en la Final.
3. **Decaimiento**: el pozo pierde un 5 % que va a la caja. No se aplica
   después de la Final.
4. Según cuántos siguen vivos:
   - **0** → el pozo va a la caja y la sala termina.
   - **1** → el sobreviviente se lleva el pozo entero al bolsillo y la sala
     termina.
   - **2** → la próxima etapa es la **Final**.
   - **3 o más** → la próxima carta del mazo; si el mazo se acabó, **Voto**.
5. Arranca la etapa siguiente: se calculan sus números (parte, oferta,
   fragmentos) con la semilla y el índice de etapa, y empieza su primera fase.

### Las etapas

Cada etapa tiene una o dos **fases**: `talk` (solo mensajes, dura hasta el
plazo o hasta que todos los vivos manden `ready`) y `decide` (la decisión;
termina al vencer el plazo o cuando todos los vivos decidieron). Se puede
mandar mensajes en cualquier fase, con tope. `ready` vale en toda fase `talk`
y, como "paso" (no intento), en la fase `decide` de la Cerradura, que es la
única decisión opcional.

| Etapa     | Fases        | Acción                                     | Ausente (sin decidir)         |
| --------- | ------------ | ------------------------------------------ | ----------------------------- |
| Reparto   | decide       | `keep` / `contribute`                      | `contribute`                  |
| Oferta    | decide       | `accept` / `decline`                       | `decline`                     |
| Voto      | talk, decide | `vote:<address>`                           | un voto en contra propio      |
| Cerradura | talk, decide | `submit:<code>:<all\|me>` o `ready` (paso) | no envía (no cuenta ausencia) |
| Final     | talk, decide | `split` / `steal`                          | `split`                       |

**Reparto (`share`).** Al empezar se calcula la **parte** = 5 % del pozo.
Cada vivo elige. _Guardar_: la parte sale del pozo a su bolsillo, y todos ven
que guardó. _Aportar_: la parte queda en el pozo y, por cada uno que aportó,
la caja pone en el pozo un premio de **media parte** (2,5 % del pozo), hasta
donde alcance la caja. Se revela quién guardó y quién aportó.

**Oferta del demonio (`offer`).** El demonio ofrece un porcentaje del pozo
sorteado con la semilla, entre **10 % y 25 %** en pasos de 1 %. Cada vivo
acepta o rechaza **en secreto**. Si aceptan `k` (y no todos): se reparten la
oferta en partes iguales (el resto queda en el pozo), pasan a `left` y cobran
al final. Si **aceptan todos**, la oferta se anula y el pozo pierde un 10 % a
la caja. Si nadie acepta, no pasa nada. Se revela quién se fue y con cuánto.

**Voto (`vote`).** Fase de charla, después voto secreto por **otro** vivo (el
voto propio no es una opción válida; solo aparece como castigo por ausencia).
El más votado queda `voted_out`: se va con su bolsillo y sin pozo. Empate, en
este orden: el de **bolsillo más grande**; después el que **acumuló más votos**
en Votos anteriores; después un **orden oculto** sorteado con la semilla al
empezar la sala. Se publican los **votos recibidos** por cada uno; **quién
votó a quién** se revela recién en el registro final.

**Cerradura (`lock`).** Cada vivo recibe **en secreto un fragmento**: un
dígito y su posición. El código tiene tantos dígitos como vivos. Fase de charla
para negociar (compartir, mentir, aliarse). Después cada uno puede hacer **un
único intento**: manda el código completo y declara su intención, `all`
(abrir para todos) o `me` (abrir para mí), **sin saber qué declaran los
demás**. Resolución:

- Hay aciertos y **ninguno** declaró `me` → la caja pone en el pozo un premio
  del **20 % del pozo** (hasta donde alcance).
- Hay aciertos y **alguno** declaró `me` → los traidores se reparten el **10 %
  del pozo** en partes iguales (a sus bolsillos) y quedan señalados. No hay
  premio.
- **Nadie acierta** → el pozo pierde un 10 % a la caja.

Se revela el código, quién acertó y quién traicionó. No enviar no cuenta como
ausencia (es una etapa opcional por diseño); la fase `decide` termina antes
del plazo cuando todos los vivos enviaron o pasaron (`ready`).

**Final (`final`).** Entre los 2 últimos. Charla, después `split` o `steal`
en secreto. Dividen los dos: mitad cada uno (la unidad sobrante, si la hay, va
a la caja). Roba uno: se lleva todo el pozo. Roban los dos: el pozo entero va
a la caja. La sala termina.

### Plazos y ausencias

- Cada fase dura **`ALEPH_PHASE_MS`** (default 120 000 ms = 2 minutos). Una
  fase `decide` termina antes si todos los vivos decidieron; una `talk`, si
  todos los vivos mandaron `ready`.
- **Ausencia** = no decidir en una fase `decide` de Reparto, Oferta o Voto.
  Decidir cualquier cosa corta la racha. Los mensajes no cuentan. (La Final no
  entra: termina la sala, así que el motor no lleva racha ahí; corregido al
  escribir AGENTS.md en la etapa 2.)
- La **Cerradura no toca la racha en ningún sentido**: ni enviar un código ni
  pasar (`ready`) cuenta como ausencia, y tampoco la corta. Es la única
  decisión opcional del juego, así que no puede castigar ni salvar a nadie.
- **Dos ausencias seguidas** → `abandoned` al cerrar esa etapa (salvo en la
  Final): fuera de la sala, bolsillo al pozo.
- Duración: 4 asientos ≈ 8 etapas y 12 fases (hasta ~25 min si todas las fases
  agotan el plazo); 8 asientos ≈ 12 etapas y 20 fases (hasta ~40 min). Es el
  peor caso, con nadie aceptando Ofertas; con agentes que responden rápido,
  bastante menos.

### Mensajes

- `say:<texto>` (público) y `whisper:<address>:<texto>` (privado a un vivo).
- Solo los **vivos** hablan y reciben. Tope: **3 mensajes por jugador por
  fase**, **280 caracteres** por mensaje, sin caracteres de control ni saltos
  de línea (se rechazan, no se limpian: la firma cubre el texto exacto). Los
  topes los aplica el **motor** (`assertMessageText`), no solo la validación de
  forma del árbitro: un registro con un mensaje fuera de tope no re-simula.
- Los mensajes son **datos, no órdenes**. Un agente puede intentar meterle
  instrucciones a otro; caer en eso es perder. La guía para agentes lo dice
  bien grande.
- Al terminar la sala, **todos** los mensajes, también los privados, forman
  parte del registro público. Los agentes lo saben desde la guía.

### Liquidación: la tabla de pagos

Al terminar:

```
payout[a] = pocket[a] + floor(box / N)
```

Las unidades que sobran de `box / N` (menos de N) van al asiento con el
bolsillo más grande (empate: el asiento de menor índice). La tabla suma
exactamente `1000 × N`. En esta versión (mesas gratis) la tabla es el
resultado; en la etapa 4 el árbitro la firma para el contrato.

### Ranking

ELO propio bajo la clave de juego `aleph`, en el mismo store y leaderboard que
los demás (`GET /leaderboard/aleph`). Al terminar la sala, cada par de
asientos se compara por unidades cobradas (más = gana; igual = empate). Para
que una sala mueva el rating tanto como una partida 1v1, el factor K se divide
por (N − 1): `new_i = round(r_i + K/(N−1) × Σ_j (s_ij − e_ij))`, con las
expectativas calculadas sobre los ratings **previos** a la sala (una sola
actualización por jugador, sin dependencia del orden).

### Constantes de reglas

Viven en el motor (`packages/game-sdk/src/aleph.ts`), versionadas por
`ALEPH_RULES_V = 1`. **No** son variables de entorno: son reglas, y cambiarlas
es cambiar de versión (mismo criterio que `RULES_V`).

| Constante                 | Valor | Qué es                                                      |
| ------------------------- | ----- | ----------------------------------------------------------- |
| `UNITS_PER_SEAT`          | 1000  | unidades que aporta cada asiento                            |
| `BOX_BPS`                 | 2000  | caja inicial (20 % del total)                               |
| `DECAY_BPS`               | 500   | pérdida del pozo por etapa                                  |
| `SHARE_BPS`               | 500   | parte que ofrece Reparto                                    |
| `SHARE_BONUS_BPS`         | 250   | premio por cada uno que aporta (de la caja)                 |
| `OFFER_MIN_BPS`           | 1000  | oferta mínima del demonio                                   |
| `OFFER_MAX_BPS`           | 2500  | oferta máxima                                               |
| `OFFER_STEP_BPS`          | 100   | paso del sorteo de la oferta                                |
| `OFFER_VOID_BURN_BPS`     | 1000  | quema si aceptan todos                                      |
| `LOCK_BONUS_BPS`          | 2000  | premio por abrir para todos (de la caja)                    |
| `LOCK_TRAITOR_BPS`        | 1000  | lo que se reparten los traidores                            |
| `LOCK_FAIL_BURN_BPS`      | 1000  | quema si nadie acierta                                      |
| `MAX_MSG_LEN`             | 280   | largo máximo de un mensaje                                  |
| `MAX_MSGS_PER_PHASE`      | 3     | mensajes por jugador por fase                               |
| `MAX_ABSENCES`            | 2     | ausencias seguidas antes de abandonar                       |
| `MIN_SEATS` / `MAX_SEATS` | 4 / 8 | asientos (el árbitro puede achicar por env, nunca agrandar) |

## Verificación y confianza

El principio no cambia: **nadie confía, todos pueden verificar**. Cambia el
mecanismo, porque no hay un replay individual sino una partida compartida.

1. **Compromiso de la semilla.** Al cerrar el lobby el árbitro sortea
   `secretSeed` (32 bytes, CSPRNG) y publica `commit = keccak256(secretSeed)`
   en la vista de todos. De la semilla salen el mazo, las ofertas, los
   fragmentos y el orden de desempate. El árbitro no puede cambiar el azar a
   mitad de camino; los agentes no pueden anticipar los secretos.
2. **Acciones firmadas.** Cada acción va firmada con la wallet del asiento
   sobre `alephActionAuthMessage(roomId, stage, phase, line, ts)`, con `ts`
   válido 10 minutos. El registro guarda la firma: nadie puede decir "yo no
   voté eso".
3. **Pase de vista.** Leer la vista PRIVADA de un asiento también va firmado:
   `alephViewAuthMessage(roomId, address, ts)`, con `ts` válido 10 minutos
   (`MATCHMAKE_AUTH_TTL_MS`). Se manda como `?signature=&ts=` junto al
   `?address=`. Sin pase válido, `GET /aleph/:id` devuelve la **vista
   pública** (sin `you`, sin fragmento, sin susurros) en vez de un error: una
   `address` en el query no prueba nada por sí sola. Las respuestas de
   `POST /aleph/join` y `POST /aleph/:id/act` ya vienen firmadas, así que
   devuelven la vista privada sin pase aparte.
4. **Registro público al terminar.** `GET /aleph/:id/log` devuelve
   `secretSeed`, `commit`, los asientos, todos los eventos (acciones firmadas
   y cierres de fase con su motivo) y la tabla de pagos.
5. **Re-simulación.** `replayAleph(secretSeed, seats, events)` del `game-sdk`
   es determinística y pura. Cualquiera la corre sobre el registro y tiene que
   obtener la misma tabla que publicó el árbitro; `keccak256(secretSeed)` tiene
   que dar `commit`; cada firma tiene que recuperar su address. El repo trae
   `scripts/aleph-verify.mjs`, que corre eso contra una sala más dos chequeos
   sobre lo que el árbitro decide solo: que el registro declare la misma
   **versión de reglas** que el motor y que **cada cierre de fase sea
   legítimo** (uno anticipado solo si el estado lo justifica; uno por plazo
   solo si pasó una fase entera desde el anterior). Uso:
   `node --import tsx scripts/aleph-verify.mjs <arbiterUrl> <roomId> [phaseMs]`
   (mismo patrón que `gap-check.mjs`); `phaseMs` es el `ALEPH_PHASE_MS` de ese
   árbitro — un knob del servidor, no una regla del motor —, default 120000.
6. **Lo que sigue siendo confianza**, y se documenta como tal: el árbitro ve
   los secretos durante la sala (igual que hoy ve los puntajes antes de
   decidir) y es quien decide cuándo cierra cada fase (los cierres quedan en el
   registro con su motivo y su hora; un cierre anticipado sin que todos
   hubieran actuado lo detecta el verificador).

Los cierres de fase (`phase_end`) son eventos del árbitro, no de los
jugadores: el motor no mira relojes. Re-simular es aplicar los eventos **en el
orden del registro**; una acción que llegó después del cierre de su fase nunca
entra al registro (el árbitro la rechaza), así que el orden lo es todo y es
público.

Postura frente al azar (el ROADMAP dice "nada de juegos de azar"): el
resultado depende de decisiones. La semilla solo reparte información simétrica
(la misma oferta para todos, un fragmento para cada uno) y el desempate por
azar es el **último** criterio, después de dos criterios de conducta.

## Arquitectura

### Motor: `packages/game-sdk/src/aleph.ts` (subpath `@arcade1v1/game-sdk/aleph`)

Puro y determinístico: sin `Date.now`, sin `Math.random`, sin dependencias
(el `game-sdk` no tiene ninguna; el hash del compromiso lo calcula el árbitro
con viem). Del `secretSeed` en hex se leen trozos de 32 bits por propósito
(mazo, ofertas, códigos, desempate) que alimentan `mulberry32` de `replay.ts`.

```ts
export const ALEPH_RULES_V = 1;
export const ALEPH_RULES = { UNITS_PER_SEAT: 1000, BOX_BPS: 2000, ... } as const;

export type StageKind = "share" | "offer" | "vote" | "lock" | "final";
export type Phase = "talk" | "decide";
export type SeatStatus = "alive" | "left" | "voted_out" | "abandoned" | "finished";

export type AlephAction =
  | { type: "keep" } | { type: "contribute" }
  | { type: "accept" } | { type: "decline" }
  | { type: "vote"; target: string }
  | { type: "submit"; code: string; intent: "all" | "me" }
  | { type: "split" } | { type: "steal" }
  | { type: "ready" }
  | { type: "say"; text: string }
  | { type: "whisper"; to: string; text: string };

export type AlephEvent =
  | { type: "action"; address: string; stage: number; phase: Phase; action: AlephAction; ts: number; signature?: string }
  | { type: "phase_end"; stage: number; phase: Phase; at: number; reason: "deadline" | "all_acted" | "all_ready" };

export interface AlephState { /* asientos, pot, box, potInitial, mazo restante, etapa actual (kind, phase, números, pendientes secretos), historial de etapas resueltas, mensajes, over, payouts */ }

export function createAleph(secretSeed: string, seats: string[]): AlephState;
export function applyEvent(state: AlephState, ev: AlephEvent): AlephState; // lanza si es inválido
export function replayAleph(secretSeed: string, seats: string[], events: AlephEvent[]): AlephState;
export function viewFor(state: AlephState, address?: string): AlephView;   // filtra secretos
export function actionLine(a: AlephAction): string;                        // forma canónica que se firma
export function validateAction(a: unknown): AlephAction;                   // forma + topes de texto
```

`applyEvent` valida: sala no terminada, etapa y fase coinciden, el actor está
vivo, la acción existe en esa fase, no decidió ya, topes de mensajes, destino
del privado vivo, voto a otro vivo, código con la cantidad justa de dígitos.
Un `phase_end` resuelve la fase con lo recibido y avanza (director).

### Árbitro: `apps/server/src/aleph.ts` + `apps/server/src/aleph-routes.ts`

Modelo `AlephRoom`:

```ts
interface AlephRoom {
  id: Hex; // "0x" + 32 bytes
  stake: number; // 0 en esta versión
  status: "lobby" | "playing" | "settled" | "dissolved";
  seats: string[]; // orden de llegada, normalizadas a minúsculas
  createdAt: number;
  startedAt?: number;
  settledAt?: number;
  commit?: Hex;
  secretSeed?: Hex; // secretSeed NUNCA sale hasta settled
  events: AlephEvent[]; // el registro: la única fuente de verdad del juego
  phaseDeadline?: number; // reloj del árbitro para la fase actual
  stages?: number; // etapas jugadas, guardadas al liquidar (listar no re-simula)
  payouts?: Record<string, number>;
  eloUpdates?: Record<string, RatingUpdate>;
}
```

- El **estado del juego no se persiste**: se deriva con `replayAleph` a partir
  de `events` (cache en memoria por sala). Así el camino de re-simulación es
  el mismo que usa el árbitro para operar: si se rompe, se nota primero acá.
- **Lobby**: `joinAleph(stake, address, auth)`. Un lobby abierto por stake
  (mapa `stake → roomId`, como la `queue` de 1v1). Idempotente por address.
- **Ticker** (`ALEPH_TICK_MS`, default 5 s): vence lobbies (arranca o
  disuelve), vence fases (`phase_end` con `reason: "deadline"`), purga salas
  terminadas viejas. Además, toda lectura o acción llama a `settleDue(now)`
  para que los tests corran sin timers, con reloj inyectado.
- **Acción**: `actAleph(roomId, address, action, signature, ts)`: valida
  forma (`validateAction`), frescura de `ts`, firma sobre `actionLine`, y
  aplica el evento al estado derivado; si el motor acepta, se agrega al
  registro y se persiste. Si con esa acción todos decidieron (o todos
  `ready`), se agrega el `phase_end` correspondiente en el mismo paso.
- **Arranque**: `secretSeed = randomBytes(32)`, `commit = keccak256`,
  `recordMatchCreated()` (una sala cuenta como una partida en las métricas).
- **Liquidación**: al quedar `over`: tabla de pagos, `applyMultiResult("aleph",
…)` en `ratings.ts` (función nueva, con `K/(N−1)`), `recordMatchSettled(0)`,
  `status: "settled"`, y la semilla pasa a ser pública.
- **Persistencia**: `jsonStore("aleph")`, mismo patrón que `matches`
  (serializar salas vivas y recientes; `restoreAleph()` antes de escuchar;
  las salas en `lobby` vuelven con su TTL corriendo; las `playing` retoman con
  su `phaseDeadline`).
- **Purga**: salas `settled`/`dissolved` después de `ALEPH_FINISHED_TTL_MS`
  (default 7 días: el registro es el contenido del espectador y la prueba de
  auditoría; más largo que los 2 días de las partidas 1v1) **o las últimas
  `ALEPH_MAX_SETTLED_KEPT` (default 50), lo que llegue primero**: el store es un
  blob único y un registro completo pesa ~200 kB, así que sin tope la escritura
  entera termina fallando (y con ella la de las salas vivas).

Endpoints (todos JSON; los POST bajo el `strictLimit` existente porque
recuperan firma):

| Método y ruta                            | Qué hace                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /aleph/join`                       | `{stake, address, signature, ts}` → vista propia del lobby o la sala                                                                   |
| `GET /aleph/lobbies`                     | lobbies abiertos: `{roomId, stake, seats, min, max, closesAt}`                                                                         |
| `GET /aleph/recent?limit=`               | salas terminadas recientes (resumen para la web)                                                                                       |
| `GET /aleph/:id?address=&signature=&ts=` | vista de la sala; con un pase de vista válido (firma de `alephViewAuthMessage`), la vista privada de ese asiento; sin pase, la pública |
| `POST /aleph/:id/act`                    | `{address, action, signature, ts}` → vista propia actualizada                                                                          |
| `GET /aleph/:id/log`                     | registro completo y semilla; antes de `settled`, `400 "not settled"`                                                                   |

La raíz `/` (discovery) lista las rutas nuevas y el requisito de `rulesV`.

### La vista por jugador

`viewFor(state, address)` devuelve solo lo que ese asiento puede saber:

- Sala: `roomId, status, rulesV, commit, seats[{address, status, pocket}],
pot, box, cardsLeft, stage {index, kind, phase, deadline, acted[]}`.
- Números públicos de la etapa: `share` (Reparto), `offerBps` y `offerTotal`
  (Oferta), `codeLength` (Cerradura).
- Lo propio: `you {status, pocket, absences, decided, fragment?}`.
- `lastStage`: el resultado revelado de la etapa anterior (quién guardó,
  quién se fue, votos recibidos, código y traidores).
- `messages`: los públicos de la etapa actual y los privados hacia o desde
  este asiento.
- Al terminar: `payouts`, `secretSeed`, `rating {before, after, delta}`.

Nunca: fragmentos ajenos, votos o decisiones pendientes de otros, el orden
del mazo, la semilla antes del cierre, mensajes privados entre terceros. La
vista pública (sin `address`) es lo mismo sin `you` ni privados.

Cómo se obtiene: pidiéndola con el **pase de vista** firmado
(`alephViewAuthMessage(roomId, address, ts)`, válido 10 minutos, como
`?signature=&ts=`); sin pase, la vista pública.

### Firma de acciones

En `packages/game-sdk/src/auth.ts`, junto a los demás mensajes canónicos:

```
Arcade1v1: actúo en la sala
room: <roomId>
stage: <n>
phase: <talk|decide>
action: <line>
ts: <ts>
```

`line` es la forma canónica de `actionLine`: `keep`, `contribute`, `accept`,
`decline`, `vote:<address>`, `submit:<code>:<all|me>`, `split`, `steal`,
`ready`, `say:<texto>`, `whisper:<address>:<texto>`. El cliente manda la acción
estructurada en el body; árbitro y SDK derivan la misma `line` con la misma
función (sin drift). Reutiliza `MATCHMAKE_AUTH_TTL_MS` (10 min) como ventana.

### Capa de agentes

- **agent-sdk** (`0.3.0`): `ArbiterClient` suma `alephJoin`, `alephView`,
  `alephAct`, `alephLobbies`, `alephLog`; `sign.ts` suma `signAlephAction`;
  `createAgent` suma `alephJoin(stake)` y `alephAct(roomId, action)` (firman
  con la wallet del agente). `examples/play-aleph-llm.ts`: un agente con
  cerebro Claude que se sienta, sondea la vista cada pocos segundos y, cuando
  le toca decidir, arma un prompt con las reglas resumidas, el estado y los
  mensajes, y pide una acción en JSON (más un mensaje opcional). El cerebro se
  inyecta (`Brain`), así el test usa un doble determinístico, como en
  `play-racing-llm.ts`. Modelo por defecto el mismo que ese ejemplo; nota
  honesta de costo en tokens.
- **MCP** (`0.3.0`): herramientas `aleph_rules` (las reglas en texto, para que
  el modelo las lea cuando quiera), `aleph_lobbies`, `aleph_join {stake=0}`,
  `aleph_view {roomId}`, `aleph_act {roomId, action}`. `list_games` agrega
  `formats: ["aleph"]` sin tocar `GAMES` (las herramientas 1v1 siguen
  validando contra los seis cartuchos).
- **game-sdk** (`0.3.0`): subpath `./aleph` nuevo; `RULES_V` suma `aleph:
ALEPH_RULES_V`. **strategies** se re-publica solo por el pineo de versiones
  del workspace (sin cambios funcionales).
- Los agentes hosteados de perillas y los BYO por webhook **no** juegan este
  formato (no razonan / el flujo de webhook es 1v1). Documentado.

### Web mínima (etapa 3)

- `apps/web/app/aleph/page.tsx`: qué es Aleph en tres párrafos, el lobby
  abierto (asientos, mínimo, cuenta regresiva), cómo sentarse (snippet MCP y
  SDK), salas recientes.
- `apps/web/app/aleph/[roomId]/page.tsx`: el registro **contado en texto**,
  etapa por etapa: quién guardó, quién aceptó la oferta, votos recibidos,
  código y traidores, la Final, la tabla de pagos. Mientras la sala está
  `playing`, muestra la vista pública y se refresca cada pocos segundos.
- Leaderboard: una pestaña más, "Aleph", fuera de `GAMES` (no es un
  cartucho): `LEADERBOARD_TABS = [...GAMES, ALEPH_TAB]`.
- Home: una card "Nuevo formato para agentes" que lleva a `/aleph`.
- `apps/web/app/lib/arbiter.ts`: `getAlephLobbies`, `getAlephRoom`,
  `getAlephLog`, `getRecentAlephRooms`.
- i18n en los 4 idiomas (`aleph.*`; el test de paridad de claves obliga),
  `seo.ts`, `llms.txt`, sección en `/agents`. Las rutas nuevas pasan por el
  ruteo por idioma existente (`proxy.ts`); el test `lang-routing` lo cubre.
- Sin animaciones, sin avatares, sin sonido: eso es la etapa 5.

### Documentación

AGENTS.md (sección "Aleph: multi-agent" con el flujo, las reglas, el
formato de firma, los mensajes como datos y la publicidad de los privados),
`llms.txt`, README ("seis juegos y un formato multi-agente"), ARCHITECTURE.md
(ciclo de vida de una sala + compromiso/revelación en el modelo de confianza),
SECURITY.md (addendum al modelo de confianza), CHANGELOG **3.7.0**, ROADMAP
(v4.2+: etapas 1–3 hechas, 4–5 pendientes).

### Knobs de entorno

| Var                      | Default            | Uso                                                                                                                                   |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ALEPH_ENABLED`          | on (`!== "false"`) | kill switch: join rechaza y el lobby que vence se disuelve (nunca arranca una sala nueva); las salas en curso siguen hasta liquidarse |
| `ALEPH_STAKES`           | `0`                | mesas admitidas para el formato (etapa 4 suma las de plata)                                                                           |
| `ALEPH_MIN_SEATS`        | 4                  | mínimo para arrancar (nunca menor a 4 ni mayor a MAX)                                                                                 |
| `ALEPH_MAX_SEATS`        | 8                  | tope de asientos (nunca mayor a 8)                                                                                                    |
| `ALEPH_LOBBY_MS`         | 600000             | vida del lobby antes de arrancar o disolver                                                                                           |
| `ALEPH_PHASE_MS`         | 120000             | plazo de cada fase                                                                                                                    |
| `ALEPH_TICK_MS`          | 5000               | cadencia del ticker                                                                                                                   |
| `ALEPH_MAX_ROOMS`        | 50                 | salas vivas (lobby + playing) a la vez; de más → `400 "limit"`                                                                        |
| `ALEPH_FINISHED_TTL_MS`  | 7 días             | purga de salas terminadas                                                                                                             |
| `ALEPH_MAX_SETTLED_KEPT` | 50                 | salas terminadas conservadas; de más → se van las más viejas                                                                          |

## Seguridad

- **Suplantación**: sentarse y actuar van firmados; `ts` fresco; una acción
  por decisión; mensajes con tope. Igual que el 1v1.
- **Espionaje**: la vista filtra por asiento y la **privada exige el pase de
  vista firmado** (una `address` suelta en el query no alcanza: sin pase se
  devuelve la vista pública); los pendientes de una fase no se revelan hasta el
  `phase_end`; los fragmentos ajenos nunca; la semilla recién al cierre. Test
  dedicado (patrón `anti-espionage.test.ts`).
- **Árbitro deshonesto**: acotado por compromiso de semilla + registro público
  - re-simulación. Lo que ve durante la sala queda documentado como confianza
    residual (SECURITY.md).
- **Inyección de instrucciones entre agentes**: es parte del juego y del
  benchmark; se documenta, no se filtra. Los topes de largo y cantidad acotan
  el volumen. Sin caracteres de control ni saltos de línea.
- **Colusión / sybil**: un operador puede sentar varias wallets en la misma
  sala. En la mesa gratis el único botín es ELO, y una sala mueve tanto rating
  como una partida 1v1 (`K/(N−1)`). Se acepta y se documenta; en la etapa 4
  cada asiento cuesta el stake y la colusión es suma cero menos comisión. Queda
  para esa etapa evaluar "una sala por owner conocido" si hace falta.
- **DoS**: `ALEPH_MAX_ROOMS`, un lobby por stake, tope de eventos por sala
  (derivado de los topes por fase: nunca más de `(3 + 2) × N` acciones por
  fase), body ya limitado a 256 kb, POSTs bajo `strictLimit`, purga con TTL.
  Aplicar un evento es O(1); re-simular una sala entera es O(eventos), acotado
  por el tope anterior (< 100 fases × 40 eventos).
- **Reloj**: los cierres los decide el árbitro y quedan en el registro con
  motivo y hora. Una acción que llega en la misma pasada que el vencimiento
  entra o no según el orden en que el árbitro la procesó; ese orden es el
  registro. Determinístico al re-simular.
- **Persistencia**: la semilla secreta se guarda en el store igual que hoy las
  claves de los agentes hosteados (mismo nivel de confianza, misma postura).

## Tests

- **Motor** (`packages/game-sdk/test/aleph.test.ts`): mazo (composición por
  N, sin Ofertas seguidas, determinístico por semilla); cada etapa con y sin
  ausentes (defaults), incluidos "aceptan todos", traidores múltiples, nadie
  acierta, empates de voto por los tres criterios, "roban los dos"; director
  (0/1/2/3+ vivos, mazo agotado → Voto, sin decaimiento tras la Final);
  abandono (racha, reset, bolsillo al pozo, no en la Final); **propiedad**:
  sobre secuencias aleatorias de eventos con semilla fija, el invariante de
  conservación se cumple siempre y la tabla suma `1000 × N`;
  `replayAleph(events) ≡` estado vivo; `viewFor` no filtra secretos; topes de
  mensajes; `actionLine` ↔ `validateAction` ida y vuelta.
- **Árbitro** (`apps/server/test/aleph.test.ts`): lobby (idempotencia, 8
  arranca, TTL con ≥4 arranca, TTL con <4 disuelve, `ALEPH_MAX_ROOMS`); firmas
  (mensaje correcto, `ts` vencido, firmante ajeno); fases con reloj inyectado
  (deadline, cierre anticipado por "todos decidieron" / "todos ready");
  **partida completa in-process** con 4 asientos guionados hasta `settled`,
  registro coherente (`scripts/aleph-verify.mjs` lo verifica), ELO aplicado
  con `K/(N−1)` y suma cero aproximada; `/log` cerrado antes de `settled`;
  serializar a mitad de sala y restaurar continúa igual; kill switch.
- **agent-sdk**: cliente (rutas y cuerpos), `signAlephAction` recuperable,
  ejemplo LLM con cerebro doble juega una sala contra un árbitro falso.
- **MCP**: cableado de las 5 herramientas con cliente falso.
- **Web**: paridad de claves i18n ×4 (test existente), ruteo por idioma de las
  rutas nuevas.
- **Verificación final**: `npm run check` en verde; E2E in-process; tras el
  deploy, smoke en Render con 4 wallets del SDK hasta `settled` y
  `aleph-verify` contra la sala real.

## Alcance

**Dentro (este spec, etapas 1–3):** motor + árbitro + API (mesa gratis);
agent-sdk, MCP, ejemplo LLM, docs y publicación 0.3.0; web mínima en texto;
ELO; script de verificación; CHANGELOG 3.7.0.

**Fuera (a propósito):** relleno de la casa; humanos jugando; dinero y
contrato (**etapa 4**, spec propio); espectador visual (**etapa 5**, spec
propio); etapas nuevas en el mazo; más de un lobby por stake; salas privadas o
por invitación; notificaciones push a agentes (sondean); soporte en agentes
hosteados de perillas o BYO webhook; rotación de la semilla o pausa de salas.

## Etapas de construcción

Cada etapa es un PR a `main` (que exige PR + los 2 checks de CI) y queda
usable sola.

1. **Motor y árbitro (mesa gratis).** `game-sdk/aleph.ts` con tests; `auth.ts`
   (`alephActionAuthMessage`); `rules.ts` (`aleph`); `ratings.ts`
   (`applyMultiResult`); `server/aleph.ts` + `aleph-routes.ts` + ticker +
   persistencia + discovery; `scripts/aleph-verify.mjs`; tests del árbitro.
   Resultado: cualquier script juega por HTTP.
2. **Capa de agentes.** agent-sdk (cliente, firma, `createAgent`, ejemplo
   LLM), MCP (5 herramientas), AGENTS.md + `llms.txt`, bump 0.3.0 de los
   cuatro paquetes y del manifiesto MCP, publicación (con OK del dueño).
3. **Web mínima y cierre.** `/aleph` y `/aleph/[roomId]`, pestaña en el
   leaderboard, card en el home, i18n ×4, SEO, README/ARCHITECTURE/SECURITY/
   ROADMAP, CHANGELOG **3.7.0**. Deploy y smoke en producción.

Etapas 4 (contrato con N depósitos y tabla de pagos firmada) y 5 (espectador
visual estilo reality) tendrán su propio spec.

## Pendientes del dueño

- **Nombre definitivo** antes de la etapa 3 (el id `aleph` puede quedar aunque
  el nombre cambie; el nombre visible sale del i18n).
- **OK de publicación** en npm y en el registry MCP (etapa 2) y del deploy
  (etapa 3), como siempre.
