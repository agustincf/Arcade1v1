// EL REGISTRO DURABLE DE LOS INTENTOS EN VIVO (live-store.ts) contra el Upstash
// falso, con la posta prendida como en producción: cada intento es una cabecera
// (el intento sin sus jugadas) y sus tramos de jugadas, campos del hash
// `arcade:live`; cada compromiso sube SOLO su tramo nuevo (con el avance), en UN
// pedido junto con la lectura de la época, y una instancia que perdió la posta
// no da nada por guardado.
// Corre en su propio proceso: persist.ts captura el backend al importarse.
// Correr: node --import tsx --test apps/server/test/live-store.test.ts
import "../src/offline-env.js";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startFakeUpstash } from "./fake-upstash.js";
import type { LiveAttempt } from "../src/matchmaking.js";

const fake = await startFakeUpstash();
after(() => fake.close());
process.env.ARCADE_PERSIST = "1";
process.env.ARCADE_PERSIST_HANDOVER = "1";
process.env.UPSTASH_REDIS_REST_URL = fake.url;
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-prueba";
const L = await import("../src/lease.js");
const S = await import("../src/live-store.js");

const MATCH = "0x" + "ab".repeat(32);
const ADDR = "0x" + "c".repeat(40);
const OTHER = "0x" + "d".repeat(40);
const KEY = `${MATCH}:${ADDR}`;
const FLAPS = [0, 12, 30, 50, 77, 101, 130];
const attempt = (tick: number, over = false): LiveAttempt => ({
  tokenHash: "f".repeat(64),
  startedAt: 1,
  tick,
  flaps: FLAPS.filter((f) => f < tick),
  revealed: 3 + Math.floor(tick / 90),
  ...(over ? { over: true, score: 2 } : {}),
});
/** El hash `arcade:live` del Upstash falso (se crea vacío si todavía no está,
 *  para poder sembrarle registros a mano). */
const stored = () => {
  let h = fake.hashes.get("arcade:live");
  if (!h) fake.hashes.set("arcade:live", (h = new Map<string, string>()));
  return h;
};
/** Lo que hay guardado, leído como lo lee el árbitro al arrancar. */
const recordOf = (address: string) =>
  S.decodeLiveRecords(stored()).find((r) => r.matchId === MATCH && r.address === address)?.attempt;

/** Cada comando que llegó al Upstash falso, completo. */
let cmds: string[][] = [];
const hsets = () => cmds.filter((c) => c[0] === "HSET" && c[1] === "arcade:live");
/** Los campos que escribió un HSET, como mapa. */
const fieldsOf = (cmd: string[]) => {
  const out = new Map<string, string>();
  for (let i = 2; i + 1 < cmd.length; i += 2) out.set(cmd[i], cmd[i + 1]);
  return out;
};

/** Silencia console.error mientras corre `fn` y devuelve lo que se logueó. */
async function quiet<T>(fn: () => Promise<T>): Promise<{ value: T; errors: string }> {
  const errors: string[] = [];
  const real = console.error;
  console.error = (...a: unknown[]) => void errors.push(a.map(String).join(" "));
  try {
    return { value: await fn(), errors: errors.join("\n") };
  } finally {
    console.error = real;
  }
}

beforeEach(async () => {
  fake.kv.clear();
  fake.hashes.clear();
  fake.log.length = 0;
  fake.failWith = null;
  fake.failCommands.clear();
  cmds = [];
  fake.afterCommand = (cmd) => void cmds.push(cmd);
  L.resetLeaseForTests();
  S.__resetLiveStoreForTest();
  await L.acquireLease();
  fake.log.length = 0; // lo que importa empieza después de tomar la posta
  cmds = [];
});

test("guardar escribe la cabecera y el primer tramo en UN comando, confirmando la posta en el MISMO pedido", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  assert.deepEqual(recordOf(ADDR), attempt(40));
  // Un solo pedido: la lectura de la época y la escritura, en ese orden.
  assert.deepEqual(fake.log, [
    ["GET", "arcade:lease:epoch"],
    ["HSET", "arcade:live"],
  ]);
  const fields = fieldsOf(hsets()[0]);
  assert.deepEqual([...fields.keys()], [KEY, `${KEY}#0`], "la cabecera y el tramo desde el tick 0");
  assert.equal(JSON.parse(fields.get(KEY)!).flaps, undefined, "la cabecera no lleva las jugadas");
  assert.deepEqual(JSON.parse(fields.get(`${KEY}#0`)!), {
    to: 40,
    revealed: 3,
    flaps: [0, 12, 30],
  });
});

test("cada compromiso sube UN campo: su tramo nuevo, con el avance", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  await S.saveLiveAttempt(MATCH, ADDR, attempt(95));
  const second = fieldsOf(hsets()[1]);
  assert.deepEqual([...second.keys()], [`${KEY}#40`], "sin la cabecera: empieza donde quedó");
  assert.deepEqual(JSON.parse(second.get(`${KEY}#40`)!), {
    to: 95,
    revealed: 4,
    flaps: [50, 77],
  });
  await S.saveLiveAttempt(MATCH, ADDR, attempt(140));
  assert.deepEqual(JSON.parse(fieldsOf(hsets()[2]).get(`${KEY}#95`)!), {
    to: 140,
    revealed: 4,
    flaps: [101, 130],
  });
  assert.deepEqual(recordOf(ADDR), attempt(140), "la cabecera y los tramos son el intento entero");
});

test("el final viaja en su tramo: al leer, el último tramo dice el tick, lo revelado y el puntaje", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  await S.saveLiveAttempt(MATCH, ADDR, attempt(95));
  await S.saveLiveAttempt(MATCH, ADDR, attempt(140, true));
  assert.deepEqual([...fieldsOf(hsets()[2]).keys()], [`${KEY}#95`]);
  S.__resetLiveStoreForTest();
  const [got] = await S.loadLiveAttempts();
  assert.deepEqual(got.attempt, attempt(140, true));
  // Leído, ya está guardado: guardarlo igual no escribe.
  cmds = [];
  await S.saveLiveAttempt(MATCH, ADDR, attempt(140, true));
  assert.equal(hsets().length, 0);
});

test("guardar lo mismo dos veces no vuelve a escribir; un cambio sin jugadas nuevas sube solo la cabecera", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  const writes = fake.log.length;
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  assert.equal(fake.log.length, writes, "sin cambios, sin pedido");
  // Un token nuevo (retomar el intento) en el mismo tick: sin tramo.
  await S.saveLiveAttempt(MATCH, ADDR, { ...attempt(40), tokenHash: "e".repeat(64) });
  assert.deepEqual([...fieldsOf(hsets()[1]).keys()], [KEY]);
  // Y el cierre en el mismo tick (rendición, plazo vencido), también.
  await S.saveLiveAttempt(MATCH, ADDR, { ...attempt(40, true), tokenHash: "e".repeat(64) });
  assert.deepEqual([...fieldsOf(hsets()[2]).keys()], [KEY]);
  assert.deepEqual(recordOf(ADDR), { ...attempt(40, true), tokenHash: "e".repeat(64) });
});

test("una respuesta perdida: el reintento reescribe EL MISMO tramo y no duplica jugadas", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  // La escritura llega a Upstash, pero la respuesta no vuelve (el árbitro ve un
  // error): el compromiso contesta 503 y el cliente lo reintenta.
  fake.afterCommand = (cmd) => {
    cmds.push(cmd);
    if (cmd[0] === "HSET") {
      fake.afterCommand = (c) => void cmds.push(c);
      throw new Error("se cortó la respuesta");
    }
  };
  await assert.rejects(
    () => S.saveLiveAttempt(MATCH, ADDR, attempt(95)),
    (e: Error) => e instanceof S.LiveUnavailableError,
  );
  assert.deepEqual(recordOf(ADDR), attempt(95), "la escritura había llegado");
  await S.saveLiveAttempt(MATCH, ADDR, attempt(95));
  assert.deepEqual([...fieldsOf(hsets()[2]).keys()], [`${KEY}#40`], "el mismo campo otra vez");
  await S.saveLiveAttempt(MATCH, ADDR, attempt(140));

  S.__resetLiveStoreForTest(); // una caída dura: el proceso nuevo no sabe nada
  const [got] = await S.loadLiveAttempts();
  assert.deepEqual(got.attempt, attempt(140), "cada aleteo una sola vez");
  assert.deepEqual([...stored().keys()].sort(), [KEY, `${KEY}#0`, `${KEY}#40`, `${KEY}#95`]);
});

test("una respuesta perdida seguida de otro compromiso: el tramo nuevo pisa al que quedó a medias", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  fake.afterCommand = (cmd) => {
    cmds.push(cmd);
    if (cmd[0] === "HSET") {
      fake.afterCommand = (c) => void cmds.push(c);
      throw new Error("se cortó la respuesta");
    }
  };
  await assert.rejects(() => S.saveLiveAttempt(MATCH, ADDR, attempt(95)));
  // El árbitro no sabe si quedó: el próximo guardado sube desde lo último seguro.
  await S.saveLiveAttempt(MATCH, ADDR, attempt(140));
  assert.deepEqual(JSON.parse(fieldsOf(hsets()[2]).get(`${KEY}#40`)!), {
    to: 140,
    revealed: 4,
    flaps: [50, 77, 101, 130],
  });
  S.__resetLiveStoreForTest();
  const [got] = await S.loadLiveAttempts();
  assert.deepEqual(got.attempt, attempt(140));
});

test("un intento que no sigue a lo guardado se reescribe entero con otra generación, y los tramos de antes no se leen", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  await S.saveLiveAttempt(MATCH, ADDR, attempt(95));
  await S.saveLiveAttempt(MATCH, ADDR, attempt(140));
  // No debería pasar (las jugadas solo se agregan y el tick solo avanza), pero
  // si la memoria vuelve atrás con otras jugadas, se guarda lo que hay en memoria.
  const other = (tick: number): LiveAttempt => ({
    ...attempt(tick),
    flaps: [0, 12, 30, 51, 77, 102].filter((f) => f < tick),
  });
  await S.saveLiveAttempt(MATCH, ADDR, other(95));
  const fields = fieldsOf(hsets()[3]);
  assert.deepEqual([...fields.keys()], [KEY, `${KEY}#0`]);
  assert.equal(JSON.parse(fields.get(KEY)!).g, 1);
  // Los tramos viejos #40 y #95 siguen ahí, pero son de la generación anterior.
  assert.ok(stored().has(`${KEY}#95`));
  assert.deepEqual(recordOf(ADDR), other(95), "el #95 viejo no se lee");
  await S.saveLiveAttempt(MATCH, ADDR, other(140));
  assert.deepEqual([...fieldsOf(hsets()[4]).keys()], [`${KEY}#95`], "y lo pisa el nuevo");
  S.__resetLiveStoreForTest();
  const [got] = await S.loadLiveAttempts();
  assert.deepEqual(got.attempt, other(140));
  // Al olvidarlo se borra todo, también lo de la generación anterior.
  S.forgetLiveAttempts(MATCH, [ADDR]);
  for (let i = 0; i < 50 && stored().size > 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(stored().size, 0);
});

test("si otra instancia tomó la posta, NO se da por guardado y esta instancia se cerca", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  fake.kv.set("arcade:lease:epoch", String(Number(fake.kv.get("arcade:lease:epoch")) + 1));
  await assert.rejects(
    () => S.saveLiveAttempt(MATCH, ADDR, attempt(95)),
    (e: Error) => e instanceof S.LiveUnavailableError,
  );
  assert.equal(L.isHolder(), false, "se dio por perdida la posta");
  // Y sin la posta ni siquiera sale el pedido.
  const before = fake.log.length;
  await assert.rejects(() => S.saveLiveAttempt(MATCH, ADDR, attempt(120)));
  assert.equal(fake.log.length, before, "sin posta no se escribe nada");
});

test("con Upstash caído, guardar tira LiveUnavailableError (y el siguiente intento reescribe)", async () => {
  fake.failWith = 500;
  await assert.rejects(
    () => S.saveLiveAttempt(MATCH, ADDR, attempt(40)),
    (e: Error) => e instanceof S.LiveUnavailableError && /retry/.test(e.message),
  );
  fake.failWith = null;
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  assert.deepEqual(recordOf(ADDR), attempt(40), "lo que falló se reescribe");
});

test("al arrancar se leen todos en un pedido; lo ilegible se descarta y se borra entero", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  await S.saveLiveAttempt(MATCH, OTHER, attempt(95, true));
  stored().set("roto", "{no es json");
  // Uno al que le falta un tramo: sus jugadas no se pueden rearmar.
  const holed = `${MATCH}:0x${"e".repeat(40)}`;
  stored().set(
    holed,
    JSON.stringify({ ...attempt(95), flaps: undefined, wire: "flaps", moves: 5 }),
  );
  stored().set(`${holed}#0`, JSON.stringify({ to: 40, revealed: 3, flaps: [0, 12, 30] }));
  // Un tramo suelto, sin su cabecera (una partida borrada a medias).
  stored().set(
    `${MATCH}:0x${"f".repeat(40)}#0`,
    JSON.stringify({ to: 10, revealed: 1, flaps: [] }),
  );
  S.__resetLiveStoreForTest(); // un proceso nuevo: no sabe nada
  fake.log.length = 0;
  const { value: got, errors } = await quiet(() => S.loadLiveAttempts());
  assert.equal(fake.log.filter((c) => c[0] === "HGETALL").length, 1, "un solo pedido para leer");
  assert.equal(got.length, 2);
  const mine = got.find((g) => g.address === ADDR)!;
  assert.equal(mine.matchId, MATCH);
  assert.deepEqual(mine.attempt, attempt(40));
  assert.equal(got.find((g) => g.address !== ADDR)!.attempt.over, true);
  assert.deepEqual(
    [...stored().keys()].sort(),
    [KEY, `${KEY}#0`, `${MATCH}:${OTHER}`, `${MATCH}:${OTHER}#0`].sort(),
    "lo ilegible se borró: el roto, el que tenía un hueco (con sus tramos) y el tramo suelto",
  );
  assert.match(errors, /ilegibles/);
  // Lo leído ya está guardado: guardarlo igual no escribe.
  const writes = fake.log.length;
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  assert.equal(fake.log.length, writes);
  // Y lo que sigue sube solo su tramo.
  await S.saveLiveAttempt(MATCH, ADDR, attempt(95));
  assert.deepEqual([...fieldsOf(hsets().at(-1)!).keys()], [`${KEY}#40`]);
});

test("un registro viejo (el intento entero en un JSON) se lee igual, y el primer cambio lo pasa a tramos", async () => {
  // Como los guarda el árbitro de hoy en producción (Flappy y Carrera).
  stored().set(KEY, JSON.stringify(attempt(40)));
  await S.saveLiveAttempt(MATCH, OTHER, attempt(95));
  S.__resetLiveStoreForTest();
  const got = await S.loadLiveAttempts();
  assert.deepEqual(
    got.find((g) => g.address === ADDR)?.attempt,
    attempt(40),
    "el viejo se lee como siempre",
  );
  assert.deepEqual(
    got.find((g) => g.address === OTHER)?.attempt,
    attempt(95),
    "junto con uno nuevo",
  );
  // Guardarlo sin cambios no escribe.
  cmds = [];
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  assert.equal(hsets().length, 0);
  // El primer cambio reescribe la cabecera y TODAS sus jugadas en el tramo 0
  // (en el mismo comando): la cabecera nueva pisa el JSON viejo, que era donde
  // estaban.
  await S.saveLiveAttempt(MATCH, ADDR, attempt(95));
  const fields = fieldsOf(hsets()[0]);
  assert.deepEqual([...fields.keys()], [KEY, `${KEY}#0`]);
  assert.deepEqual(JSON.parse(fields.get(`${KEY}#0`)!), {
    to: 95,
    revealed: 4,
    g: 1,
    flaps: [0, 12, 30, 50, 77],
  });
  assert.deepEqual(recordOf(ADDR), attempt(95));
  // Y de ahí en más, solo el tramo nuevo.
  await S.saveLiveAttempt(MATCH, ADDR, attempt(140));
  assert.deepEqual([...fieldsOf(hsets()[1]).keys()], [`${KEY}#95`]);
  S.__resetLiveStoreForTest();
  assert.deepEqual(
    (await S.loadLiveAttempts()).find((g) => g.address === ADDR)?.attempt,
    attempt(140),
  );
});

test("olvidar una partida borra sus cabeceras y todos sus tramos (también los de un registro viejo)", async () => {
  await S.saveLiveAttempt(MATCH, ADDR, attempt(40));
  await S.saveLiveAttempt(MATCH, ADDR, attempt(95));
  await S.saveLiveAttempt(MATCH, ADDR, attempt(140));
  stored().set(`${MATCH}:${OTHER}`, JSON.stringify(attempt(40)));
  S.__resetLiveStoreForTest(); // los conoce por haberlos leído al arrancar
  await S.loadLiveAttempts();
  await S.saveLiveAttempt(MATCH, OTHER, attempt(95)); // el viejo pasa a tramos
  S.forgetLiveAttempts(MATCH, [ADDR, OTHER]);
  for (let i = 0; i < 50 && stored().size > 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(stored().size, 0);
});

test("el cerrojo atiende de a un pedido por intento, y no traba intentos distintos", async () => {
  const order: string[] = [];
  let openFirst!: () => void;
  const gate = new Promise<void>((r) => (openFirst = r));
  const first = S.withLiveLock(MATCH, ADDR, async () => {
    order.push("1 empieza");
    await gate;
    order.push("1 termina");
  });
  const second = S.withLiveLock(MATCH, ADDR, async () => {
    order.push("2");
  });
  const other = S.withLiveLock(MATCH, OTHER, async () => {
    order.push("otro intento");
  });
  await other;
  assert.deepEqual(order, ["1 empieza", "otro intento"], "otro intento no espera");
  openFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["1 empieza", "otro intento", "1 termina", "2"]);
});

test("un intento de Carrera (sus jugadas en inputs, sin flaps) se guarda por tramos y se lee", async () => {
  const racing = (tick: number): LiveAttempt => ({
    tokenHash: "e".repeat(64),
    startedAt: 1,
    tick,
    inputs: [
      { t: 3, a: "l" },
      { t: 40, a: "j" },
      { t: 95, a: "r" },
      { t: 95, a: "j" },
    ].filter((i) => i.t < tick),
    revealed: 2,
  });
  await S.saveLiveAttempt(MATCH, ADDR, racing(90));
  await S.saveLiveAttempt(MATCH, ADDR, racing(120));
  assert.deepEqual(JSON.parse(fieldsOf(hsets()[1]).get(`${KEY}#90`)!), {
    to: 120,
    revealed: 2,
    inputs: [
      { t: 95, a: "r" },
      { t: 95, a: "j" },
    ],
  });
  // Uno viejo con inputs que no son una lista es ilegible.
  stored().set(`${MATCH}:0x${"9".repeat(40)}`, JSON.stringify({ ...racing(90), inputs: "l" }));
  S.__resetLiveStoreForTest(); // un proceso nuevo: no sabe nada
  const { value: got } = await quiet(() => S.loadLiveAttempts());
  assert.deepEqual(
    got.map((g) => g.attempt),
    [racing(120)],
  );
});

test("un intento con jugadas fuera de su tramo es ilegible (no se rearma con jugadas repetidas)", async () => {
  stored().set(KEY, JSON.stringify({ ...attempt(95), flaps: undefined, wire: "flaps", moves: 6 }));
  stored().set(`${KEY}#0`, JSON.stringify({ to: 40, revealed: 3, flaps: [0, 12, 30] }));
  // El segundo tramo repite un aleteo del primero.
  stored().set(`${KEY}#40`, JSON.stringify({ to: 95, revealed: 4, flaps: [30, 50, 77] }));
  const { value: got, errors } = await quiet(() => S.loadLiveAttempts());
  assert.equal(got.length, 0);
  assert.match(errors, /ilegibles/);
  assert.equal(stored().size, 0, "se borró entero");
});

// ---- Cuánto sube una partida --------------------------------------------------
// Medido sobre el cuerpo de cada pedido HTTP que escribe el registro, con un
// intento del tamaño de una partida de Space Invaders en vivo (diseño:
// docs/superpowers/specs/2026-11-18-invaders-en-vivo-design.md): ~5.700 ticks,
// un compromiso cada 60 (un bloque) y ~850 jugadas. Con el registro viejo
// (el intento entero en cada compromiso) eran ~780 KB de JSON por jugador.

test("una partida del tamaño de Invaders sube del orden de su registro final, no el intento entero en cada compromiso", async (t) => {
  const ACTIONS = ["l1", "l0", "r1", "r0", "f1", "f0"];
  const TICKS = 5_700;
  const BLOCK = 60;
  let seed = 7;
  const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
  const a: LiveAttempt = {
    tokenHash: "a".repeat(64),
    startedAt: 1_763_456_789_012,
    tick: 0,
    inputs: [],
    revealed: 1,
  };
  let uploaded = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (typeof init?.body === "string" && init.body.includes('"arcade:live"')) {
      uploaded += Buffer.byteLength(init.body);
    }
    return realFetch(input, init);
  }) as typeof fetch;
  // Lo que subía el registro viejo: el mismo pedido, con el intento entero.
  let legacy = 0;
  const legacyBody = (x: LiveAttempt) =>
    JSON.stringify([
      ["GET", "arcade:lease:epoch"],
      ["HSET", "arcade:live", KEY, JSON.stringify(x)],
    ]);
  let commits = 0;
  try {
    await S.saveLiveAttempt(MATCH, ADDR, a); // abrir
    legacy += Buffer.byteLength(legacyBody(a));
    for (let from = 0; from < TICKS; from += BLOCK) {
      for (let tick = from; tick < from + BLOCK; tick++) {
        if (rand() < 0.15) a.inputs!.push({ t: tick, a: ACTIONS[Math.floor(rand() * 6)] });
      }
      a.tick = from + BLOCK;
      a.revealed += 1;
      if (a.tick >= TICKS) Object.assign(a, { over: true, score: 1_230 });
      await S.saveLiveAttempt(MATCH, ADDR, a);
      legacy += Buffer.byteLength(legacyBody(a));
      commits++;
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(recordOf(ADDR), a, "lo guardado es el intento entero");
  const finalRecord = Buffer.byteLength(JSON.stringify(a));
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  // Y al purgar la partida, borrarlo: la cabecera y cada tramo por su nombre.
  const removed = (
    await new Promise<string[][]>((ok) => {
      fake.afterCommand = (cmd) => {
        if (cmd[0] === "HDEL") ok([cmd]);
      };
      S.forgetLiveAttempts(MATCH, [ADDR]);
    })
  )[0];
  const removeBytes = Buffer.byteLength(JSON.stringify(removed));
  t.diagnostic(
    `${commits} compromisos, ${a.inputs!.length} jugadas; registro final ${kb(finalRecord)}; ` +
      `sube ${kb(uploaded)} jugando y ${kb(removeBytes)} al borrarlo (antes ${kb(legacy)} y ` +
      `${kb(Buffer.byteLength(JSON.stringify(["HDEL", "arcade:live", KEY])))})`,
  );
  assert.ok(a.inputs!.length > 800, `${a.inputs!.length} jugadas, como una partida de Invaders`);
  assert.ok(uploaded < 5 * finalRecord, `sube ${kb(uploaded)}, del orden de ${kb(finalRecord)}`);
  assert.ok(legacy > 10 * uploaded, `al menos 10 veces menos que antes (${kb(legacy)})`);
});
