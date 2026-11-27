// El flujo pagado completo en una sola llamada: `playAndSubmit({ game, stake })`
// con `paid1v1` revisa, se sienta, aprueba, pide de nuevo justo antes de
// depositar (como la web), deposita, y juega en vivo con reintentos acotados
// cuando el árbitro todavía no ve el depósito. Y `resume1v1(matchId)` retoma una
// partida pagada sin depositar de nuevo.
// Correr: node --import tsx --test packages/agent-sdk/test/agent-1v1-play.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import { createAgent } from "../src/agent.ts";
import { Paid1v1Error } from "../src/paid1v1.ts";
import { fakeRpc1v1, type Fake1v1State, type FakeRpc1v1 } from "./fake-rpc-1v1.ts";
import {
  AGENT_KEY,
  ARB,
  ESCROW,
  FakePaidArbiter,
  HUMAN,
  ME,
  OTHER_KEY,
  TEST_MAX_TICKS,
  UNITS,
  USDC,
  ZERO,
  newId,
  paidView,
  seatTerms,
} from "./paid1v1-helpers.ts";

const NOW = Date.now();
const T = seatTerms(NOW);
const rpcs: FakeRpc1v1[] = [];
after(() => rpcs.forEach((r) => r.close()));

const LIVE = { decide: () => null, maxTicks: TEST_MAX_TICKS };

async function setup(state: Partial<Fake1v1State> = {}) {
  const rpc = await fakeRpc1v1("0x7a69", {
    escrow: ESCROW,
    usdc: USDC,
    arbiter: ARB,
    usdcBalance: 100n * UNITS,
    ...state,
  });
  rpcs.push(rpc);
  let now = NOW;
  const sleeps: number[] = [];
  const clock = () => now;
  const fake = new FakePaidArbiter(clock);
  const agent = createAgent({
    client: fake,
    privateKey: AGENT_KEY,
    paid1v1: { rpcUrl: rpc.url, escrow: ESCROW, chainId: 31337, maxStake: 2 },
    clock,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
  });
  return { rpc, fake, agent, sleeps };
}

/** Una partida abierta en la cadena por una persona, esperando rival. */
const openByHuman = (id: Hex) => ({
  [id]: {
    p1: HUMAN,
    p2: ZERO,
    stake: UNITS,
    fundDeadline: BigInt(T.fd),
    playDeadline: BigInt(T.pd),
    status: 1,
    frozenFeeBps: 1500,
  },
});

const fns = (rpc: FakeRpc1v1) => rpc.broadcasts.map((b) => b.functionName);

test("flujo pagado completo como p1", async () => {
  const { rpc, fake, agent } = await setup();
  const v = await paidView("p1", NOW);
  fake.script = [v];
  const atMatchmake: number[] = [];
  fake.onMatchmake = () => atMatchmake.push(rpc.broadcasts.length);
  const steps: string[] = [];
  const r = await agent.playAndSubmit({
    game: "racing",
    stake: 1,
    liveStrategy: LIVE,
    onPaidStep: (e) => steps.push(`${e.step}:${e.matchId}`),
  });
  // health y arbiter antes de sentarse; el re-pedido después del approve.
  assert.deepEqual(fake.calls.slice(0, 3), ["health", "arbiter", "matchmake"]);
  assert.deepEqual(atMatchmake, [0, 1], "el segundo emparejamiento va después del approve");
  assert.ok(fake.matchmakes[1].ts !== undefined, "el re-pedido va firmado");
  assert.deepEqual(fns(rpc), ["approve", "open"]);
  assert.ok(fake.starts.length >= 1 && fake.commits >= 1, "se jugó la partida");
  assert.deepEqual(steps, [`seated:${v.matchId}`, `deposited:${v.matchId}`]);
  assert.equal(r.deposit?.step, "open");
  assert.equal(r.waitingForRival, true);
  assert.equal(r.scores[ME.toLowerCase()], 7);
});

test("re-pedido que cambia a p2 válido adopta la partida nueva", async () => {
  const b = newId();
  const { rpc, fake, agent } = await setup({ matches: openByHuman(b) });
  const a = await paidView("p1", NOW);
  fake.script = [a, await paidView("p2", NOW, { matchId: b })];
  fake.finalStatus = "ready";
  const r = await agent.playAndSubmit({ game: "racing", stake: 1, liveStrategy: LIVE });
  assert.deepEqual(fns(rpc), ["approve", "join"]);
  assert.equal(rpc.broadcasts[1].args[0], b);
  assert.equal(r.deposit?.step, "join");
  assert.equal(r.deposit?.reseatedFrom, a.matchId);
});

test("re-pedido que cambia a p2 inválido aborta sin depositar", async () => {
  const b = newId();
  const { rpc, fake, agent } = await setup({ matches: openByHuman(b) });
  fake.script = [await paidView("p1", NOW), await paidView("p2", NOW, { matchId: b, stake: 2 })];
  await assert.rejects(
    agent.playAndSubmit({ game: "racing", stake: 1, liveStrategy: LIVE }),
    (e) => {
      assert.ok(e instanceof Paid1v1Error);
      assert.equal(e.stage, "seat");
      return true;
    },
  );
  assert.ok(!fns(rpc).includes("open") && !fns(rpc).includes("join"), fns(rpc).join(","));
});

test("nunca se re-pide después de mandar", async () => {
  const { fake, agent } = await setup({ minedRevert: "open" });
  fake.script = [await paidView("p1", NOW)];
  await assert.rejects(
    agent.playAndSubmit({ game: "racing", stake: 1, liveStrategy: LIVE }),
    (e) => {
      assert.ok(e instanceof Paid1v1Error);
      assert.equal(e.stage, "deposit");
      return true;
    },
  );
  assert.equal(fake.matchmakes.length, 2);
});

test("asiento de p2 que no verifica se re-pide una vez", async () => {
  const b = newId();
  const { rpc, fake, agent } = await setup({ matches: openByHuman(b) });
  const good = await paidView("p2", NOW, { matchId: b });
  fake.script = [await paidView("p2", NOW, { matchId: b, seatKey: OTHER_KEY }), good];
  fake.finalStatus = "ready";
  await agent.playAndSubmit({ game: "racing", stake: 1, liveStrategy: LIVE });
  const join = rpc.broadcasts.find((x) => x.functionName === "join");
  assert.equal(join?.args[1], good.seatSig);
});

test("asiento de p2 que no verifica dos veces aborta sin transmitir", async () => {
  const b = newId();
  const { rpc, fake, agent } = await setup({ matches: openByHuman(b) });
  fake.script = [await paidView("p2", NOW, { matchId: b, seatKey: OTHER_KEY })];
  await assert.rejects(
    agent.playAndSubmit({ game: "racing", stake: 1, liveStrategy: LIVE }),
    (e) => {
      assert.ok(e instanceof Paid1v1Error);
      assert.equal(e.stage, "seat");
      return true;
    },
  );
  assert.deepEqual(rpc.broadcasts, []);
});

test("árbitro sin rules en /health revisa las reglas después de emparejar", async () => {
  const { rpc, fake, agent } = await setup();
  fake.healthBody = { ok: true, escrow: "ok" };
  fake.script = [await paidView("p1", NOW, { rulesV: 99 })];
  await assert.rejects(
    agent.playAndSubmit({ game: "racing", stake: 1, liveStrategy: LIVE }),
    (e) => {
      assert.ok(e instanceof Paid1v1Error);
      assert.equal(e.stage, "seat");
      assert.match(e.message, /rules version mismatch/);
      return true;
    },
  );
  assert.equal(fake.matchmakes.length, 1);
  assert.deepEqual(rpc.broadcasts, []);
});

test("partida propia que vuelve, sin jugar: se juega sin depositar", async () => {
  const a = newId();
  const { rpc, fake, agent } = await setup({
    matches: {
      [a]: {
        p1: ME,
        p2: ZERO,
        stake: UNITS,
        fundDeadline: BigInt(T.fd),
        playDeadline: BigInt(T.pd),
        status: 1,
      },
    },
  });
  fake.script = [await paidView("p1", NOW, { matchId: a })];
  const r = await agent.playAndSubmit({ game: "racing", stake: 1, liveStrategy: LIVE });
  assert.deepEqual(rpc.broadcasts, []);
  assert.ok(fake.commits >= 1, "se jugó");
  assert.equal(r.deposit?.step, "already");
});

test("partida propia que vuelve, ya jugada: espera rival sin gastar nada", async () => {
  const a = newId();
  const { rpc, fake, agent } = await setup({
    matches: {
      [a]: {
        p1: ME,
        p2: ZERO,
        stake: UNITS,
        fundDeadline: BigInt(T.fd),
        playDeadline: BigInt(T.pd),
        status: 1,
      },
    },
  });
  fake.script = [await paidView("p1", NOW, { matchId: a })];
  fake.startOver = { score: 5, tick: TEST_MAX_TICKS };
  const r = await agent.playAndSubmit({ game: "racing", stake: 1, liveStrategy: LIVE });
  assert.deepEqual(rpc.broadcasts, []);
  assert.equal(fake.commits, 0);
  assert.equal(r.waitingForRival, true);
  assert.equal(r.deposit?.step, "already");
});

test("una segunda partida pagada en juego se rechaza sin emparejar", async () => {
  const { fake, agent } = await setup();
  fake.script = [await paidView("p1", NOW)];
  const first = agent.playAndSubmit({ game: "racing", stake: 1, liveStrategy: LIVE });
  await assert.rejects(
    agent.playAndSubmit({ game: "racing", stake: 1, liveStrategy: LIVE }),
    (e) => {
      assert.ok(e instanceof Paid1v1Error);
      assert.equal(e.stage, "check");
      return true;
    },
  );
  // La ladder gratis no espera a la partida pagada.
  const free = await agent.playAndSubmit({ game: "2048", stake: 0 });
  assert.equal(free.status, "settled");
  await first;
  assert.equal(fake.matchmakes.length, 2, "solo los dos emparejamientos de la primera");
});

test("live/start reintenta el depósito todavía no visible", async () => {
  const { fake, agent, sleeps } = await setup();
  fake.script = [await paidView("p1", NOW)];
  fake.startFailures = 2;
  await agent.playAndSubmit({ game: "racing", stake: 1, liveStrategy: LIVE });
  assert.equal(fake.starts.length, 3);
  for (let i = 1; i < fake.starts.length; i++) {
    assert.ok(fake.starts[i] - fake.starts[i - 1] >= 2000, "nunca dos live/start a menos de 2 s");
  }
  assert.deepEqual(sleeps.slice(0, 2), [2000, 4000]);
  assert.ok(fake.commits >= 1);
});

test("resume1v1 juega una partida cuyo live/start falló de más", async () => {
  const { rpc, fake, agent, sleeps } = await setup();
  const v = await paidView("p1", NOW);
  fake.script = [v];
  fake.startFailures = 1000;
  await assert.rejects(
    agent.playAndSubmit({ game: "racing", stake: 1, liveStrategy: LIVE }),
    (e) => {
      assert.ok(e instanceof Paid1v1Error);
      assert.equal(e.stage, "play");
      assert.equal(e.deposited, true);
      assert.equal(e.matchId, v.matchId);
      assert.match(e.message, /resume1v1/);
      return true;
    },
  );
  assert.equal(
    sleeps.reduce((a, b) => a + b, 0),
    60_000,
  );
  const sent = rpc.broadcasts.length;
  fake.startFailures = 0;
  const r = await agent.resume1v1(v.matchId, { liveStrategy: LIVE });
  assert.equal(rpc.broadcasts.length, sent, "retomar no deposita de nuevo");
  assert.ok(fake.commits >= 1);
  assert.equal(r.matchId, v.matchId);
});

test("resume1v1 sin depósito en la cadena se niega", async () => {
  const { agent } = await setup();
  await assert.rejects(agent.resume1v1(newId(), { liveStrategy: LIVE }), (e) => {
    assert.ok(e instanceof Paid1v1Error);
    assert.equal(e.deposited, false);
    return true;
  });
});

test("stake 0 sigue sin tocar el RPC", async () => {
  const { rpc, agent } = await setup();
  await agent.playAndSubmit({ game: "2048", stake: 0 });
  assert.deepEqual(rpc.calls, []);
});
