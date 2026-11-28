// Las mesas 1v1 de plata desde la wallet del agente: la revisión previa (todo
// lo que puede fallar sin gastar se revisa ANTES de sentarse), la verificación
// del asiento contra el contrato que fijó el operador, y el depósito exacto
// (approve + open o join). Lo que importa en cada prueba es qué se transmitió:
// `broadcasts` vacío cuando algo está mal, y exactamente lo esperado cuando
// está bien (sin ese control positivo, un "nada" también podría ser un fake que
// no sabe llegar al envío).
// Correr: node --import tsx --test packages/agent-sdk/test/agent-1v1-money.test.ts
import { test, after } from "node:test";
import { inspect } from "node:util";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { SEAT_TYPES, seatDomain } from "@arcade1v1/game-sdk/escrow1v1";
import { ArbiterClient, type MatchView } from "../src/client.ts";
import { createPaid1v1, Paid1v1Error } from "../src/paid1v1.ts";
import { createTxLock } from "../src/tx-lock.ts";
import type { Paid1v1Config } from "../src/paid1v1-config.ts";
import { fakeRpc1v1, type Fake1v1State, type FakeRpc1v1 } from "./fake-rpc-1v1.ts";

// Claves de prueba de anvil (públicas, sin valor): el agente y el árbitro.
const AGENT_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const ARB_KEY = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6" as const;
const OTHER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const;
const ME = privateKeyToAccount(AGENT_KEY).address;
const ARB = privateKeyToAccount(ARB_KEY).address;
const ESCROW = ("0x" + "e5".repeat(20)) as Hex;
const USDC = ("0x" + "5c".repeat(20)) as Hex;
const HUMAN = ("0x" + "a1".repeat(20)) as Hex;
const ZERO = ("0x" + "0".repeat(40)) as Hex;
const UNITS = 1_000_000n;

const NOW_MS = Date.now();
const NOW_S = Math.floor(NOW_MS / 1000);
const FD = NOW_S + 70 * 60;
const PD = NOW_S + 2 * 3600;
let idSeq = 0;
const newId = () => ("0x" + (++idSeq).toString(16).padStart(64, "0")) as Hex;

/** Un árbitro falso: /health, /arbiter y la cuenta de emparejamientos. */
class FakeArbiter extends ArbiterClient {
  public matchmakes = 0;
  public healthBody: Record<string, unknown> = { ok: true, escrow: "ok", rules: { ...RULES_V } };
  public arbiter: string = ARB;
  constructor() {
    super("http://fake");
  }
  async health() {
    return this.healthBody as never;
  }
  async arbiterAddress() {
    return this.arbiter;
  }
  async matchmake(): Promise<MatchView> {
    this.matchmakes++;
    throw new Error("no se empareja en estas pruebas");
  }
}

async function seat(
  matchId: Hex,
  opts: { key?: Hex; chainId?: number; stake?: bigint; fd?: number; pd?: number } = {},
): Promise<Hex> {
  return privateKeyToAccount(opts.key ?? ARB_KEY).signTypedData({
    domain: seatDomain(opts.chainId ?? 31337, ESCROW),
    types: SEAT_TYPES,
    primaryType: "Seat",
    message: {
      matchId,
      player: ME.toLowerCase() as Hex,
      stake: opts.stake ?? UNITS,
      fundDeadline: BigInt(opts.fd ?? FD),
      playDeadline: BigInt(opts.pd ?? PD),
    },
  });
}

async function paidView(role: "p1" | "p2", over: Partial<MatchView> = {}): Promise<MatchView> {
  const matchId = (over.matchId as Hex) ?? newId();
  return {
    matchId,
    game: "racing",
    stake: 1,
    live: true,
    secretHash: "ab".repeat(32),
    rulesV: RULES_V.racing,
    status: role === "p1" ? "waiting" : "ready",
    role,
    opponent: role === "p2" ? HUMAN : undefined,
    scores: {},
    seatSig: await seat(matchId),
    fundDeadline: FD,
    playDeadline: PD,
    ...over,
  } as MatchView;
}

const rpcs: FakeRpc1v1[] = [];
after(() => rpcs.forEach((r) => r.close()));

async function setup(
  state: Partial<Fake1v1State> = {},
  cfg: Partial<Paid1v1Config> = {},
  chainIdHex = "0x7a69",
) {
  const rpc = await fakeRpc1v1(chainIdHex, {
    escrow: ESCROW,
    usdc: USDC,
    arbiter: ARB,
    usdcBalance: 100n * UNITS,
    ...state,
  });
  rpcs.push(rpc);
  const client = new FakeArbiter();
  const paid = createPaid1v1({
    cfg: { rpcUrl: rpc.url, escrow: ESCROW, chainId: 31337, maxStake: 2, ...cfg },
    privateKey: AGENT_KEY,
    client,
    clock: () => NOW_MS,
    txLock: createTxLock(),
    sleep: async () => {},
  });
  return { rpc, client, paid };
}

/** Tira un Paid1v1Error de esa etapa. */
async function rejectsAt(p: Promise<unknown>, stage: string, msg?: RegExp) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof Paid1v1Error, `no es Paid1v1Error: ${(e as Error).message}`);
    assert.equal(e.stage, stage, e.message);
    if (msg) assert.match(e.message, msg);
    return true;
  });
}

// ---- Revisión previa: nada de emparejar ni de transmitir --------------------

const preflightFails: [
  string,
  Partial<Fake1v1State>,
  Partial<Paid1v1Config>,
  string?,
  ((c: FakeArbiter) => void)?,
  string?,
][] = [
  ["red distinta", {}, {}, "0x2105"],
  ["sin código en el pin", { code: false }, {}],
  ["arbiter() distinto de /arbiter", {}, {}, undefined, (c) => (c.arbiter = HUMAN)],
  ["feeBps 1600", { feeBps: 1600 }, {}],
  ["allowedStake falso", { allowed: [2_000_000n] }, {}],
  ["USDC corto", { usdcBalance: 0n }, {}],
  ["ETH corto", { ethBalance: 0n }, {}],
  [
    "/health escrow blocked",
    {},
    {},
    undefined,
    (c) => (c.healthBody = { ...c.healthBody, escrow: "blocked" }),
  ],
  [
    "/health rules distinto",
    {},
    {},
    undefined,
    (c) => (c.healthBody = { ...c.healthBody, rules: { ...RULES_V, racing: 99 } }),
  ],
];

for (const [name, state, cfg, chainHex, tweak] of preflightFails) {
  test(`revisión previa: ${name} corta antes de emparejar`, async () => {
    const { rpc, client, paid } = await setup(state, cfg, chainHex);
    tweak?.(client);
    await rejectsAt(paid.preflight("racing", 1), "check");
    assert.equal(client.matchmakes, 0);
    assert.deepEqual(rpc.broadcasts, []);
  });
}

test("revisión previa: stake mayor que maxStake corta sin tocar la red", async () => {
  const { rpc, paid } = await setup();
  await rejectsAt(paid.preflight("racing", 5), "check", /maxStake/);
  assert.deepEqual(rpc.calls, []);
});

test("revisión previa: un juego con semilla corta sin tocar la red", async () => {
  const { rpc, paid } = await setup();
  await rejectsAt(paid.preflight("2048", 1), "check", /live games only/);
  assert.deepEqual(rpc.calls, []);
});

test("revisión previa: Space Invaders en vivo también entra", async () => {
  const { paid } = await setup();
  const pre = await paid.preflight("invaders", 1);
  assert.equal(pre.units, UNITS);
});

test("revisión previa: en Base, un usdc() que no es el de Circle se rechaza", async () => {
  const { rpc, paid } = await setup({}, { chainId: 8453 }, "0x2105");
  await rejectsAt(paid.preflight("racing", 1), "check", /Circle/);
  assert.deepEqual(rpc.broadcasts, []);
});

test("revisión previa: todo en orden devuelve las unidades y el árbitro", async () => {
  const { paid } = await setup();
  const pre = await paid.preflight("racing", 1);
  assert.equal(pre.units, UNITS);
  assert.equal(pre.arbiter.toLowerCase(), ARB.toLowerCase());
  assert.equal(pre.usdc.toLowerCase(), USDC.toLowerCase());
  assert.equal(pre.rulesChecked, true);
});

// ---- Árbitro mentiroso: el asiento no verifica, nada se transmite -----------

const lies: [string, (v: MatchView) => Promise<Partial<MatchView>>][] = [
  ["stake distinto", async () => ({ stake: 2 })],
  ["sin seatSig", async () => ({ seatSig: undefined })],
  [
    "asiento firmado por otra llave",
    async (v) => ({ seatSig: await seat(v.matchId as Hex, { key: OTHER_KEY }) }),
  ],
  [
    "asiento de otra red",
    async (v) => ({ seatSig: await seat(v.matchId as Hex, { chainId: 8453 }) }),
  ],
  [
    "playDeadline en ahora + 2 días",
    async (v) => ({
      playDeadline: NOW_S + 2 * 86400,
      seatSig: await seat(v.matchId as Hex, { pd: NOW_S + 2 * 86400 }),
    }),
  ],
  ["live falso", async () => ({ live: undefined })],
  ["juego distinto del pedido", async () => ({ game: "flappy", rulesV: RULES_V.flappy })],
  ["rulesV distinto", async () => ({ rulesV: 99 })],
];

for (const [name, lie] of lies) {
  test(`árbitro mentiroso: ${name} no transmite nada`, async () => {
    const { rpc, paid } = await setup();
    const pre = await paid.preflight("racing", 1);
    const v = await paidView("p1");
    await rejectsAt(paid.verifySeat({ ...v, ...(await lie(v)) }, 1, pre), "seat");
    assert.deepEqual(rpc.broadcasts, []);
  });
}

// ---- Depósito -----------------------------------------------------------------

test("p1 feliz: approve exacto y open con los plazos de la vista", async () => {
  const { rpc, paid } = await setup();
  const pre = await paid.preflight("racing", 1);
  const v = await paidView("p1");
  await paid.verifySeat(v, 1, pre);
  await paid.approveIfNeeded(pre);
  const d = await paid.deposit(v, pre);
  assert.equal(d.step, "open");
  assert.equal(d.role, "p1");
  assert.deepEqual(
    rpc.broadcasts.map((b) => [
      b.to?.toLowerCase(),
      b.functionName,
      ...b.args.map((a) => (typeof a === "string" ? a.toLowerCase() : a)),
    ]),
    [
      [USDC.toLowerCase(), "approve", ESCROW, UNITS],
      [
        ESCROW.toLowerCase(),
        "open",
        v.matchId,
        UNITS,
        BigInt(FD),
        BigInt(PD),
        v.seatSig!.toLowerCase(),
      ],
    ],
  );
  assert.equal(await paid.depositedRole(v.matchId), "p1");
});

test("p2 feliz: lee la partida, approve y join", async () => {
  const id = newId();
  const { rpc, paid } = await setup({
    matches: {
      [id]: {
        p1: HUMAN,
        p2: ZERO,
        stake: UNITS,
        fundDeadline: BigInt(FD),
        playDeadline: BigInt(PD),
        status: 1,
        frozenFeeBps: 1500,
      },
    },
  });
  const pre = await paid.preflight("racing", 1);
  const v = await paidView("p2", { matchId: id });
  await paid.verifySeat(v, 1, pre);
  await paid.approveIfNeeded(pre);
  const d = await paid.deposit(v, pre);
  assert.equal(d.step, "join");
  assert.deepEqual(
    rpc.broadcasts.map((b) => b.functionName),
    ["approve", "join"],
  );
  assert.ok(rpc.calls.indexOf("eth_call:matches") < rpc.calls.indexOf("eth_sendRawTransaction"));
  assert.equal(await paid.depositedRole(id), "p2");
});

test("p2 con poco margen de cadena se rechaza sin transmitir", async () => {
  const id = newId();
  const { rpc, paid } = await setup({
    blockTimestamp: FD - 30,
    matches: {
      [id]: {
        p1: HUMAN,
        p2: ZERO,
        stake: UNITS,
        fundDeadline: BigInt(FD),
        playDeadline: BigInt(PD),
        status: 1,
      },
    },
  });
  const pre = await paid.preflight("racing", 1);
  await rejectsAt(paid.verifySeat(await paidView("p2", { matchId: id }), 1, pre), "seat");
  assert.deepEqual(rpc.broadcasts, []);
});

test("p2 con comisión congelada alta se rechaza", async () => {
  const id = newId();
  const { rpc, paid } = await setup({
    matches: {
      [id]: {
        p1: HUMAN,
        p2: ZERO,
        stake: UNITS,
        fundDeadline: BigInt(FD),
        playDeadline: BigInt(PD),
        status: 1,
        frozenFeeBps: 1600,
      },
    },
  });
  const pre = await paid.preflight("racing", 1);
  await rejectsAt(paid.verifySeat(await paidView("p2", { matchId: id }), 1, pre), "seat", /fee/);
  assert.deepEqual(rpc.broadcasts, []);
});

test("p2 contra un contrato sin la comisión congelada usa feeBps()", async () => {
  const id = newId();
  const { paid } = await setup({
    noFeeField: true,
    matches: {
      [id]: {
        p1: HUMAN,
        p2: ZERO,
        stake: UNITS,
        fundDeadline: BigInt(FD),
        playDeadline: BigInt(PD),
        status: 1,
      },
    },
  });
  const pre = await paid.preflight("racing", 1);
  await paid.verifySeat(await paidView("p2", { matchId: id }), 1, pre);
});

test("carrera perdida: otro p2 se unió antes, error claro y el permiso se reusa", async () => {
  const id = newId();
  const { rpc, paid } = await setup({
    rivalJoinsFirst: ("0x" + "b2".repeat(20)) as Hex,
    matches: {
      [id]: {
        p1: HUMAN,
        p2: ZERO,
        stake: UNITS,
        fundDeadline: BigInt(FD),
        playDeadline: BigInt(PD),
        status: 1,
      },
    },
  });
  const pre = await paid.preflight("racing", 1);
  const v = await paidView("p2", { matchId: id });
  await paid.verifySeat(v, 1, pre);
  await paid.approveIfNeeded(pre);
  await assert.rejects(paid.deposit(v, pre), (e: unknown) => {
    assert.ok(e instanceof Paid1v1Error);
    assert.equal(e.stage, "deposit");
    assert.equal(e.deposited, false);
    assert.equal(e.matchId, id);
    return true;
  });
  // Otra mesa: el permiso que quedó alcanza, no hay approve nuevo.
  rpc.state.rivalJoinsFirst = undefined;
  assert.equal(await paid.approveIfNeeded(pre), undefined);
  assert.equal(rpc.broadcasts.filter((b) => b.functionName === "approve").length, 1);
});

test("ya depositado: devuelve already sin transmitir", async () => {
  const id = newId();
  const { rpc, paid } = await setup({
    matches: {
      [id]: {
        p1: ME,
        p2: ZERO,
        stake: UNITS,
        fundDeadline: BigInt(FD),
        playDeadline: BigInt(PD),
        status: 1,
      },
    },
  });
  const pre = await paid.preflight("racing", 1);
  const d = await paid.deposit(await paidView("p1", { matchId: id }), pre);
  assert.equal(d.step, "already");
  assert.deepEqual(rpc.broadcasts, []);
});

test("recibo preconfirmado: el open se simula después de sellado el approve", async () => {
  const { rpc, paid } = await setup({ sealMs: 400 });
  const pre = await paid.preflight("racing", 1);
  const v = await paidView("p1");
  await paid.verifySeat(v, 1, pre);
  await paid.approveIfNeeded(pre);
  const d = await paid.deposit(v, pre);
  assert.equal(d.step, "open");
  assert.deepEqual(
    rpc.broadcasts.map((b) => b.functionName),
    ["approve", "open"],
  );
});

test("revert minado: el open revertido termina en error sin depósito", async () => {
  const { paid } = await setup({ minedRevert: "open" });
  const pre = await paid.preflight("racing", 1);
  const v = await paidView("p1");
  await paid.approveIfNeeded(pre);
  await assert.rejects(paid.deposit(v, pre), (e: unknown) => {
    assert.ok(e instanceof Paid1v1Error);
    assert.equal(e.stage, "deposit");
    assert.equal(e.deposited, false);
    return true;
  });
});

test("sin ETH para el depósito: error claro y el permiso se reusa", async () => {
  const { rpc, paid } = await setup({ ethForGas: "approveOnly" });
  const pre = await paid.preflight("racing", 1);
  const v = await paidView("p1");
  await paid.verifySeat(v, 1, pre);
  await paid.approveIfNeeded(pre);
  await assert.rejects(paid.deposit(v, pre), (e: unknown) => {
    assert.ok(e instanceof Paid1v1Error);
    assert.equal(e.stage, "deposit");
    assert.equal(e.deposited, false);
    assert.equal(e.matchId, v.matchId);
    return true;
  });
  // El operador le devuelve el ETH: el segundo intento manda solo el open.
  rpc.state.ethForGas = undefined;
  assert.equal(await paid.approveIfNeeded(pre), undefined);
  const d = await paid.deposit(v, pre);
  assert.equal(d.step, "open");
  assert.deepEqual(
    rpc.broadcasts.map((b) => b.functionName),
    ["approve", "open"],
  );
});

// ---- Cobrar lo acreditado, USDC de prueba y saldos ----------------------------

import { createAgent } from "../src/agent.ts";

async function agentOn(state: Partial<Fake1v1State> = {}, chainId: 8453 | 84532 | 31337 = 31337) {
  const rpc = await fakeRpc1v1(
    chainId === 8453 ? "0x2105" : chainId === 84532 ? "0x14a34" : "0x7a69",
    {
      escrow: ESCROW,
      usdc: USDC,
      arbiter: ARB,
      usdcBalance: 100n * UNITS,
      ...state,
    },
  );
  rpcs.push(rpc);
  const agent = createAgent({
    client: new FakeArbiter(),
    privateKey: AGENT_KEY,
    paid1v1: { rpcUrl: rpc.url, escrow: ESCROW, chainId, maxStake: 2 },
  });
  return { rpc, agent };
}

test("withdraw1v1 sin nada acreditado no transmite", async () => {
  const { rpc, agent } = await agentOn({ owed: 0n });
  assert.deepEqual(await agent.withdraw1v1(), { amount: 0n });
  assert.deepEqual(rpc.broadcasts, []);
});

test("withdraw1v1 con acreditado manda un withdraw al pin", async () => {
  const { rpc, agent } = await agentOn({ owed: 1_700_000n });
  const r = await agent.withdraw1v1();
  assert.equal(r.amount, 1_700_000n);
  assert.ok(r.txHash);
  assert.deepEqual(
    rpc.broadcasts.map((b) => [b.to?.toLowerCase(), b.functionName]),
    [[ESCROW.toLowerCase(), "withdraw"]],
  );
});

test("mintTestUsdc en 8453 se niega sin tocar la red", async () => {
  const { rpc, agent } = await agentOn({}, 8453);
  await assert.rejects(agent.mintTestUsdc(5), /only works on test networks/);
  assert.deepEqual(rpc.calls, []);
});

test("mintTestUsdc en 84532 manda mint(yo, unidades) al usdc() del pin", async () => {
  const { rpc, agent } = await agentOn({}, 84532);
  const r = await agent.mintTestUsdc(3);
  assert.equal(r.amount, 3_000_000n);
  assert.deepEqual(
    rpc.broadcasts.map((b) => [
      b.to?.toLowerCase(),
      b.functionName,
      String(b.args[0]).toLowerCase(),
      b.args[1],
    ]),
    [[USDC.toLowerCase(), "mint", ME.toLowerCase(), 3_000_000n]],
  );
});

test("paid1v1Balances lee usdc, eth y owed", async () => {
  const { agent } = await agentOn({ owed: 5n, ethBalance: 123n });
  assert.deepEqual(await agent.paid1v1Balances(), {
    chainId: 31337,
    usdc: 100n * UNITS,
    eth: 123n,
    owed: 5n,
  });
});

test("sin paid1v1, cobrar, acuñar y leer saldos se niegan", async () => {
  const agent = createAgent({ client: new FakeArbiter(), privateKey: AGENT_KEY });
  await assert.rejects(agent.withdraw1v1(), /needs paid1v1/);
  await assert.rejects(agent.mintTestUsdc(1), /needs paid1v1/);
  await assert.rejects(agent.paid1v1Balances(), /needs paid1v1/);
});

// ---- Hallazgos de la revisión final -------------------------------------------

test("un depósito transmitido cuyo recibo falla, y que después aparece, cuenta como hecho", async () => {
  const { rpc, paid } = await setup();
  const pre = await paid.preflight("racing", 1);
  const v = await paidView("p1");
  await paid.verifySeat(v, 1, pre);
  await paid.approveIfNeeded(pre);
  rpc.state.receiptFails = true; // el open se transmite y se mina, pero no hay recibo
  const d = await paid.deposit(v, pre);
  assert.equal(d.step, "open");
  assert.ok(d.txHash);
  assert.equal(await paid.depositedRole(v.matchId), "p1");
});

test("un depósito transmitido que no se confirma avisa deposited: true con el tx", async () => {
  const { rpc, paid } = await setup();
  const pre = await paid.preflight("racing", 1);
  const v = await paidView("p1");
  await paid.verifySeat(v, 1, pre);
  await paid.approveIfNeeded(pre);
  rpc.state.receiptFails = true;
  rpc.state.dropNext = true; // se transmite y queda colgado
  await assert.rejects(paid.deposit(v, pre), (e: unknown) => {
    assert.ok(e instanceof Paid1v1Error);
    assert.equal(e.stage, "deposit");
    assert.equal(e.deposited, true, "puede entrar todavía: no es seguro volver a emparejar");
    assert.equal(e.matchId, v.matchId);
    assert.ok(e.txHash, "lleva el tx para revisarlo");
    assert.match(e.message, new RegExp(v.matchId));
    assert.match(e.message, /do not matchmake again/);
    return true;
  });
});

test("la URL del RPC no aparece ni en el mensaje ni en la causa", async () => {
  const { rpc } = await setup();
  const client = new FakeArbiter();
  const paid = createPaid1v1({
    cfg: { rpcUrl: `${rpc.url}/v2/SECRETO123`, escrow: ESCROW, chainId: 31337, maxStake: 2 },
    privateKey: AGENT_KEY,
    client,
    clock: () => NOW_MS,
    txLock: createTxLock(),
    sleep: async () => {},
  });
  const pre = await paid.preflight("racing", 1);
  rpc.close(); // el RPC se cae justo antes de leer el permiso
  await assert.rejects(paid.approveIfNeeded(pre), (e: unknown) => {
    assert.ok(e instanceof Paid1v1Error, "sale como Paid1v1Error");
    assert.ok(!e.message.includes("SECRETO123"), e.message);
    assert.ok(!inspect(e, { depth: 10 }).includes("SECRETO123"), "ni en la causa");
    return true;
  });
});
