// RELLENO DE LA CASA en Aleph. Lo que se prueba acá son los tres límites que
// hacen que el relleno sea aceptable, y que una mesa rellenada de verdad llega
// hasta el final:
//
//  1. nunca arma una mesa de puros asientos de la casa;
//  2. nunca entra mientras todavía queda tiempo real para que llegue gente;
//  3. la sala completada juega hasta `settled` y la tabla de pagos cierra.
//
// Correr: node --import tsx --test apps/server/test/aleph-house.test.ts
import "../src/offline-env.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { actionLine, viewFor, type AlephAction } from "@arcade1v1/game-sdk/aleph";
import { matchmakeAuthMessage, alephActionAuthMessage } from "@arcade1v1/game-sdk/auth";

// Como en producción: firma obligatoria. Con 4 asientos máximos la sala arranca
// apenas se completa, sin esperar el reloj. Fase larga: las fases cierran porque
// TODOS deciden, que es justo lo que el relleno tiene que lograr.
process.env.REQUIRE_AUTH = "true";
process.env.ALEPH_MAX_SEATS = "4";
process.env.ALEPH_PHASE_MS = String(60 * 60_000);
// Mesa de plata (2 USDC) además de la gratis, para el test de más abajo que
// prueba que la casa NUNCA la completa. `aleph.js` lee ALEPH_STAKES al
// importarse y `aleph-chain.js` captura ALEPH_ESCROW_ADDRESS en una constante
// de módulo: tienen que estar seteadas ACÁ, antes del import de abajo, no
// adentro del test. Los demás tests de este archivo siguen pidiendo stake 0 y
// no se ven afectados.
process.env.ALEPH_STAKES = "0,2";
process.env.ALEPH_ESCROW_ADDRESS = "0x" + "e".repeat(40);

const V = await import("../src/aleph.js");
const H = await import("../src/aleph-house.js");
const Seats = await import("../src/aleph-house-seats.js");

const LOBBY_MS = V.ALEPH_LOBBY_MS;
/** Un instante DENTRO de la ventana de relleno (los últimos 2 minutos). */
const inFillWindow = (t0: number) => t0 + LOBBY_MS - 30_000;

/** Un agente de verdad: wallet suelta que firma sus propias acciones. */
function realAgent() {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const address = account.address.toLowerCase();
  return {
    address,
    async join(now: number) {
      const signature = await account.signMessage({
        message: matchmakeAuthMessage("aleph", 0, address, now),
      });
      return V.joinAleph(0, address, { signature, ts: now }, now);
    },
    async act(
      roomId: string,
      stage: number,
      phase: "talk" | "decide",
      action: AlephAction,
      now: number,
    ) {
      const signature = await account.signMessage({
        message: alephActionAuthMessage(roomId, stage, phase, actionLine(action), now),
      });
      return V.actAleph(roomId, address, { stage, phase, action, signature, ts: now }, now);
    },
  };
}

beforeEach(() => {
  V.__resetAlephForTest();
  delete process.env.ALEPH_HOUSE_ENABLED;
});

test("no completa un lobby vacío: la casa nunca arma una mesa de puros bots", async () => {
  const t0 = Date.now();
  // Un lobby existe solo si alguien pidió asiento, así que se fabrica uno y se
  // le saca el asiento real: el caso límite es "quedó vacío".
  const a = realAgent();
  await a.join(t0);
  const room = V.liveAlephRooms(t0).find((r) => r.status === "lobby")!;
  room.seats = [];

  await H.alephHouseTick(inFillWindow(t0));
  assert.equal(room.seats.length, 0, "sin nadie de verdad esperando, la casa no se sienta");
});

test("no se sienta mientras todavía queda tiempo para que llegue gente de verdad", async () => {
  const t0 = Date.now();
  const a = realAgent();
  await a.join(t0);

  await H.alephHouseTick(t0 + 60_000); // recién arrancado el lobby de 10 minutos
  const room = V.liveAlephRooms(t0 + 60_000).find((r) => r.status === "lobby")!;
  assert.equal(room.seats.length, 1, "todavía no es hora: el asiento real sigue solo");
});

test("completa el lobby que está por vencerse y la sala arranca", async () => {
  const t0 = Date.now();
  const a = realAgent();
  await a.join(t0);

  const t1 = inFillWindow(t0);
  await H.alephHouseTick(t1);

  const room = V.liveAlephRooms(t1).find((r) => r.seats.includes(a.address))!;
  assert.equal(room.seats.length, 4, "la casa completó hasta el mínimo");
  assert.equal(room.status, "playing", "con los 4 asientos la sala arranca");
  const house = room.seats.filter((s) => Seats.isAlephHouseAddress(s));
  assert.equal(house.length, 3, "tres asientos de la casa, uno de verdad");
});

test("el kill switch propio apaga el relleno sin apagar Aleph", async () => {
  process.env.ALEPH_HOUSE_ENABLED = "false";
  const t0 = Date.now();
  const a = realAgent();
  await a.join(t0);

  await H.alephHouseTick(inFillWindow(t0));
  const room = V.liveAlephRooms(t0).find((r) => r.seats.includes(a.address))!;
  assert.equal(room.seats.length, 1, "apagado, la casa no toca nada");
  assert.equal(room.status, "lobby");
});

test("una mesa completada por la casa llega hasta el final y la tabla de pagos cierra", async () => {
  const t0 = Date.now();
  const a = realAgent();
  await a.join(t0);
  let now = inFillWindow(t0);
  await H.alephHouseTick(now);

  const roomId = V.liveAlephRooms(now).find((r) => r.seats.includes(a.address))!.id;

  // El agente de verdad juega cooperativo y sin sorpresas: lo que se está
  // probando es que la casa hace avanzar la mesa, no quién gana.
  for (let guard = 0; guard < 200; guard++) {
    const room = V.liveAlephRooms(now).find((r) => r.id === roomId);
    if (!room || room.status !== "playing") break;
    await H.alephHouseTick(now);

    const after = V.liveAlephRooms(now).find((r) => r.id === roomId);
    if (!after || after.status !== "playing") break;
    const v = viewFor(V.stateOf(after), a.address);
    const you = v.you;
    if (you?.status === "alive") {
      const st = v.stage;
      const pending = st.phase === "talk" ? !you.ready : !you.decided;
      if (pending) {
        const alive = v.seats.filter((s) => s.status === "alive" && s.address !== a.address);
        const action: AlephAction =
          st.phase === "talk"
            ? { type: "ready" }
            : st.kind === "share"
              ? { type: "contribute" }
              : st.kind === "offer"
                ? { type: "decline" }
                : st.kind === "vote"
                  ? { type: "vote", target: alive[0].address }
                  : st.kind === "lock"
                    ? { type: "ready" }
                    : { type: "split" };
        await a.act(roomId, st.index, st.phase, action, now);
      }
    }
    now += 1000; // el reloj corre, pero muy por debajo del plazo de fase
  }

  const done = V.alephLog(roomId, now);
  assert.ok(done.payouts, "la sala liquidó");
  assert.equal(
    Object.values(done.payouts!).reduce((x, y) => x + y, 0),
    4000,
    "la tabla de pagos suma 1000 por asiento: nada se creó ni se perdió",
  );
  assert.ok(
    done.events.every((e) => e.type !== "action" || e.signature),
    "todas las acciones del registro van firmadas, también las de la casa",
  );
});

test("la casa nunca puede anular la oferta sola: solo uno de los suyos la acepta", () => {
  const greedy = { ...Seats.houseSeats()[0], temperament: "greedy" as const };
  const view = {
    stage: {
      index: 1,
      kind: "offer" as const,
      phase: "decide" as const,
      acted: [],
      offerBps: 2500,
    },
    seats: [{ address: greedy.address, status: "alive" as const, pocket: 0 }],
    messages: [],
    you: { status: "alive" as const, pocket: 0, absences: 0, decided: false, ready: false },
  } as unknown as Parameters<typeof H.houseAction>[1];

  assert.deepEqual(H.houseAction(greedy, view, "0xroom", false), { type: "accept" });
  assert.deepEqual(
    H.houseAction(greedy, view, "0xroom", true),
    { type: "decline" },
    "si otro de la casa ya aceptó, este declina",
  );
});

// La CERRADURA es la etapa que un guionado no debería poder pasar: cada asiento
// tiene una sola posición del código y hay que negociar para juntarlas. La casa
// la resuelve cantando su fragmento en un formato fijo, y leyendo el de los
// demás. Si esto se rompe, la etapa se vuelve imposible y el pozo se quema cada
// vez que sale la carta.
function lockView(opts: {
  phase: "talk" | "decide";
  mine?: { pos: number; digit: string };
  said?: { from: string; text: string }[];
  codeLength?: number;
}) {
  const stage = {
    index: 2,
    kind: "lock" as const,
    phase: opts.phase,
    acted: [],
    codeLength: opts.codeLength ?? 4,
  };
  return {
    stage,
    seats: [],
    messages: (opts.said ?? []).map((m) => ({ ...m, stage: 2, phase: opts.phase })),
    you: {
      status: "alive",
      pocket: 0,
      absences: 0,
      decided: false,
      ready: false,
      fragment: opts.mine,
    },
  } as unknown as Parameters<typeof H.houseAction>[1];
}

test("cerradura: el que coopera canta su fragmento y el avaro se lo calla", () => {
  const [coop] = Seats.houseSeats();
  const greedy = { ...coop, temperament: "greedy" as const };
  const mine = { pos: 2, digit: "7" };

  assert.deepEqual(
    H.houseAction(
      { ...coop, temperament: "cooperative" },
      lockView({ phase: "talk", mine }),
      "0xroom",
      false,
    ),
    {
      type: "say",
      text: "#2=7",
    },
  );
  assert.deepEqual(
    H.houseAction(greedy, lockView({ phase: "talk", mine }), "0xroom", false),
    { type: "ready" },
    "el avaro no regala su pieza",
  );
});

test("cerradura: arma el código con los fragmentos cantados, y espera si falta alguno", () => {
  const [coop] = Seats.houseSeats();
  const mine = { pos: 0, digit: "7" };
  const todos = [
    { from: "0xa", text: "#1=3" },
    { from: "0xb", text: "gm · #2=9" },
    { from: "0xc", text: "#3=1" },
  ];

  assert.deepEqual(
    H.houseAction(
      { ...coop, temperament: "cooperative" },
      lockView({ phase: "decide", mine, said: todos }),
      "0xroom",
      false,
    ),
    { type: "submit", code: "7391", intent: "all" },
    "con las 4 posiciones arma el código y la abre para todos",
  );
  assert.deepEqual(
    H.houseAction(
      { ...coop, temperament: "greedy" },
      lockView({ phase: "decide", mine, said: todos }),
      "0xroom",
      false,
    ),
    { type: "submit", code: "7391", intent: "me" },
    "el avaro la abre solo para sí",
  );
  assert.deepEqual(
    H.houseAction(
      { ...coop, temperament: "cooperative" },
      lockView({ phase: "decide", mine, said: todos.slice(0, 1) }),
      "0xroom",
      false,
    ),
    { type: "ready" },
    "si falta una posición no inventa un código",
  );
});

// REGRESIÓN del peor bug del relleno. En la Cerradura, "paso" se manda como
// `ready`, y el motor lo guarda aparte de las decisiones. El barrido miraba
// solo `decided`, así que reintentaba el mismo paso cada 5 segundos y el motor
// lo rechazaba una y otra vez hasta que venciera el plazo: 15 rechazos
// logueados en una sola sala.
//
// Llegar a una Cerradura hace falta fijar la SEMILLA: el mazo sale de ahí y de
// ningún otro lado, así que sin fijarla el test caía en esa etapa una de cada
// seis corridas y pasaba en verde con el bug adentro.
const SEMILLA_CON_CERRADURA =
  "0x358c0c52129d876f566a1bd6d04ff14236faef87f26601e3a5a1f1dcc1df2c92" as const;

test("cerradura: el paso del relleno NO se reintenta en cada barrido", async () => {
  V.__forceAlephSeedForTest(SEMILLA_CON_CERRADURA);
  const t0 = Date.now();
  const a = realAgent();
  await a.join(t0);
  let now = inFillWindow(t0);
  await H.alephHouseTick(now);

  const roomId = V.liveAlephRooms(now).find((r) => r.seats.includes(a.address))!.id;
  const roomNow = () => V.liveAlephRooms(now).find((r) => r.id === roomId)!;
  const viewNow = () => viewFor(V.stateOf(roomNow()), a.address);
  assert.equal(viewNow().stage.kind, "share", "la primera etapa siempre es el Reparto");

  // Avanzar hasta la FASE DE DECISIÓN de la Cerradura: la casa y el agente de
  // verdad actúan hasta que el mazo saque esa carta.
  for (let guard = 0; guard < 20; guard++) {
    const st = viewNow().stage;
    if (st.kind === "lock" && st.phase === "decide") break;
    await H.alephHouseTick(now);
    // El barrido pudo cerrar la fase: se relee ANTES de actuar, si no el agente
    // manda una acción de la etapa anterior y el motor la rechaza con razón.
    const v = viewNow();
    if (v.stage.kind === "lock" && v.stage.phase === "decide") break;
    const you = v.you!;
    if (v.stage.phase === "talk" ? !you.ready : !you.decided) {
      await a.act(
        roomId,
        v.stage.index,
        v.stage.phase,
        v.stage.phase === "talk" ? { type: "ready" } : { type: "contribute" },
        now,
      );
    }
    now += 1000;
  }
  const st = viewNow().stage;
  assert.equal(st.kind, "lock");
  assert.equal(st.phase, "decide", "la semilla fijada llevó la sala a la Cerradura");

  // Primer barrido en esta fase: los asientos que no pueden armar el código
  // pasan con `ready`. El segundo barrido NO tiene que volver a intentarlo.
  await H.alephHouseTick(now);
  const pasaron = Seats.houseSeats()
    .filter((s) => roomNow().seats.includes(s.address))
    .map((s) => viewFor(V.stateOf(roomNow()), s.address).you!);
  assert.ok(
    pasaron.some((you) => you.ready && !you.decided),
    "al menos un asiento de la casa pasó la Cerradura con `ready`",
  );

  const original = console.error;
  const gritos: string[] = [];
  console.error = (...args: unknown[]) => void gritos.push(args.join(" "));
  try {
    await H.alephHouseTick(now + 5_000);
    await H.alephHouseTick(now + 10_000);
  } finally {
    console.error = original;
  }
  assert.deepEqual(gritos, [], "el barrido no vuelve a mandar el paso ya dado");
});

test("la casa NUNCA completa una mesa de plata: el lobby de 2 USDC vence solo y se disuelve", async () => {
  // Decisión 6 del spec de la etapa 4: rellenar una mesa con plata sería la
  // casa jugando con plata de terceros contra terceros. La guarda
  // (`room.stake !== 0`) ya estaba en fillLobbies; este test la fija.
  const { setAlephChainForTest } = await import("../src/aleph-chain.js");
  setAlephChainForTest({
    readRoom: async () => ({ status: 0, paidCount: 0, depositors: [] }),
    feeBps: async () => 1500,
    usdcAddress: async () => ("0x" + "1".padStart(40, "0")) as `0x${string}`,
    cancelRoom: async () => "0x" as `0x${string}`,
    settle: async () => "0x" as `0x${string}`,
  });
  try {
    V.__resetAlephForTest();
    const t0 = Date.now();
    // Un agente de verdad pidiendo la mesa de 2 USDC (no `realAgent()`, que
    // firma siempre para la gratis).
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const address = account.address.toLowerCase();
    const signature = await account.signMessage({
      message: matchmakeAuthMessage("aleph", 2, address, t0),
    });
    const room = await V.joinAleph(2, address, { signature, ts: t0 }, t0);
    assert.equal(room.status, "lobby");
    // A 1 minuto del cierre, con un agente real esperando: en la gratis la
    // casa entraría; acá no.
    await H.alephHouseTick(t0 + LOBBY_MS - 60_000);
    const still = (await V.getAlephRoom(room.roomId, undefined, t0 + LOBBY_MS - 60_000))!;
    assert.equal(still.seats.length, 1, "la casa no se sentó");
    const gone = (await V.getAlephRoom(room.roomId, undefined, t0 + LOBBY_MS))!;
    assert.equal(gone.status, "dissolved");
  } finally {
    setAlephChainForTest(undefined);
  }
});
