// La fase de FONDEO de una mesa de plata, con una cadena falsa (sin nodo):
// lobby → funding → playing, el pase por asiento, el fondeo incompleto que
// disuelve y reembolsa, la liquidación firmada y enviada, el reintento y la
// persistencia. Reloj SIEMPRE inyectado.
// Correr: node --import tsx --test apps/server/test/aleph-funding.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { alephViewAuthMessage } from "@arcade1v1/game-sdk/auth";
import { ALEPH_ESCROW_STATUS, usdcPayoutTable, type AlephAction } from "@arcade1v1/game-sdk/aleph";

process.env.ALEPH_STAKES = "0,2";
process.env.ALEPH_ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "84532";
process.env.ALEPH_MAX_SEATS = "4";
const V = await import("../src/aleph.js");
const C = await import("../src/aleph-chain.js");
const S = await import("../src/sign.js");

const T0 = 1_800_000_000_000;
const wallets = () => {
  const pk = generatePrivateKey();
  return { pk, address: privateKeyToAccount(pk).address.toLowerCase() as Hex };
};

/** Cadena falsa: recuerda depósitos por sala y las escrituras que le pidieron. */
function fakeChain() {
  const rooms = new Map<string, { status: number; depositors: string[] }>();
  const calls: { fn: string; args: unknown[] }[] = [];
  let failSettle = 0;
  let settleError = "rpc down";
  let readsFail: string | undefined;
  const f = {
    rooms,
    calls,
    /** Lecturas de la comisión: una por tabla ARMADA (y por lo tanto firmada). */
    feeReads: 0,
    /** Lecturas de sala: una sala ya cerrada no se vuelve a leer nunca más. */
    roomReads: 0,
    failSettleTimes(n: number, message = "rpc down") {
      failSettle = n;
      settleError = message;
    },
    /** Un nodo que no contesta: `readRoom` rechaza hasta que se pase undefined. */
    failReadsWith(message: string | undefined) {
      readsFail = message;
    },
    deposit(roomId: string, address: string, seatsTotal: number) {
      const r = rooms.get(roomId) ?? { status: ALEPH_ESCROW_STATUS.Funding, depositors: [] };
      r.depositors.push(address.toLowerCase());
      if (r.depositors.length >= seatsTotal) r.status = ALEPH_ESCROW_STATUS.Funded;
      rooms.set(roomId, r);
    },
    async readRoom(roomId: Hex) {
      f.roomReads++;
      if (readsFail) throw new Error(readsFail);
      const r = rooms.get(roomId);
      return r
        ? { status: r.status, paidCount: r.depositors.length, depositors: [...r.depositors] }
        : { status: ALEPH_ESCROW_STATUS.None, paidCount: 0, depositors: [] };
    },
    async feeBps() {
      f.feeReads++;
      return 1500;
    },
    async usdcAddress() {
      return ("0x" + "0".repeat(39) + "1") as Hex;
    },
    async cancelRoom(roomId: Hex) {
      calls.push({ fn: "cancelRoom", args: [roomId] });
      const r = rooms.get(roomId);
      if (!r) throw new Error("execution reverted: cant cancel");
      r.status = ALEPH_ESCROW_STATUS.Refunded;
      return ("0x" + "c".repeat(64)) as Hex;
    },
    async settle(roomId: Hex, seats: Hex[], amounts: bigint[], signature: Hex) {
      calls.push({ fn: "settle", args: [roomId, seats, amounts, signature] });
      if (failSettle > 0) {
        failSettle--;
        throw new Error(settleError);
      }
      rooms.get(roomId)!.status = ALEPH_ESCROW_STATUS.Settled;
      return ("0x" + "5".repeat(64)) as Hex;
    },
  };
  return f;
}

/** Corre algo silenciando console.error y devuelve lo que se logueó. */
async function quiet(fn: () => Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const real = console.error;
  console.error = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = real;
  }
  return logs;
}

/** El pase que quedó GUARDADO en el blob del store (no el que se re-firmaría). */
function savedPass(raw: string, roomId: string, address: string): string | undefined {
  const saved = JSON.parse(raw) as { id: string; passes?: Record<string, string> }[];
  return saved.find((r) => r.id === roomId)?.passes?.[address];
}

async function seatView(roomId: string, w: { pk: Hex; address: Hex }, now: number) {
  const acc = privateKeyToAccount(w.pk);
  const ts = now;
  const signature = await acc.signMessage({ message: alephViewAuthMessage(roomId, w.address, ts) });
  return (await V.getAlephRoom(roomId, w.address, now, { signature, ts }))!;
}

/** Sienta 4 wallets en la mesa de 2: con ALEPH_MAX_SEATS=4 el lobby cierra al 4to. */
async function fundingRoom(now: number) {
  const ws = [wallets(), wallets(), wallets(), wallets()];
  let v;
  for (const w of ws) v = await V.joinAleph(2, w.address, undefined, now);
  assert.equal(v!.status, "funding");
  return { ws, roomId: v!.roomId };
}

// El rechazo de una mesa de plata SIN escrow no se puede probar acá (este
// archivo corre con ALEPH_ESCROW_ADDRESS seteada, y aleph-chain la captura al
// importarse): vive en aleph-funding-no-escrow.test.ts, su propio proceso.
test("un stake fuera de la lista se rechaza, y el error lista las mesas que sí hay", async () => {
  V.__resetAlephForTest();
  await assert.rejects(
    () => V.joinAleph(5, wallets().address, undefined, T0),
    /stake not allowed: 5 \(mesas: 0, 2\)/,
  );
  assert.deepEqual(V.ALEPH_STAKES, [0, 2]);
});

test("al cerrar, el lobby de plata NO arranca: entra en funding con la lista congelada y un pase por asiento", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);

  const pub = (await V.getAlephRoom(roomId, undefined, T0 + 1))!;
  assert.equal(pub.status, "funding");
  assert.equal(pub.commit, undefined, "sin semilla hasta que esté fondeada");
  assert.equal(pub.fundingDeadline, T0 + V.ALEPH_FUNDING_MS);
  assert.equal(pub.closesAt, T0 + V.ALEPH_FUNDING_MS);
  assert.deepEqual(pub.deposited, []);
  assert.equal(pub.deposit, undefined, "la vista pública no trae el pase");

  const mine = await seatView(roomId, ws[1], T0 + 2);
  const d = mine.deposit!;
  assert.equal(d.escrow, process.env.ALEPH_ESCROW_ADDRESS);
  assert.equal(d.chainId, 84532);
  assert.equal(d.stake, "2000000");
  assert.deepEqual(
    d.seats,
    ws.map((w) => w.address),
  );
  assert.equal(d.fundDeadline, Math.floor((T0 + V.ALEPH_FUNDING_MS) / 1000));
  assert.equal(d.playDeadline, d.fundDeadline + Math.floor(V.ALEPH_PLAY_WINDOW_MS / 1000));
  assert.equal(d.seatsHash, S.alephSeatsHash(ws.map((w) => w.address)));
  // El pase verifica contra el árbitro con exactamente esos campos.
  const who = await recoverTypedDataAddress({
    domain: S.alephDomain(),
    types: S.ALEPH_SEAT_TYPES,
    primaryType: "Seat",
    message: {
      roomId: roomId as Hex,
      seatsHash: d.seatsHash as Hex,
      stake: BigInt(d.stake),
      fundDeadline: BigInt(d.fundDeadline),
      playDeadline: BigInt(d.playDeadline),
      player: ws[1].address,
    },
    signature: d.seatSig as Hex,
  });
  assert.equal(who.toLowerCase(), S.arbiterAddress().toLowerCase());
  // Un pase es de SU asiento: el de ws[1] no es el de ws[2].
  const other = await seatView(roomId, ws[2], T0 + 2);
  assert.notEqual(other.deposit!.seatSig, d.seatSig);
  // Volver a pedir asiento devuelve ESTA sala (ocupada mientras fondea), con el pase.
  const again = await V.joinAleph(2, ws[1].address, undefined, T0 + 3);
  assert.equal(again.roomId, roomId);
  assert.equal(again.deposit!.seatSig, d.seatSig);
  // No hay lobby abierto de 2 (la sala en fondeo se lista aparte, con su estado).
  const lobbies = V.listAlephLobbies(T0 + 3);
  assert.deepEqual(
    lobbies.map((l) => [l.stake, l.status, l.deposited]),
    [[2, "funding", 0]],
  );
  C.setAlephChainForTest(undefined);
});

test("con los N depósitos en la cadena, la sala arranca (semilla + compromiso) y la casa no toca nada", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws.slice(0, 3)) chain.deposit(roomId, w.address, 4);
  await V.alephChainTick(T0 + 10_000);
  let v = (await V.getAlephRoom(roomId, undefined, T0 + 10_000))!;
  assert.equal(v.status, "funding");
  assert.deepEqual(
    v.deposited,
    ws.slice(0, 3).map((w) => w.address),
  );
  chain.deposit(roomId, ws[3].address, 4);
  await V.alephChainTick(T0 + 20_000);
  v = (await V.getAlephRoom(roomId, undefined, T0 + 20_000))!;
  assert.equal(v.status, "playing");
  assert.match(String(v.commit), /^0x[0-9a-f]{64}$/);
  assert.equal(v.startedAt, T0 + 20_000);
  assert.equal(v.stage!.kind, "share");
  assert.equal(v.pot, 3200, "el motor sigue en unidades");
  C.setAlephChainForTest(undefined);
});

test("si falta aunque sea un depósito al vencer el plazo, la sala se disuelve y el árbitro cancela on-chain", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws.slice(0, 3)) chain.deposit(roomId, w.address, 4);
  await V.alephChainTick(T0 + V.ALEPH_FUNDING_MS - 1);
  assert.equal(
    (await V.getAlephRoom(roomId, undefined, T0 + V.ALEPH_FUNDING_MS - 1))!.status,
    "funding",
  );
  await V.alephChainTick(T0 + V.ALEPH_FUNDING_MS);
  const gone = (await V.getAlephRoom(roomId, undefined, T0 + V.ALEPH_FUNDING_MS))!;
  assert.equal(gone.status, "dissolved");
  // El reembolso sale en el mismo tick (o el siguiente): cancelRoom pedido una sola vez.
  await V.alephChainTick(T0 + V.ALEPH_FUNDING_MS + 5_000);
  assert.deepEqual(
    chain.calls.map((c) => c.fn),
    ["cancelRoom"],
  );
  assert.equal(chain.rooms.get(roomId)!.status, ALEPH_ESCROW_STATUS.Refunded);
  // Los asientos quedan libres: pueden sentarse en otra mesa.
  const next = await V.joinAleph(2, ws[0].address, undefined, T0 + V.ALEPH_FUNDING_MS + 6_000);
  assert.notEqual(next.roomId, roomId);
  assert.equal(next.status, "lobby");
  C.setAlephChainForTest(undefined);
});

test("una sala en fondeo donde NADIE depositó se disuelve sin mandar transacción", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { roomId } = await fundingRoom(T0);
  await V.alephChainTick(T0 + V.ALEPH_FUNDING_MS);
  await V.alephChainTick(T0 + V.ALEPH_FUNDING_MS + 5_000);
  assert.equal(
    (await V.getAlephRoom(roomId, undefined, T0 + V.ALEPH_FUNDING_MS + 5_000))!.status,
    "dissolved",
  );
  assert.deepEqual(
    chain.calls,
    [],
    "cancelar una sala que no existe on-chain revertiría: no se manda",
  );
  // Y queda CERRADA: un reembolso resuelto no se vuelve a leer en cada tick
  // (si no, esta sala pediría una lectura cada 5 s durante los 7 días del TTL).
  const reads = chain.roomReads;
  await V.alephChainTick(T0 + V.ALEPH_FUNDING_MS + 10_000);
  await V.alephChainTick(T0 + V.ALEPH_FUNDING_MS + 15_000);
  assert.equal(chain.roomReads, reads, "sala cerrada, cero lecturas nuevas");
  C.setAlephChainForTest(undefined);
});

test("con la cadena ilegible, la sala en fondeo se disuelve igual pasada la gracia y deja pedido el reembolso", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws.slice(0, 2)) chain.deposit(roomId, w.address, 4);
  chain.failReadsWith("rpc down"); // el árbitro no puede leer NADA de la cadena

  // El tick de cadena no puede hacer nada con esta sala: la loguea y sigue.
  const logs = await quiet(() => V.alephChainTick(T0 + V.ALEPH_FUNDING_MS + 1));
  assert.deepEqual(
    logs.map((l) => l.split(" ")[0]),
    ["[aleph-chain]"],
  );
  assert.equal(
    (await V.getAlephRoom(roomId, undefined, T0 + V.ALEPH_FUNDING_MS + 1))!.status,
    "funding",
    "todavía dentro de la gracia: el camino normal tiene su chance",
  );
  // Pasada la gracia la disuelve el RELOJ, sin depender de leer la cadena.
  const dead = T0 + V.ALEPH_FUNDING_MS + V.ALEPH_FUNDING_GRACE_MS;
  assert.equal((await V.getAlephRoom(roomId, undefined, dead))!.status, "dissolved");
  // Y los asientos quedan libres EN EL ACTO. Sin esto quedaban encerrados para
  // siempre, y cada sala colgada gastaba un lugar del tope de salas vivas, que
  // es COMPARTIDO: una caída de la cadena carteleaba también la mesa gratis.
  const free = await V.joinAleph(0, ws[0].address, undefined, dead + 1);
  assert.notEqual(free.roomId, roomId);
  assert.equal(free.status, "lobby");
  // El reembolso quedó PEDIDO: cuando la cadena vuelve, sale el cancelRoom.
  chain.failReadsWith(undefined);
  await V.alephChainTick(dead + 2);
  assert.deepEqual(
    chain.calls.map((c) => c.fn),
    ["cancelRoom"],
  );
  assert.equal(chain.rooms.get(roomId)!.status, ALEPH_ESCROW_STATUS.Refunded);
  // Reembolsada = cerrada: no se manda un segundo cancelRoom ni se relee.
  const reads = chain.roomReads;
  await V.alephChainTick(dead + 3);
  assert.deepEqual(
    chain.calls.map((c) => c.fn),
    ["cancelRoom"],
  );
  assert.equal(chain.roomReads, reads, "sala cerrada, cero lecturas nuevas");
  C.setAlephChainForTest(undefined);
});

/** Política guionada (misma que aleph-game.test.ts) para llevar la sala al final. */
function policy(v: Awaited<ReturnType<typeof V.getAlephRoom>>, me: string): AlephAction {
  const st = v!.stage!;
  if (st.phase === "talk") return { type: "ready" };
  const alive = v!.seats.filter((s) => s.status === "alive");
  switch (st.kind) {
    case "share":
      return { type: me === alive[0].address ? "keep" : "contribute" };
    case "offer":
      return { type: "decline" };
    case "vote":
      return { type: "vote", target: (alive.find((s) => s.address !== me) ?? alive[0]).address };
    case "lock":
      return { type: "ready" };
    default:
      return { type: "split" };
  }
}

async function playToSettled(roomId: string, ws: { pk: Hex; address: Hex }[], from: number) {
  let now = from;
  for (let guard = 0; guard < 400; guard++) {
    const probe = (await V.getAlephRoom(roomId, undefined, now))!;
    if (probe.status === "settled") return now;
    for (const w of ws) {
      const v = await seatView(roomId, w, now);
      const you = v.you;
      if (v.status !== "playing" || !you || you.status !== "alive" || you.decided || you.ready)
        continue;
      await V.actAleph(
        roomId,
        w.address,
        { stage: v.stage!.index, phase: v.stage!.phase, action: policy(v, w.address) },
        now,
      );
      now += 100;
    }
  }
  throw new Error("la sala no terminó");
}

test("al liquidar: tabla en USDC que cierra exacto, firma publicada, settle enviado; con reintento si la cadena falla", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws) chain.deposit(roomId, w.address, 4);
  await V.alephChainTick(T0 + 1_000);
  chain.failSettleTimes(1); // la primera transacción falla (RPC caído)
  const end = await playToSettled(roomId, ws, T0 + 2_000);

  await V.alephChainTick(end + 1);
  let v = (await V.getAlephRoom(roomId, undefined, end + 1))!;
  assert.equal(v.status, "settled");
  assert.ok(v.payoutsUsdc, "la tabla en USDC se publica aunque la transacción haya fallado");
  assert.ok(v.payoutSig, "y su firma también: cualquiera puede presentarla");
  assert.equal(v.settleTx, undefined);
  const expected = usdcPayoutTable(
    ws.map((w) => w.address),
    v.payouts!,
    2_000_000n,
    1500,
  );
  assert.deepEqual(
    ws.map((w) => BigInt(v.payoutsUsdc![w.address])),
    expected.amounts,
  );
  const paid = expected.amounts.reduce((x, y) => x + y, 0n);
  assert.equal(paid + expected.fee + expected.dust, 8_000_000n);
  assert.equal(chain.calls.filter((c) => c.fn === "settle").length, 1);

  // Backoff: en el tick siguiente todavía no reintenta; pasado el plazo, sí.
  await V.alephChainTick(end + 2);
  assert.equal(chain.calls.filter((c) => c.fn === "settle").length, 1);
  await V.alephChainTick(end + 60 * 60_000);
  v = (await V.getAlephRoom(roomId, undefined, end + 60 * 60_000))!;
  assert.equal(v.settleTx, "0x" + "5".repeat(64));
  assert.equal(chain.calls.filter((c) => c.fn === "settle").length, 2);
  // La firma que se mandó recupera al árbitro sobre la tabla exacta.
  const sent = chain.calls.filter((c) => c.fn === "settle").at(-1)!.args as [
    Hex,
    Hex[],
    bigint[],
    Hex,
  ];
  assert.deepEqual(
    sent[1],
    ws.map((w) => w.address),
  );
  assert.deepEqual(sent[2], expected.amounts);
  // La tabla se arma y se firma UNA SOLA VEZ por sala, pase lo que pase: la
  // firma no lleva nonce, así que dos tablas distintas de la misma sala serían
  // dos órdenes de pago válidas. El reintento solo vuelve a MANDAR la misma.
  assert.equal(chain.feeReads, 1, "la comisión se lee una vez: una tabla, una firma");
  assert.equal(sent[3], v.payoutSig, "se manda exactamente la tabla que se publicó");
  const who = await recoverTypedDataAddress({
    domain: S.alephDomain(),
    types: S.ALEPH_PAYOUT_TYPES,
    primaryType: "Payout",
    message: { roomId: roomId as Hex, tableHash: S.alephTableHash(sent[1], sent[2]) },
    signature: sent[3],
  });
  assert.equal(who.toLowerCase(), S.arbiterAddress().toLowerCase());

  // El registro público lleva la parte en USDC.
  const log = V.alephLog(roomId, end + 60 * 60_000 + 1);
  assert.equal(log.usdc!.escrow, process.env.ALEPH_ESCROW_ADDRESS);
  assert.equal(log.usdc!.feeBps, 1500);
  assert.deepEqual(log.usdc!.table, v.payoutsUsdc);
  assert.equal(log.usdc!.signature, v.payoutSig);
  assert.equal(log.usdc!.settleTx, v.settleTx);
  // Y las salas recientes también.
  assert.equal(V.recentAlephRooms(5, end + 60 * 60_000 + 1)[0].settleTx, v.settleTx);
  C.setAlephChainForTest(undefined);
});

test("un revert que ni se puede clasificar igual espera el backoff, y al clasificarlo cierra SIN hash", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws) chain.deposit(roomId, w.address, 4);
  await V.alephChainTick(T0 + 1_000);
  const end = await playToSettled(roomId, ws, T0 + 2_000);
  const settles = () => chain.calls.filter((c) => c.fn === "settle").length;

  // Otro presentó la tabla antes que el árbitro, así que su settle revierte...
  chain.rooms.get(roomId)!.status = ALEPH_ESCROW_STATUS.Settled;
  chain.failSettleTimes(99, "execution reverted: not funded");
  // ...y encima la lectura que explicaría POR QUÉ tampoco contesta.
  chain.failReadsWith("rpc down");
  await V.alephChainTick(end + 1);
  assert.equal(settles(), 1);
  let v = (await V.getAlephRoom(roomId, undefined, end + 2))!;
  assert.equal(v.settleOutcome, undefined, "sin poder leer no se clasifica nada");
  assert.equal(v.settleTx, undefined);
  // Lo que NO puede pasar: volver a intentar en el acto contra un RPC caído.
  await V.alephChainTick(end + 2);
  assert.equal(settles(), 1, "el fallo de la lectura también se va al backoff");

  // Con la cadena de vuelta, el próximo intento clasifica y cierra la sala.
  chain.failReadsWith(undefined);
  await V.alephChainTick(end + 60 * 60_000);
  assert.equal(settles(), 2);
  v = (await V.getAlephRoom(roomId, undefined, end + 60 * 60_000 + 1))!;
  assert.equal(v.settleOutcome, "external", "la presentó otro: cerrada, sin hash propio");
  assert.equal(v.settleTx, undefined, "settleTx lleva SOLO hashes de verdad (la web los linkea)");
  // Y ya no se insiste nunca más.
  await V.alephChainTick(end + 5 * 60 * 60_000);
  assert.equal(settles(), 2);
  C.setAlephChainForTest(undefined);
});

test("la mesa gratis sigue exactamente igual: sin fondeo, sin cadena", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  let v;
  for (let i = 0; i < 4; i++) v = await V.joinAleph(0, wallets().address, undefined, T0);
  assert.equal(v!.status, "playing");
  await V.alephChainTick(T0 + 1);
  assert.deepEqual(chain.calls, []);
  assert.equal(v!.deposit, undefined);
  C.setAlephChainForTest(undefined);
});

test("persistencia: una sala en fondeo restaura con su plazo, sus depósitos y sus pases", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  chain.deposit(roomId, ws[0].address, 4);
  await V.alephChainTick(T0 + 1);
  const before = await seatView(roomId, ws[2], T0 + 2);
  const raw = V.serializeAleph();
  // El pase tiene que VIAJAR en el blob. Comparar las dos vistas no probaría
  // nada: firmar es determinístico (RFC 6979), así que tirar `room.passes` a la
  // basura daría exactamente los mismos bytes al re-firmar.
  assert.equal(
    savedPass(raw, roomId, ws[2].address),
    before.deposit!.seatSig,
    "el pase firmado se GUARDA, no se re-firma al volver",
  );
  V.__resetAlephForTest();
  V.restoreAlephFrom(raw);
  const after = await seatView(roomId, ws[2], T0 + 3);
  assert.equal(after.status, "funding");
  assert.equal(after.fundingDeadline, before.fundingDeadline);
  assert.deepEqual(after.deposited, [ws[0].address]);
  assert.equal(
    savedPass(V.serializeAleph(), roomId, ws[2].address),
    before.deposit!.seatSig,
    "y sobrevive a restaurar",
  );
  C.setAlephChainForTest(undefined);
});
