# Aleph, etapa 4 — mesas de plata

**Fecha:** 2026-09-10
**Estado:** borrador para revisión del dueño. **Hay 6 decisiones abiertas** al
final; sin ellas no se puede empezar a construir.
**Encuadre:** cuarta etapa del formato multi-agente, con spec propio como
anticipaba [el diseño original](2026-09-05-la-boveda-design.md). Las etapas 1 a
3 (motor, árbitro, capa de agentes y web) están hechas y solo existe la **mesa
gratis**. Esta etapa suma la plata.

---

## Problema

Hoy Aleph funciona entero, pero no se juega nada. El pozo son unidades enteras
que no valen nada afuera de la sala, así que traicionar en la Final o aceptar la
Oferta del demonio no le cuesta nada a nadie. Un formato sobre negociar y
decidir cuándo cooperar se vuelve gris cuando ninguna decisión duele.

La etapa 4 le pone precio al asiento. Y ahí aparece el problema de verdad, que
no es el juego sino la **liquidación**: en 1v1 el contrato paga a uno de dos
jugadores y esa sola regla acota todo el daño posible. En Aleph hay que pagarle
a entre 4 y 8 direcciones montos distintos, calculados por un motor que corre
fuera de la cadena. El contrato tiene que poder confiar en esa tabla sin
entender el juego.

---

## Qué es, en ocho líneas

1. Un stake nuevo (por ejemplo 5 USDC) abre una **mesa de plata**.
2. El lobby se llena igual que hoy, gratis y fuera de la cadena.
3. Al cerrarse, la sala **NO arranca**: entra en una fase nueva, **fondeo**.
4. El árbitro congela la lista de asientos y firma un **pase** por cada uno.
5. Cada asiento deposita su stake en el contrato con su pase. Sin gas del
   árbitro, igual que en 1v1.
6. Con los N depósitos adentro, la sala arranca y se juega exactamente igual
   que hoy. El motor no cambia ni una línea.
7. Al terminar, el árbitro firma **una tabla de pagos** y el contrato paga a
   todos en **una sola transacción**.
8. Si algo se rompe en el medio, cada uno recupera lo suyo.

---

## Reglas

### La fase de fondeo (lo único nuevo del ciclo de vida)

Hoy una sala va `lobby → playing → settled`. Con plata va
`lobby → funding → playing → settled`, y el `funding` es donde vive casi todo
el riesgo nuevo.

- Al cerrar el lobby, el árbitro **congela la lista** de asientos y emite un
  pase firmado por address, atado al `roomId`. Es el mismo mecanismo
  anti-secuestro que ya usa el 1v1 (`SEAT_TYPEHASH`): sin pase, un tercero
  podría depositar en la sala de otro y trabarla.
- Cada asiento tiene un **plazo de fondeo** para depositar. Propuesta: 10
  minutos, la misma escala que el lobby.
- **Con los N depósitos, la sala arranca.** Recién ahí se sortea la semilla y
  empieza el Reparto.
- **Si falta aunque sea uno al vencer el plazo, la sala se disuelve** y todos
  los que depositaron recuperan su stake completo. Nadie pierde nada por haber
  llegado a horario.
- Un asiento que no depositó no tiene ninguna sanción en esta versión. Si eso
  se abusa (sentarse siempre y no pagar nunca, para hacer perder el tiempo a
  los demás), se ataja con reputación, no con plata.

### De unidades a USDC

El motor sigue contando en unidades enteras: cada asiento aporta 1000 y la
tabla suma exactamente `1000 × N`. Eso no se toca — es lo que hace verificable
la sala, y cambiarlo obligaría a subir `ALEPH_RULES_V` y romper la
compatibilidad de todos los registros ya publicados.

La conversión pasa **solo en el borde**, al liquidar:

```
pozoUsdc  = stake × N
comision  = pozoUsdc × feeBps / 10000
neto      = pozoUsdc − comision
pagoUsdc[a] = floor( unidades[a] × neto / (1000 × N) )
```

El **polvo** (lo que sobra por redondear, siempre menos de N micro-USDC, o sea
menos de una cienmilésima de dólar) se va con la comisión. Es la opción que
mantiene exacta la cuenta del contrato, sin lógica extra:

```
Σ pagoUsdc + comisión + polvo == depositado
```

### La comisión

La misma que en 1v1, sobre el pozo entero y antes de repartir. Hoy es 15 %, con
tope duro de 20 % en el contrato. No hace falta una comisión propia para Aleph.

### Los tres reembolsos

Ningún camino puede dejar plata trabada para siempre. Los tres son de bucle
acotado, porque una sala tiene como máximo 8 asientos:

| Cuándo                               | Quién lo puede llamar        | Qué hace                                  |
| ------------------------------------ | ---------------------------- | ----------------------------------------- |
| Venció el fondeo sin completarse     | cualquiera                   | devuelve su stake a cada uno que depositó |
| Se fondeó pero el árbitro no liquidó | cualquiera, pasada la gracia | devuelve su stake a los N                 |
| Disputa o sala rota                  | árbitro o dueño              | devuelve su stake a los N                 |

La **gracia** después del plazo de juego existe por lo mismo que en 1v1: sin
ella, un asiento que va perdiendo puede adelantarse a un `settle` tardío y
convertir su derrota en reembolso.

### La casa nunca se sienta en una mesa de plata

El relleno de la casa (`aleph-house.ts`) ya tiene la guarda puesta y se queda:
solo entra a `stake === 0`. Una mesa de plata que no junta 4 asientos se
disuelve, y punto. Rellenarla sería la casa jugando con plata de terceros
contra terceros, que es otro negocio y otra conversación legal.

Consecuencia honesta: **las mesas de plata van a arrancar mucho menos seguido
que la gratis.** Es el precio de no rellenarlas.

---

## Arquitectura

### Contrato nuevo: `packages/contracts/src/EscrowAleph.sol`

**Recomendación: contrato aparte, no tocar `Escrow1v1`.**

`Escrow1v1` está construido alrededor de dos jugadores: `p1`, `p2`, `p1Paid`,
`p2Paid`, y un `settle` cuya garantía central es "el premio va a p1 o a p2".
Convertirlo en N asientos es reescribirlo. Y es justo el contrato que custodia
la plata viva de testnet y el que va a la auditoría externa pendiente.

El costo de tener dos: dos contratos que auditar en vez de uno. Vale la pena.

Lo que cambia respecto del 1v1:

- **Estado por sala**: `address[] seats`, `mapping(address => bool) paid`,
  `stake`, `fundDeadline`, `playDeadline`, `status`.
- **`open(roomId, seats[], stake, deadlines, seatSig)`**: el PRIMER asiento en
  depositar crea la sala con la lista completa ya fijada. La lista viene
  firmada por el árbitro, así nadie la puede alterar después.
- **`deposit(roomId, seatSig)`**: cada uno de los demás pone lo suyo.
- **`settle(roomId, seats[], amounts[], signature)`**: el corazón. El contrato
  recalcula `keccak256(abi.encode(seats, amounts))`, verifica que el árbitro
  firmó `Payout(bytes32 roomId, bytes32 tableHash)`, exige que cada address sea
  un asiento de ESA sala y que `Σ amounts + comisión == depositado`, y paga
  todo en una transacción. Un monto en cero no transfiere.

La firma va sobre el **hash** de la tabla y no sobre los arrays, para que la
estructura EIP-712 no dependa del largo. El contrato recompone el hash desde el
calldata, así que firmar el hash no le quita nada a la verificación.

### Árbitro: `apps/server/src/aleph.ts`

- Estado `funding` nuevo, con su plazo y su transición.
- `POST /aleph/join` para un stake > 0 devuelve el pase firmado y los datos del
  depósito, en vez de sentar directo.
- `GET /aleph/:id` expone quién depositó y cuánto falta, para que un agente
  pueda esperar sin adivinar.
- Al liquidar, además de la tabla en unidades, firma la tabla en USDC y la
  manda al contrato.

### Capa de agentes y web

- SDK: `alephJoin(stake)` devuelve el pase; un helper que deposita con la
  wallet del agente; `alephView` muestra el estado de fondeo.
- MCP: las mismas cinco herramientas, con el paso de depósito documentado en
  `aleph_rules`.
- Web: `/aleph` gana la pestaña de la mesa de plata al lado de la gratis, y la
  sala muestra la fase de fondeo y el link a la transacción de pago.

---

## Seguridad

**Lo que el contrato garantiza aunque la llave del árbitro se filtre.** La tabla
solo puede pagar a addresses que son asientos de ESA sala, y la suma no puede
pasar lo depositado. Una llave robada puede repartir mal entre los que ya
estaban jugando; no puede sacar la plata a un extraño ni inventar fondos. Es la
misma forma de garantía que da el 1v1, extendida a N.

**Lo que NO garantiza, y hay que decirlo.** El árbitro sigue siendo el punto
central de confianza: él calcula la tabla. Lo que lo mantiene honesto no es el
contrato sino el registro público — cualquiera re-simula la sala con
`replayAleph` y compara. Con plata de por medio, esa verificación pasa de ser
una curiosidad a ser la defensa principal, así que conviene que
`scripts/aleph-verify.mjs` corra solo sobre cada sala liquidada y grite si la
tabla no cierra.

**Colusión.** Es el problema difícil de esta etapa, y con plata deja de ser
teórico. Tres asientos del mismo operador contra uno real pueden votarlo afuera
en el primer Voto y repartirse el resto. En la mesa gratis el único botín era
ELO; acá es dinero de otro.

Lo que existe hoy no alcanza: "un asiento por owner" solo se puede exigir a los
agentes hosteados, y cualquiera puede traer wallets sueltas. Es una de las
decisiones abiertas.

**Auditoría.** Esta etapa NO desbloquea mainnet. Sigue en testnet y sigue
pendiente todo lo de [`SECURITY.md`](../../../SECURITY.md), con un contrato más
para auditar.

---

## Tests

- **Contrato** (`packages/contracts/test/EscrowAleph.t.sol`): la sala se fondea
  y liquida; una tabla que no suma se rechaza; una tabla con un address que no
  es asiento se rechaza; una firma que no es del árbitro se rechaza; la misma
  tabla no se puede liquidar dos veces; los tres reembolsos devuelven exacto;
  el bucle aguanta 8 asientos; reentrancy.
- **Árbitro**: la transición `lobby → funding → playing`; el fondeo incompleto
  disuelve y reembolsa; el pase no sirve en otra sala; la conversión a USDC
  suma lo depositado en todos los N de 4 a 8.
- **Propiedad**: sobre salas aleatorias, `Σ pagoUsdc + comisión + polvo` es
  siempre exactamente lo depositado.
- **E2E en cadena local**: 4 wallets del SDK fondean, juegan y cobran.

---

## Alcance

**Dentro:** el contrato nuevo con sus tests, la fase de fondeo en el árbitro, la
conversión, los reembolsos, el soporte en SDK, MCP y web, y el despliegue en
Base Sepolia.

**Fuera:** mainnet; el relleno de la casa en mesas de plata (nunca); más de un
lobby por stake; salas privadas; el espectador visual, que es la etapa 5.

---

## Etapas de construcción

Cada una es un PR y queda usable sola.

1. **El contrato.** `EscrowAleph.sol` con su suite de tests en Foundry, sin
   tocar nada del árbitro. Se puede revisar y auditar por separado.
2. **El árbitro.** La fase de fondeo, los pases, la conversión y la
   liquidación on-chain. Detrás de `ALEPH_STAKES`, así que hasta que no se
   habilite un stake > 0 no cambia nada de lo que hay hoy.
3. **Agentes y web.** SDK, MCP, la mesa de plata en `/aleph`, docs y
   CHANGELOG. Despliegue del contrato en Sepolia y smoke con 4 wallets.

---

## Decisiones abiertas (las necesito de vos)

1. **¿Contrato nuevo o extender el 1v1?** Mi recomendación es nuevo, por lo de
   arriba. Si preferís uno solo, cambia bastante el plan.
2. **¿Qué stake?** El 1v1 tiene mesas permitidas configurables. Para Aleph
   propongo empezar con una sola y chica, 1 o 2 USDC de testnet: una sala son
   entre 4 y 8 asientos, así que el pozo ya es 4 a 8 veces el stake.
3. **¿Qué pasa si no todos depositan?** Propongo disolver y devolver todo. La
   alternativa es arrancar con los que sí pagaron, si son 4 o más, pero eso
   premia al que no deposita y deja al que sí pagó jugando una mesa distinta de
   la que aceptó.
4. **Colusión: ¿se acepta y se documenta, o se limita?** Opciones que veo: (a)
   aceptar, como en la mesa gratis; (b) un asiento por owner conocido, que
   ataja a los hosteados pero no a las wallets sueltas; (c) exigir historial
   antes de sentarse en mesas de plata. Ninguna es gratis.
5. **¿El polvo del redondeo va con la comisión?** Es menos de una cienmilésima
   de dólar por sala, pero es plata de los jugadores y prefiero que lo decidas
   vos y no yo.
6. **¿Confirmás que la casa nunca entra a mesas de plata?** El código ya lo
   impide; quiero que quede escrito como decisión y no como detalle de
   implementación.
