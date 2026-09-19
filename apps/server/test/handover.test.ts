// EL TRASPASO (handover.ts), con la posta real contra el Upstash falso y un
// reloj virtual: `sleep` adelanta el reloj en vez de esperar. La "otra
// instancia" se simula escribiendo sus claves de Redis a mano.
// Correr: node --import tsx --test apps/server/test/handover.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startFakeUpstash } from "./fake-upstash.js";

const fake = await startFakeUpstash();
after(() => fake.close());
process.env.ARCADE_PERSIST = "1";
process.env.ARCADE_PERSIST_HANDOVER = "1";
process.env.UPSTASH_REDIS_REST_URL = fake.url;
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-prueba";
// Posta vencida a los 30 min: el reloj virtual nunca llega ahí sin querer.
process.env.LEASE_HEARTBEAT_MS = "600000";
const H = await import("../src/handover.js");
const L = await import("../src/lease.js");
const R = await import("../src/readiness.js");

const T: import("../src/handover.js").HandoverTiming = {
  ...H.HANDOVER_TIMING,
  pollMs: 50,
  doorbellEveryMs: 100,
  acceptWaitMs: 1_000,
  releaseWaitMs: 1_000,
  fallbackPollMs: 50,
  drainCapMs: 100,
  resumeAfterMs: 500,
  resumePollMs: 50,
  doorbellMinGapMs: 0,
};

type Deps = import("../src/handover.js").HandoverDeps & { logs: string[]; calls: string[] };

function deps(over: Partial<Deps> = {}): Deps {
  const logs: string[] = [];
  const calls: string[] = [];
  let clock = Date.now();
  return {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      await new Promise((r) => setImmediate(r));
    },
    doorbellConfigured: true,
    ringDoorbell: async () => false,
    flushAll: async () => void calls.push("flush"),
    startJobs: () => void calls.push("startJobs"),
    stopJobs: async () => {
      calls.push("stopJobs");
      return [];
    },
    waitForIdle: async () => {
      calls.push("idle");
      return true;
    },
    log: (m) => void logs.push(m),
    exit: (code) => void calls.push(`exit ${code}`),
    logs,
    calls,
    ...over,
  };
}

const record = (id: string, state: "active" | "released", at = Date.now()) =>
  JSON.stringify({ id, at, state });
/** Una instancia vieja viva, dueña de la época `e`. */
function oldHolder(e: number) {
  fake.kv.set("arcade:lease:epoch", String(e));
  fake.kv.set(`arcade:lease:e:${e}`, record("vieja", "active"));
}
/** La instancia nueva toma la posta (época `e`) y la tiene viva. */
function newHolder(e: number) {
  fake.kv.set("arcade:lease:epoch", String(e));
  fake.kv.set(`arcade:lease:e:${e}`, record("nueva", "active"));
}
async function until(cond: () => boolean, ms = 2_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("se venció la espera");
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  fake.kv.clear();
  fake.failWith = null;
  fake.afterCommand = null;
  L.resetLeaseForTests();
  H.resetHandoverForTests();
  R.setMode("starting");
});

// ---- La nueva: takeOver -------------------------------------------------------

test("sin posta la toma enseguida: 'none'", async () => {
  assert.equal(await H.takeOver(deps(), T), "none");
  assert.equal(L.isHolder(), true);
  assert.equal(L.myEpoch(), 1);
});

test("con la posta soltada: 'released'; vencida: 'stale'", async () => {
  fake.kv.set("arcade:lease:epoch", "3");
  fake.kv.set("arcade:lease:e:3", record("vieja", "released"));
  assert.equal(await H.takeOver(deps(), T), "released");
  assert.equal(L.myEpoch(), 4);

  L.resetLeaseForTests();
  fake.kv.set("arcade:lease:epoch", "8");
  fake.kv.set("arcade:lease:e:8", record("vieja", "active", Date.now() - L.LEASE_STALE_MS - 1));
  assert.equal(await H.takeOver(deps(), T), "stale");
  assert.equal(L.myEpoch(), 9);
});

test("una posta vencida con registro primero toca el timbre (la vieja pudo quedar viva tras una caída de Upstash)", async () => {
  fake.kv.set("arcade:lease:epoch", "5");
  fake.kv.set("arcade:lease:e:5", record("vieja", "active", Date.now() - L.LEASE_STALE_MS - 1));
  let rings = 0;
  const d = deps({
    ringDoorbell: async () => {
      rings++;
      // La vieja seguía viva: acepta el timbre, entrega y suelta.
      fake.kv.set("arcade:lease:e:5", record("vieja", "released"));
      return true;
    },
  });
  assert.equal(await H.takeOver(d, T), "doorbell");
  assert.equal(rings, 1);
  const pedido = JSON.parse(fake.kv.get("arcade:lease:handover")!);
  assert.equal(pedido.forEpoch, 5);
  assert.equal(pedido.by, L.INSTANCE_ID);
  assert.equal(L.myEpoch(), 6);
});

test("vencida y sin respuesta al timbre: la toma igual", async () => {
  fake.kv.set("arcade:lease:epoch", "5");
  fake.kv.set("arcade:lease:e:5", record("vieja", "active", Date.now() - L.LEASE_STALE_MS - 1));
  let rings = 0;
  const d = deps({
    ringDoorbell: async () => {
      rings++;
      return false;
    },
  });
  assert.equal(await H.takeOver(d, T), "stale");
  assert.equal(rings, 1);
  assert.equal(L.myEpoch(), 6);
});

test("una posta vencida con dueña que contesta el timbre: espera a que suelte (no toma antes)", async () => {
  fake.kv.set("arcade:lease:epoch", "5");
  fake.kv.set("arcade:lease:e:5", record("vieja", "active", Date.now() - L.LEASE_STALE_MS - 1));
  // fake.log se acumula para todo el archivo (no lo limpia el beforeEach):
  // hay que comparar contra la base de este test, no contra un total absoluto.
  const incrs = () => fake.log.filter((c) => c[0] === "INCR").length;
  const baseline = incrs();
  let rings = 0;
  let sleeps = 0;
  let incrAtRelease = -1;
  let clock = Date.now();
  const d = deps({
    now: () => clock,
    sleep: async (ms) => {
      sleeps++;
      clock += ms;
      if (sleeps === 3) {
        // Todavía no tiene que haber tomado la posta: la dueña recién ahora
        // la suelta, tres sondeos después de aceptar el timbre.
        incrAtRelease = incrs() - baseline;
        fake.kv.set("arcade:lease:e:5", record("vieja", "released"));
      }
      await new Promise((r) => setImmediate(r));
    },
    ringDoorbell: async () => {
      rings++;
      return true; // acepta, pero no suelta todavía
    },
  });
  assert.equal(await H.takeOver(d, T), "doorbell");
  assert.equal(rings, 1);
  assert.equal(incrAtRelease, 0, "no tomó la posta antes de que la dueña la soltara");
  assert.equal(L.myEpoch(), 6);
});

test("si la dueña vuelve a latir después del timbre, no se le toma la posta", async () => {
  fake.kv.set("arcade:lease:epoch", "5");
  fake.kv.set("arcade:lease:e:5", record("vieja", "active", Date.now() - L.LEASE_STALE_MS - 1));
  const incrs = () => fake.log.filter((c) => c[0] === "INCR").length;
  const baseline = incrs();
  let rings = 0;
  let sleeps = 0;
  let clock = Date.now();
  const d = deps({
    now: () => clock,
    sleep: async (ms) => {
      sleeps++;
      clock += ms;
      if (sleeps === 2) {
        // La dueña vuelve a latir después de contestar el timbre (por
        // ejemplo, abortó su entrega porque falló el guardado): sigue viva.
        fake.kv.set("arcade:lease:e:5", record("vieja", "active"));
      }
      await new Promise((r) => setImmediate(r));
    },
    ringDoorbell: async () => {
      rings++;
      return true; // acepta, pero no suelta: en el medio vuelve a latir
    },
  });
  const taking = H.takeOver(d, T);
  await until(() => R.getMode() === "fallback");
  assert.equal(rings, 1);
  assert.equal(incrs() - baseline, 0, "no le tomó la posta a una dueña que sigue viva");
  fake.kv.set("arcade:lease:e:5", record("vieja", "released"));
  assert.equal(await taking, "fallback");
  assert.equal(L.myEpoch(), 6);
});

test("con una dueña viva: pide la posta, toca el timbre y la toma cuando la vieja la suelta", async () => {
  oldHolder(5);
  let rings = 0;
  const d = deps({
    ringDoorbell: async () => {
      rings++;
      // La vieja acepta, entrega y suelta (acá, antes de responder).
      fake.kv.set("arcade:lease:e:5", record("vieja", "released"));
      return true;
    },
  });
  assert.equal(await H.takeOver(d, T), "doorbell");
  assert.equal(rings, 1);
  const pedido = JSON.parse(fake.kv.get("arcade:lease:handover")!);
  assert.equal(pedido.forEpoch, 5);
  assert.equal(pedido.by, L.INSTANCE_ID);
  assert.equal(L.myEpoch(), 6);
  assert.equal(R.getMode(), "starting", "la nueva no se declara sana hasta cargar");
});

test("si nadie contesta el timbre, pasa a respaldo (/health 200) y espera sin tope ciego", async () => {
  oldHolder(2);
  const d = deps();
  const taking = H.takeOver(d, T);
  await until(() => R.getMode() === "fallback");
  assert.ok(d.logs.some((l) => /respaldo/.test(l)));
  assert.equal(L.isHolder(), false, "no toma la posta de una dueña viva");
  // La vieja recibe su SIGTERM de Render, guarda y suelta.
  fake.kv.set("arcade:lease:e:2", record("vieja", "released"));
  assert.equal(await taking, "fallback");
  assert.equal(L.myEpoch(), 3);
});

test("con una posta viva del #33: respaldo directo, sin timbre", async () => {
  fake.kv.set("arcade:lease", JSON.stringify({ id: "vieja-33", at: Date.now(), released: false }));
  let rings = 0;
  const d = deps({
    ringDoorbell: async () => {
      rings++;
      return false;
    },
  });
  const taking = H.takeOver(d, T);
  await until(() => R.getMode() === "fallback");
  fake.kv.set("arcade:lease", JSON.stringify({ id: "vieja-33", at: Date.now(), released: true }));
  assert.equal(await taking, "fallback");
  assert.equal(rings, 0);
  assert.equal(JSON.parse(fake.kv.get("arcade:lease")!).id, L.INSTANCE_ID);
});

test("sin URL para el timbre, respaldo directo", async () => {
  oldHolder(1);
  let rings = 0;
  const d = deps({
    doorbellConfigured: false,
    ringDoorbell: async () => {
      rings++;
      return false;
    },
  });
  const taking = H.takeOver(d, T);
  await until(() => R.getMode() === "fallback");
  fake.kv.set("arcade:lease:e:1", record("vieja", "released"));
  assert.equal(await taking, "fallback");
  assert.equal(rings, 0);
  assert.equal(fake.kv.has("arcade:lease:handover"), false);
});

test("un error pasajero de Upstash no tira el arranque: reintenta", async () => {
  fake.failWith = 500;
  const d = deps();
  const taking = H.takeOver(d, T);
  await until(() => d.logs.some((l) => /reintento/.test(l)));
  fake.failWith = null;
  assert.equal(await taking, "none");
});

// ---- La vieja: handOver -------------------------------------------------------

test("entrega: frena relojes, espera lo en curso, guarda y RECIÉN AHÍ suelta", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  assert.equal(await H.handOver("doorbell", d, T), "released");
  newHolder(2); // la nueva la toma: no hay que retomar
  assert.deepEqual(d.calls, ["stopJobs", "idle", "flush"]);
  assert.equal(JSON.parse(fake.kv.get("arcade:lease:e:1")!).state, "released");
  assert.equal(L.isHolder(), false);
  assert.equal(R.getMode(), "released");
  assert.ok(d.logs.some((l) => /Entregué la posta \(época 1, por timbre\)/.test(l)));
});

test("si el guardado falla, la entrega se aborta: no suelta y vuelve a atender", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps({
    flushAll: async () => {
      throw new Error("upstash caído");
    },
  });
  assert.equal(await H.handOver("sigterm", d, T), "aborted");
  assert.equal(L.isHolder(), true);
  assert.equal(JSON.parse(fake.kv.get("arcade:lease:e:1")!).state, "active");
  assert.equal(R.getMode(), "ready");
  assert.ok(d.calls.includes("startJobs"), "rearranca los relojes");
});

test("un SIGTERM durante una entrega por timbre espera ESA entrega (no guarda dos veces)", async () => {
  await L.acquireLease();
  R.setMode("ready");
  let flushes = 0;
  let finish!: () => void;
  const d = deps({
    flushAll: () =>
      new Promise<void>((ok) => {
        flushes++;
        finish = ok;
      }),
  });
  const porTimbre = H.handOver("doorbell", d, T);
  await until(() => flushes === 1);
  const porSigterm = H.handOver("sigterm", d, T);
  finish();
  assert.equal(await porTimbre, "released");
  assert.equal(await porSigterm, "released");
  assert.equal(flushes, 1);
  newHolder(2);
});

test("si la nueva no toma la posta, la vieja la retoma y vuelve a atender", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  assert.equal(await H.handOver("doorbell", d, T), "released");
  await until(() => R.getMode() === "ready");
  assert.equal(L.isHolder(), true);
  assert.equal(L.myEpoch(), 2);
  assert.ok(d.calls.includes("startJobs"));
  assert.ok(d.logs.some((l) => /Retomé la posta/.test(l)));
});

test("si la nueva la tomó, la vieja no retoma", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  await H.handOver("doorbell", d, T);
  newHolder(2);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(R.getMode(), "released");
  assert.equal(L.isHolder(), false);
});

test("si pierde la posta a mitad de la entrega, queda cercada: no vuelve a ready ni suelta", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps({
    // El guardado real (persist.ts) confirma la posta antes de subir un blob, y
    // otra instancia ya sacó la época 9.
    flushAll: async () => {
      d.calls.push("flush");
      fake.kv.set("arcade:lease:epoch", "9");
      await L.confirmHolder(); // ve la época 9: se da por perdida y actúa el cerco
      throw new Error("persist: sin la posta, no se guarda");
    },
  });
  H.installFence(d);
  assert.equal(await H.handOver("doorbell", d, T), "not-holder");
  assert.equal(R.getMode(), "fenced");
  assert.ok(!d.calls.includes("startJobs"), "no rearranca los relojes");
  assert.equal(
    JSON.parse(fake.kv.get("arcade:lease:e:1")!).state,
    "active",
    "no suelta una posta que ya no es suya",
  );
});

test("una falla de Upstash al retomar no la hace rendirse: reintenta hasta retomar", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  assert.equal(await H.handOver("doorbell", d, T), "released");
  fake.failWith = 500;
  await until(() => d.logs.some((l) => /No pude mirar la posta|No pude retomar/.test(l)));
  fake.failWith = null;
  await until(() => R.getMode() === "ready");
  assert.equal(L.isHolder(), true);
  assert.ok(d.logs.some((l) => /Retomé la posta/.test(l)));
});

test("si pasó otra época y la posta quedó libre (deploy cancelado), sale para recargar", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  assert.equal(await H.handOver("doorbell", d, T), "released");
  // La nueva sacó la época 2 y la soltó sin haber cargado.
  fake.kv.set("arcade:lease:epoch", "2");
  fake.kv.set("arcade:lease:e:2", record("nueva", "released"));
  await until(() => d.calls.includes("exit 1"));
  assert.equal(R.getMode(), "released", "no retoma con una memoria que puede estar vieja");
  assert.equal(L.isHolder(), false);
});

test("si al retomar otra instancia sacó una época más nueva en el medio, sigue mirando en vez de cortar", async () => {
  await L.acquireLease(); // época 1
  R.setMode("ready");
  const d = deps();
  assert.equal(await H.handOver("doorbell", d, T), "released");
  // Justo después de nuestro INCR al reconfirmar, "otra instancia" saca una
  // época más alta: el primer INCR que vea el falso Upstash suma una más.
  let bumped = false;
  fake.afterCommand = (cmd) => {
    if (bumped || cmd[0].toUpperCase() !== "INCR") return;
    bumped = true;
    fake.kv.set("arcade:lease:epoch", String(Number(fake.kv.get("arcade:lease:epoch")) + 1));
  };
  // Esa época "más nueva" queda huérfana (nadie llegó a escribir su registro),
  // así que se vuelve a ver libre y, pasados otros resumeAfterMs, la vieja sale
  // con 1 para recargar en vez de quedarse mirando para siempre.
  await until(() => d.calls.includes("exit 1"));
  assert.equal(
    R.getMode(),
    "released",
    "no se cerca ni vuelve a 'ready' con la confirmación perdida",
  );
});

// ---- El timbre ------------------------------------------------------------------

/** Cuerpo firmado válido para tocar el timbre, con la firma de la época y el
 *  momento que le pasás (que en el árbitro real sale del token de Upstash). */
function ring(forEpoch: number, ts = Date.now()): H.DoorbellBody {
  return { forEpoch, ts, token: H.doorbellToken(forEpoch, ts) };
}

test("timbre válido: 202 y arranca la entrega", async () => {
  await L.acquireLease();
  R.setMode("ready");
  fake.kv.set(
    "arcade:lease:handover",
    JSON.stringify({ by: "nueva", forEpoch: 1, at: Date.now() }),
  );
  const d = deps();
  const r = await H.answerDoorbell(d, ring(1, d.now()), T);
  newHolder(2); // la nueva toma la posta: la vieja no tiene que retomarla
  assert.equal(r.status, 202);
  assert.ok(["draining", "released"].includes(R.getMode()));
  await until(() => R.getMode() === "released");
});

test("timbre sin pedido en Redis, para otra época, propio o viejo: 409 y no entrega", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  const body = ring(1, d.now()); // la firma es válida en las cuatro pruebas: lo que cambia es Redis
  assert.equal((await H.answerDoorbell(d, body, T)).status, 409, "sin pedido");
  const pedido = (p: object) => fake.kv.set("arcade:lease:handover", JSON.stringify(p));
  pedido({ by: "nueva", forEpoch: 7, at: Date.now() });
  assert.equal((await H.answerDoorbell(d, body, T)).status, 409, "otra época");
  pedido({ by: L.INSTANCE_ID, forEpoch: 1, at: Date.now() });
  assert.equal((await H.answerDoorbell(d, body, T)).status, 409, "propio");
  pedido({ by: "nueva", forEpoch: 1, at: Date.now() - 61_000 });
  assert.equal((await H.answerDoorbell(d, body, T)).status, 409, "viejo");
  assert.equal(R.getMode(), "ready");
  assert.equal(L.isHolder(), true);
});

test("timbre a una instancia que no es dueña: 409", async () => {
  R.setMode("starting");
  const d = deps();
  assert.equal((await H.answerDoorbell(d, ring(1, d.now()), T)).status, 409);
});

test("timbre sin firma válida: 403 y no toca Redis", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  const before = fake.log.length;
  assert.equal((await H.answerDoorbell(d, {}, T)).status, 403, "sin body");
  const now = d.now();
  assert.equal(
    (await H.answerDoorbell(d, { forEpoch: 1, ts: now, token: "no-es-el-token" }, T)).status,
    403,
    "token incorrecto",
  );
  assert.equal(
    (await H.answerDoorbell(d, ring(1, now - 1_000_000), T)).status,
    403,
    "ts viejo, aunque la firma sea la correcta para ese ts",
  );
  assert.equal(fake.log.length, before, "ninguna de las tres tocó Redis");
});

// ---- Cerco y apagado -----------------------------------------------------------

test("al perder la posta sin entregarla: se cerca (/health 503) y frena relojes", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  H.installFence(d);
  fake.kv.set("arcade:lease:epoch", "9");
  assert.equal(await L.confirmHolder(), false);
  assert.equal(R.getMode(), "fenced");
  assert.ok(d.calls.includes("stopJobs"));
});

test("apagado: en ready entrega; arrancando con la posta, la suelta SIN guardar", async () => {
  await L.acquireLease();
  R.setMode("ready");
  const d = deps();
  await H.shutdown("SIGTERM", d);
  assert.deepEqual(d.calls, ["stopJobs", "idle", "flush"]);
  assert.equal(JSON.parse(fake.kv.get("arcade:lease:e:1")!).state, "released");

  L.resetLeaseForTests();
  await L.acquireLease(); // época 2, todavía cargando
  R.setMode("starting");
  const d2 = deps();
  await H.shutdown("SIGTERM", d2);
  assert.deepEqual(d2.calls, [], "no guarda: no cargó nada que valga más que lo de Redis");
  assert.equal(JSON.parse(fake.kv.get("arcade:lease:e:2")!).state, "released");
});
