// apps/mcp/test/tools-paid.test.ts
// Las herramientas de las mesas 1v1 de plata del MCP: `play_paid` hace el flujo
// completo del SDK en una llamada, falla cerrado sin la configuración del
// operador, respeta el tope y las mesas sin tocar la red, no le muestra al
// modelo la URL del RPC, y reintentar no abre una partida nueva. Las
// herramientas gratis siguen rechazando stake > 0.
// Correr: node --import tsx --test apps/mcp/test/tools-paid.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createAgent } from "@arcade1v1/agent-sdk";
import {
  createPaidLedger,
  matchmakeTool,
  mintTestUsdcTool,
  playAndSubmitTool,
  playPaidTool,
  resumePaidTool,
  withdraw1v1Tool,
} from "../src/tools";
import { fakeRpc1v1, type FakeRpc1v1 } from "../../../packages/agent-sdk/test/fake-rpc-1v1";
import {
  AGENT_KEY,
  ARB,
  ESCROW,
  FakePaidArbiter,
  UNITS,
  USDC,
  paidView,
} from "../../../packages/agent-sdk/test/paid1v1-helpers";

const rpcs: FakeRpc1v1[] = [];
after(() => rpcs.forEach((r) => r.close()));

async function setup(opts: { maxStake?: number; rpcUrl?: string } = {}) {
  const rpc = await fakeRpc1v1("0x7a69", {
    escrow: ESCROW,
    usdc: USDC,
    arbiter: ARB,
    usdcBalance: 100n * UNITS,
  });
  rpcs.push(rpc);
  const fake = new FakePaidArbiter();
  fake.script = [await paidView("p1", Date.now())];
  const maxStake = opts.maxStake ?? 2;
  const agent = createAgent({
    client: fake,
    privateKey: AGENT_KEY,
    paid1v1: { rpcUrl: opts.rpcUrl ?? rpc.url, escrow: ESCROW, chainId: 31337, maxStake },
  });
  return { rpc, fake, agent, paid: { maxStake } };
}

test("play_paid sin configuración falla cerrado y nombra las variables", async () => {
  const { agent, rpc, fake } = await setup();
  await assert.rejects(
    playPaidTool(agent, createPaidLedger(), "racing", 1, undefined),
    (e: Error) =>
      /paid 1v1 tables are off on this MCP server/.test(e.message) &&
      /ARCADE_1V1_ESCROW_ADDRESS/.test(e.message) &&
      /ARCADE_PRIVATE_KEY/.test(e.message),
  );
  assert.deepEqual(rpc.calls, []);
  assert.equal(fake.matchmakes.length, 0);
});

test("play_paid rechaza un stake fuera de tope o de mesa sin tocar la red", async () => {
  const { agent, rpc, fake } = await setup({ maxStake: 5 });
  await assert.rejects(
    playPaidTool(agent, createPaidLedger(), "racing", 10, { maxStake: 5 }),
    /ARCADE_1V1_MAX_STAKE/,
  );
  await assert.rejects(
    playPaidTool(agent, createPaidLedger(), "racing", 3, { maxStake: 5 }),
    /tables are 1, 2, 5 and 10 USDC/,
  );
  assert.deepEqual(rpc.calls, []);
  assert.equal(fake.calls.length, 0);
});

test("un error de plata no muestra la URL del RPC", async () => {
  const { agent } = await setup({ rpcUrl: "http://127.0.0.1:9/v2/SECRETKEY123" });
  await assert.rejects(
    playPaidTool(agent, createPaidLedger(), "racing", 1, { maxStake: 2 }),
    (e: Error) => !e.message.includes("SECRETKEY123") && !/https?:\/\//.test(e.message),
  );
});

test("play_paid juega la mesa de punta a punta", async () => {
  const { agent, rpc } = await setup();
  const r = await playPaidTool(agent, createPaidLedger(), "racing", 1, { maxStake: 2 });
  assert.equal(r.deposit?.step, "open");
  assert.deepEqual(
    rpc.broadcasts.map((b) => b.functionName),
    ["approve", "open"],
  );
});

test("reintentar mientras sigue en curso devuelve el mismo resultado", async () => {
  const { agent, fake } = await setup();
  const ledger = createPaidLedger();
  const first = playPaidTool(agent, ledger, "racing", 1, { maxStake: 2 });
  const second = await playPaidTool(agent, ledger, "racing", 1, { maxStake: 2 });
  const r1 = await first;
  assert.equal(second.resumed, true);
  assert.equal(second.matchId, r1.matchId);
  assert.equal(fake.matchmakes.length, 2, "solo los dos emparejamientos de la primera");
});

test("un resultado sin entregar se devuelve en el siguiente play_paid", async () => {
  const { agent, fake } = await setup();
  const ledger = createPaidLedger();
  const gone = new AbortController();
  gone.abort(); // el cliente MCP ya cortó por tiempo
  const r1 = await playPaidTool(agent, ledger, "racing", 1, { maxStake: 2 }, gone.signal);
  const r2 = await playPaidTool(agent, ledger, "racing", 1, { maxStake: 2 });
  assert.equal(r2.resumed, true);
  assert.equal(r2.matchId, r1.matchId);
  assert.equal(fake.matchmakes.length, 2, "la segunda llamada no empareja");
});

test("play_and_submit y matchmake con stake > 0 siguen rechazando", async () => {
  const { agent, fake } = await setup();
  await assert.rejects(playAndSubmitTool(agent, "racing", 1), /play_paid/);
  await assert.rejects(matchmakeTool(agent, "racing", 1), /play_paid/);
  assert.equal(fake.matchmakes.length, 0);
});

test("resume_paid, withdraw_1v1 y mint_test_usdc fallan cerrado sin configuración", async () => {
  const { agent } = await setup();
  await assert.rejects(resumePaidTool(agent, "0x01", undefined), /paid 1v1 tables are off/);
  await assert.rejects(withdraw1v1Tool(agent, undefined), /paid 1v1 tables are off/);
  await assert.rejects(mintTestUsdcTool(agent, 5, undefined), /paid 1v1 tables are off/);
});

test("withdraw_1v1 y mint_test_usdc devuelven montos como texto", async () => {
  const { agent } = await setup();
  assert.deepEqual(await withdraw1v1Tool(agent, { maxStake: 2 }), { amount: "0" });
  const m = await mintTestUsdcTool(agent, 5, { maxStake: 2 });
  assert.equal(m.amount, "5000000");
  assert.ok(m.txHash);
});
