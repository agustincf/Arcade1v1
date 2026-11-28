// E2E: AGENTES DEL SDK JUGANDO MESAS 1v1 DE PLATA contra anvil, sin una
// persona. Cada agente es un `createAgent({ privateKey, paid1v1 })` que hace
// todo solo con `playAndSubmit({ game: "racing", stake: 1 })`: revisa, se
// sienta, aprueba, deposita (open o join), juega en vivo, y el árbitro paga o
// reembolsa. El árbitro es el de verdad (matchRouter + liveRouter + /health),
// servido por HTTP en un puerto efímero, contra un Escrow1v1 y un USDC con
// blacklist desplegados en un anvil propio. Lo lanza
// packages/contracts/check-payment-sdk-e2e.sh (CI, trabajo "Contrato").
//
// Escenarios:
//  1. gana uno y cobra: el ganador termina con +0,70 USDC (pozo 2, comisión 15 %);
//  2. empate y reembolso: los dos juegan igual y recuperan su stake;
//  3. un ganador en la blacklist del USDC: su premio queda acreditado en el
//     escrow y lo cobra con `withdraw1v1()` cuando sale de la lista.
// Además imprime el gas de approve, open y join (el margen de ETH del SDK).
import express from "express";
import type { AddressInfo } from "node:net";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { erc20MinimalAbi, escrow1v1Abi } from "@arcade1v1/game-sdk/escrow1v1";
import { createAgent, type LiveStrategy } from "@arcade1v1/agent-sdk";
import { escrowAbi } from "./abi.js";
import { matchRouter } from "./match-routes.js";
import { liveRouter } from "./live-routes.js";
import { healthBody } from "./health.js";
import { verifyEscrow, escrowGate } from "./escrow-check.js";
import { escrowExpect } from "./matchmaking.js";

const RPC = process.env.RPC_URL || "http://localhost:8545";
const USDC = process.env.USDC_ADDR as Hex;
const ESCROW = process.env.ESCROW_ADDRESS as Hex;
const STAKE = 1_000_000n; // 1 USDC
const PRIZE = 1_700_000n; // pozo de 2 USDC menos el 15 %

// Cuentas estándar de anvil (públicas, sin valor). La #0 es la dueña del
// contrato, la #3 la plataforma y la #9 el árbitro (check-payment-sdk-e2e.sh):
// los agentes son la #1, #2, #4, #5, #6 y #7.
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const AGENT_KEYS = [
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
] as const;

const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const owner = createWalletClient({
  account: privateKeyToAccount(OWNER_KEY as Hex),
  chain: foundry,
  transport: http(RPC),
});

async function send(address: Hex, abi: unknown, fn: string, args: unknown[]) {
  const hash = await owner.writeContract({
    address,
    abi,
    functionName: fn,
    args,
    account: owner.account,
    chain: foundry,
  } as never);
  await pub.waitForTransactionReceipt({ hash });
}
const bal = (a: Hex) =>
  pub.readContract({ address: USDC, abi: erc20MinimalAbi, functionName: "balanceOf", args: [a] });
const owed = (a: Hex) =>
  pub.readContract({ address: ESCROW, abi: escrow1v1Abi, functionName: "owed", args: [a] });
const blacklistAbi = [
  {
    type: "function",
    name: "blacklist",
    inputs: [
      { name: "account", type: "address" },
      { name: "on", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// El árbitro de verdad, con sus rutas reales.
const pass: express.RequestHandler = (_req, _res, next) => next();
const app = express();
app.use(express.json());
app.get("/health", (_req, res) => res.json(healthBody()));
app.use(matchRouter({ score: pass }));
app.use(liveRouter({ start: pass, commit: pass }));
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const agents = AGENT_KEYS.map((pk) =>
  createAgent({
    arbiterUrl: BASE,
    privateKey: pk as Hex,
    paid1v1: { rpcUrl: RPC, escrow: ESCROW, chainId: 31337, maxStake: 2 },
  }),
);

/** Una estrategia que nunca se mueve: choca con el primer obstáculo de su carril. */
const neverMoves: LiveStrategy = { decide: () => null, maxTicks: 6_000 };

function check(ok: boolean, what: string): void {
  if (!ok) {
    console.error(`❌ ${what}`);
    process.exit(1);
  }
  console.log(`✓ ${what}`);
}

async function waitFor<T>(
  fn: () => Promise<T | undefined>,
  what: string,
  ms = 120_000,
): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() - t0 > ms) {
      console.error(`❌ se agotó la espera: ${what}`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const gas: Record<string, bigint[]> = { approve: [], open: [], join: [] };
async function noteGas(d?: { step: string; txHash?: Hex; approveTx?: Hex }) {
  if (!d) return;
  if (d.approveTx)
    gas.approve.push((await pub.getTransactionReceipt({ hash: d.approveTx })).gasUsed);
  if (d.txHash && (d.step === "open" || d.step === "join")) {
    gas[d.step].push((await pub.getTransactionReceipt({ hash: d.txHash })).gasUsed);
  }
}

async function scenarioWin() {
  console.log("\n— Escenario 1: gana uno y cobra —");
  const [a, b] = [agents[0], agents[1]];
  const a0 = await bal(a.address);
  const ra = await a.playAndSubmit({ game: "racing", stake: 1 });
  await noteGas(ra.deposit);
  check(ra.deposit?.step === "open" && ra.waitingForRival === true, "A abrió, jugó y espera rival");
  const rb = await b.playAndSubmit({ game: "racing", stake: 1, liveStrategy: neverMoves });
  await noteGas(rb.deposit);
  check(rb.deposit?.step === "join" && rb.matchId === ra.matchId, "B se unió a la partida de A");
  const v = await waitFor(async () => {
    const x = await a.getResult(ra.matchId);
    return x.settleTx ? x : undefined;
  }, "el árbitro paga");
  check(v.winner?.toLowerCase() === a.address.toLowerCase(), "ganó A");
  check((await bal(a.address)) === a0 - STAKE + PRIZE, "A cobró el pozo menos la comisión");
}

async function scenarioDraw() {
  console.log("\n— Escenario 2: empate y reembolso —");
  const [a, b] = [agents[2], agents[3]];
  const [a0, b0] = [await bal(a.address), await bal(b.address)];
  const ra = await a.playAndSubmit({ game: "racing", stake: 1 });
  await noteGas(ra.deposit);
  const rb = await b.playAndSubmit({ game: "racing", stake: 1 });
  await noteGas(rb.deposit);
  check(rb.matchId === ra.matchId, "los dos en la misma partida");
  const v = await waitFor(async () => {
    const x = await a.getResult(ra.matchId);
    return x.refund === "done" ? x : undefined;
  }, "el árbitro reembolsa el empate");
  check(v.outcome === "draw", "empate");
  check(
    (await bal(a.address)) === a0 && (await bal(b.address)) === b0,
    "los dos recuperaron su stake",
  );
}

async function scenarioBlacklisted() {
  console.log("\n— Escenario 3: el ganador está en la blacklist y cobra después —");
  const [a, b] = [agents[4], agents[5]];
  const ra = await a.playAndSubmit({ game: "racing", stake: 1 });
  await noteGas(ra.deposit);
  await send(USDC, blacklistAbi, "blacklist", [a.address, true]);
  const rb = await b.playAndSubmit({ game: "racing", stake: 1, liveStrategy: neverMoves });
  await noteGas(rb.deposit);
  await waitFor(async () => {
    const x = await a.getResult(ra.matchId);
    return x.settleTx ? x : undefined;
  }, "el árbitro liquida");
  check((await owed(a.address)) === PRIZE, "el premio quedó acreditado en el escrow");
  await send(USDC, blacklistAbi, "blacklist", [a.address, false]);
  const before = await bal(a.address);
  const w = await a.withdraw1v1();
  check(w.amount === PRIZE && !!w.txHash, "withdraw1v1 cobra lo acreditado");
  check(
    (await bal(a.address)) === before + PRIZE && (await owed(a.address)) === 0n,
    "la plata llegó",
  );
}

async function main() {
  for (const s of [1, 2, 5, 10]) {
    await send(ESCROW, escrowAbi, "setAllowedStake", [BigInt(s * 1_000_000), true]);
  }
  await verifyEscrow(escrowExpect());
  check(escrowGate().status === "ok", "las mesas de plata del árbitro están abiertas");
  for (const a of agents) await send(USDC, erc20MinimalAbi, "mint", [a.address, 10n * STAKE]);

  await scenarioWin();
  await scenarioDraw();
  await scenarioBlacklisted();

  const fmt = (xs: bigint[]) => (xs.length ? xs.map(String).join(", ") : "—");
  console.log(
    `\nGas medido: approve ${fmt(gas.approve)} · open ${fmt(gas.open)} · join ${fmt(gas.join)}`,
  );
  console.log("\nAGENTES EN MESAS 1v1 DE PLATA VERIFICADOS ✅");
  server.closeAllConnections();
  server.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
