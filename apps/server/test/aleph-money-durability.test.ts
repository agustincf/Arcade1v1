// LO QUE EL ÁRBITRO NO PUEDE OLVIDAR de una mesa de plata. Dos garantías, las
// dos sobre el mismo registro en memoria que se guarda en el store:
//
//  1. La TABLA DE PAGOS FIRMADA se guarda ANTES de mandarse, y ANTES de
//     mostrarse. `settle` es permissionless, así que dos tablas distintas
//     firmadas para la misma sala son dos órdenes de pago y cobra la que alguien
//     presente primero (la firma vence, pero mientras vive, vale). Con el
//     debounce de 20 s de persist.ts, una caída dura (OOM/crash) entre firmar y
//     escribir dejaba una sala restaurada que re-simula a OTRA tabla y la firma;
//     si la primera ya se había visto, quedaban dos. Una firma que nunca salió
//     del proceso antes de guardarse no la vio nadie: perderla no deja nada.
//
//  2. Una sala TERMINADA con plata pendiente en la cadena no se borra: ni por el
//     tope de salas conservadas (que corre en CADA request) ni por el TTL.
//     Borrarla es olvidar en silencio un pago o un reembolso que quedó pedido.
//
// Corre en su propio proceso porque necesita la persistencia PRENDIDA contra un
// Upstash falso (persist.ts captura las variables al importarse) y un tope de
// salas conservadas chiquito. Reloj SIEMPRE inyectado.
// Correr: node --import tsx --test apps/server/test/aleph-money-durability.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ALEPH_ESCROW_STATUS, type AlephAction } from "@arcade1v1/game-sdk/aleph";

// ---- Un Upstash de mentira, para VER las escrituras del store -----------------
let failSetsLeft = 0;
const writes: { key: string; body: string }[] = [];
const upstash = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => void chunks.push(c));
  req.on("end", () => {
    const url = decodeURIComponent(req.url ?? "");
    if (url.startsWith("/set/")) {
      if (failSetsLeft > 0) {
        failSetsLeft--;
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "caído" }));
        return;
      }
      writes.push({ key: url.slice("/set/".length), body: Buffer.concat(chunks).toString("utf8") });
      res.end(JSON.stringify({ result: "OK" }));
    } else {
      res.end(JSON.stringify({ result: null })); // sin datos guardados
    }
  });
});
await new Promise<void>((ok) => void upstash.listen(0, "127.0.0.1", ok));
upstash.unref();
const port = (upstash.address() as AddressInfo).port;

/** El último blob de Aleph que llegó al store (undefined = nunca se escribió). */
const savedBlob = () => writes.filter((w) => w.key === "arcade:aleph").at(-1)?.body;

process.env.ARCADE_PERSIST = "1";
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${port}`;
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-mentira";
// Una hora de debounce: NINGUNA escritura puede llegar sola durante el test. Lo
// que aparezca en el Upstash falso salió sí o sí de un flush explícito.
process.env.PERSIST_DEBOUNCE_MS = "3600000";
process.env.ALEPH_STAKES = "0,2";
process.env.ALEPH_ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "84532";
process.env.ALEPH_MAX_SEATS = "4";
process.env.ALEPH_MAX_SETTLED_KEPT = "2"; // el tope, chiquito, para poder ejercerlo
const V = await import("../src/aleph.js");
const C = await import("../src/aleph-chain.js");

const T0 = 1_800_000_000_000;
const wallet = () => {
  const pk = generatePrivateKey();
  return { pk, address: privateKeyToAccount(pk).address.toLowerCase() as Hex };
};

/** Cadena falsa: lo mínimo para fondear, liquidar y cancelar. */
function fakeChain() {
  const rooms = new Map<string, { status: number; depositors: string[] }>();
  let readsFail: string | undefined;
  const f = {
    rooms,
    calls: [] as string[],
    /** El blob guardado EN EL INSTANTE en que salió el `settle`. */
    blobAtSettle: undefined as string | undefined,
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
      if (readsFail) throw new Error(readsFail);
      const r = rooms.get(roomId);
      return r
        ? { status: r.status, paidCount: r.depositors.length, depositors: [...r.depositors] }
        : { status: ALEPH_ESCROW_STATUS.None, paidCount: 0, depositors: [] };
    },
    async feeBps() {
      return 1500;
    },
    async usdcAddress() {
      return ("0x" + "0".repeat(39) + "1") as Hex;
    },
    async cancelRoom(roomId: Hex) {
      f.calls.push("cancelRoom");
      rooms.get(roomId)!.status = ALEPH_ESCROW_STATUS.Refunded;
      return ("0x" + "c".repeat(64)) as Hex;
    },
    /** Lo que mandó cada `settle`: la firma y su vencimiento. */
    sentSigs: [] as { deadline: bigint; sig: Hex }[],
    async settle(roomId: Hex, _s: Hex[], _a: bigint[], deadline: bigint, sig: Hex) {
      f.calls.push("settle");
      f.sentSigs.push({ deadline, sig });
      f.blobAtSettle = savedBlob();
      rooms.get(roomId)!.status = ALEPH_ESCROW_STATUS.Settled;
      return ("0x" + "5".repeat(64)) as Hex;
    },
  };
  return f;
}

/** Sienta 4 wallets en la mesa de 2: con ALEPH_MAX_SEATS=4 el lobby cierra al 4to. */
async function fundingRoom(now: number) {
  const ws = [wallet(), wallet(), wallet(), wallet()];
  let v;
  for (const w of ws) v = await V.joinAleph(2, w.address, undefined, now);
  assert.equal(v!.status, "funding");
  return { ws, roomId: v!.roomId };
}

/** Política guionada (misma que aleph-funding.test.ts) para llegar al final. */
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

async function playToSettled(roomId: string, ws: { address: Hex }[], from: number) {
  let now = from;
  for (let guard = 0; guard < 400; guard++) {
    if ((await V.getAlephRoom(roomId, undefined, now))!.status === "settled") return now;
    for (const w of ws) {
      // Sin firma: en tests AUTH_REQUIRED es false y la vista privada se sirve igual.
      const v = (await V.getAlephRoom(roomId, w.address, now))!;
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

/** Una sala GRATIS que nace y muere sola: un solo asiento, el lobby vence y se
 *  disuelve. Sirve de relleno para empujar el tope de salas conservadas. */
async function deadFreeRoom(at: number): Promise<string> {
  const v = await V.joinAleph(0, wallet().address, undefined, at);
  V.settleDue(at + V.ALEPH_LOBBY_MS); // vence el lobby: menos del mínimo, se disuelve
  return v.roomId;
}

function finishedIds(): string[] {
  const saved = JSON.parse(V.serializeAleph()) as { id: string; status: string }[];
  return saved.filter((r) => r.status === "settled" || r.status === "dissolved").map((r) => r.id);
}

test("la tabla de pagos firmada llega al store ANTES de que salga el settle", async () => {
  V.__resetAlephForTest();
  writes.length = 0;
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws) chain.deposit(roomId, w.address, 4);
  await V.alephChainTick(T0 + 1_000);
  const end = await playToSettled(roomId, ws, T0 + 2_000);

  // Hasta acá NADA se escribió: con el debounce en una hora, todo lo que pasó
  // (el lobby, el fondeo, la partida entera) sigue solo en memoria.
  assert.equal(savedBlob(), undefined, "sin flush no hay escritura: el debounce no venció");

  await V.alephChainTick(end + 1);
  const v = (await V.getAlephRoom(roomId, undefined, end + 2))!;
  assert.equal(v.settleTx, "0x" + "5".repeat(64));
  assert.ok(v.payoutSig, "la tabla se firmó y se publicó");

  // LO QUE IMPORTA: en el instante en que el `settle` salió a la cadena, el
  // store YA tenía esta tabla y esta firma. Si el proceso muere justo ahí, la
  // sala restaurada encuentra su tabla firmada y no firma una segunda.
  assert.ok(
    chain.blobAtSettle,
    "el settle salió sin que la tabla firmada estuviera guardada (se perdería en un OOM)",
  );
  const guardada = (JSON.parse(chain.blobAtSettle!) as { id: string; chain?: typeof v }[]).find(
    (r) => r.id === roomId,
  );
  assert.equal(guardada?.chain?.payoutSig, v.payoutSig, "y es EXACTAMENTE la tabla que se mandó");
  assert.deepEqual(guardada?.chain?.payoutsUsdc, v.payoutsUsdc);
  C.setAlephChainForTest(undefined);
});

test("si guardar la tabla firmada falla, el settle NO sale; el reintento la guarda antes de publicar", async () => {
  V.__resetAlephForTest();
  writes.length = 0;
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws) chain.deposit(roomId, w.address, 4);
  await V.alephChainTick(T0 + 1_000);
  const end = await playToSettled(roomId, ws, T0 + 2_000);

  failSetsLeft = 1; // Upstash rechaza la próxima escritura
  await V.alephChainTick(end + 1);
  assert.deepEqual(chain.calls, [], "sin la tabla guardada, el settle no sale");
  // Firmada en memoria, pero SIN guardar: no sale del proceso. Ni la vista ni el
  // registro público la muestran, así que si el proceso muriera ahora nadie
  // tendría esta orden de pago en la mano.
  const enMemoria = (
    JSON.parse(V.serializeAleph()) as { id: string; chain?: { payoutSig?: Hex } }[]
  ).find((r) => r.id === roomId)?.chain?.payoutSig;
  assert.ok(enMemoria, "la tabla quedó firmada en memoria");
  const vista = (await V.getAlephRoom(roomId, undefined, end + 2))!;
  assert.equal(vista.payoutSig, undefined, "la vista no muestra una firma sin guardar");
  assert.equal(vista.payoutDeadline, undefined);
  assert.ok(vista.payoutsUsdc, "la tabla (sin firma) sí: no es una orden de pago");
  assert.equal(V.alephLog(roomId, end + 2).usdc!.signature, undefined, "el registro tampoco");

  // Pasado el backoff, el reintento guarda PRIMERO y recién ahí publica y
  // manda, con la MISMA firma (sigue vigente).
  await V.alephChainTick(end + 10 * 60_000);
  assert.deepEqual(chain.calls, ["settle"]);
  assert.equal(chain.sentSigs[0].sig, enMemoria, "la misma firma, ya guardada");
  assert.ok(chain.blobAtSettle, "en el instante del settle, la tabla ya estaba guardada");
  const guardada = (
    JSON.parse(chain.blobAtSettle!) as { id: string; chain?: { payoutSig?: string } }[]
  ).find((r) => r.id === roomId);
  assert.equal(guardada?.chain?.payoutSig, enMemoria);
  assert.equal(
    (await V.getAlephRoom(roomId, undefined, end + 10 * 60_000))!.payoutSig,
    enMemoria,
    "guardada: ahora sí se publica",
  );
  C.setAlephChainForTest(undefined);
});

test("tras un reinicio, la firma que estaba guardada se publica y se reusa: no se firma otra", async () => {
  V.__resetAlephForTest();
  writes.length = 0;
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws) chain.deposit(roomId, w.address, 4);
  await V.alephChainTick(T0 + 1_000);
  const end = await playToSettled(roomId, ws, T0 + 2_000);

  // La firma se guarda, pero el settle no llega a salir (la cadena no contesta).
  chain.rooms.get(roomId)!.status = ALEPH_ESCROW_STATUS.Funded;
  const realSettle = chain.settle;
  chain.settle = async () => {
    throw new Error("rpc down");
  };
  await V.alephChainTick(end + 1);
  const blob = savedBlob();
  assert.ok(blob, "la firma llegó al store antes del intento");
  const antes = (JSON.parse(blob!) as { id: string; chain?: { payoutSig?: Hex } }[]).find(
    (r) => r.id === roomId,
  )?.chain?.payoutSig;
  assert.ok(antes);

  // "Reinicio": se vacía la memoria y se restaura exactamente lo guardado.
  V.__resetAlephForTest();
  V.restoreAlephFrom(blob!);
  const v = (await V.getAlephRoom(roomId, undefined, end + 2))!;
  assert.equal(v.payoutSig, antes, "vino del store: está guardada, se publica");

  chain.settle = realSettle;
  await V.alephChainTick(end + 10 * 60_000);
  assert.deepEqual(chain.calls, ["settle"]);
  assert.equal(chain.sentSigs[0].sig, antes, "se manda la guardada: no se firmó otra");
  C.setAlephChainForTest(undefined);
});

test("el tope de salas conservadas no desaloja una mesa de plata con el reembolso pendiente", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws.slice(0, 2)) chain.deposit(roomId, w.address, 4);
  // La cadena no se puede leer: la sala se disuelve por la salida local pasada
  // la gracia y el reembolso queda PEDIDO, sin poder salir todavía.
  chain.failReadsWith("rpc down");
  const dead = T0 + V.ALEPH_FUNDING_MS + V.ALEPH_FUNDING_GRACE_MS;
  V.settleDue(dead);
  assert.equal((await V.getAlephRoom(roomId, undefined, dead))!.status, "dissolved");
  assert.equal(V.ALEPH_MAX_SETTLED_KEPT, 2);

  // Tres salas gratis terminadas, todas MÁS NUEVAS: con el tope en 2, la mesa de
  // plata es la más vieja y sería la primera en irse.
  let at = dead + V.ALEPH_LOBBY_MS;
  const libres: string[] = [];
  for (let i = 0; i < 3; i++) {
    libres.push(await deadFreeRoom(at));
    at += V.ALEPH_LOBBY_MS + 1_000;
  }

  const quedan = finishedIds();
  assert.ok(
    quedan.includes(roomId),
    "la mesa de plata con plata pendiente sobrevivió al barrido del tope",
  );
  assert.equal(quedan.length, 2, "y el tope se respetó igual, desalojando salas gratis");
  assert.ok(quedan.includes(libres[2]), "se fueron las gratis más viejas, no la de plata");

  // Y no queda clavada para siempre: apenas el reembolso CIERRA, vuelve a ser
  // desalojable como cualquier otra sala terminada.
  chain.failReadsWith(undefined);
  await V.alephChainTick(at);
  assert.deepEqual(chain.calls, ["cancelRoom"]);
  assert.equal(
    (await V.getAlephRoom(roomId, undefined, at))!.refundTx,
    "0x" + "c".repeat(64),
    "el reembolso salió y quedó publicado",
  );
  await deadFreeRoom(at + 1_000);
  assert.ok(
    !finishedIds().includes(roomId),
    "cerrada la obligación, el tope ya se la puede llevar",
  );
  C.setAlephChainForTest(undefined);
});

test("el TTL tampoco borra una mesa de plata con plata pendiente en la cadena", async () => {
  V.__resetAlephForTest();
  const chain = fakeChain();
  C.setAlephChainForTest(chain);
  const { ws, roomId } = await fundingRoom(T0);
  for (const w of ws.slice(0, 2)) chain.deposit(roomId, w.address, 4);
  chain.failReadsWith("rpc down");
  const dead = T0 + V.ALEPH_FUNDING_MS + V.ALEPH_FUNDING_GRACE_MS;
  V.settleDue(dead);

  const libre = await deadFreeRoom(dead + V.ALEPH_LOBBY_MS);
  const vencido = dead + 3 * V.ALEPH_LOBBY_MS + V.ALEPH_FINISHED_TTL_MS + 1;
  V.settleDue(vencido);

  const quedan = finishedIds();
  assert.ok(!quedan.includes(libre), "la sala gratis vencida sí se borra (nada que deber)");
  assert.ok(quedan.includes(roomId), "la de plata se queda hasta que el reembolso cierre");

  // Con el reembolso cerrado, el próximo barrido la borra como a cualquier otra.
  chain.failReadsWith(undefined);
  await V.alephChainTick(vencido);
  V.settleDue(vencido + 1);
  assert.ok(!finishedIds().includes(roomId));
  C.setAlephChainForTest(undefined);
});
