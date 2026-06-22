// Prueba de PAGO de punta a punta en cadena local (anvil) usando el BACKEND real:
// emparejar (crea la partida on-chain) -> depositar USDC -> jugar + el arbitro
// firma -> el ganador cobra del contrato. Verifica premio + comision.

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Hex,
  type Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { matchmake, submitScore, onchainReady, onchainSettled } from "./matchmaking.js";
import { Game2048, type Dir } from "@arcade1v1/game-sdk/g2048";

const RPC = process.env.RPC_URL || "http://localhost:8545";
const USDC = process.env.USDC_ADDR as Hex;
const ESCROW = process.env.ESCROW_ADDRESS as Hex;

const KEYS = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  p1: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  p2: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
} as const;
const PLATFORM = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Hex;

const erc20Abi = [
  { type: "function", name: "mint", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const satisfies Abi;

const escrowAbi = [
  { type: "function", name: "setAllowedStake", inputs: [{ type: "uint256" }, { type: "bool" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "deposit", inputs: [{ type: "bytes32" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "settle", inputs: [{ type: "bytes32" }, { type: "address" }, { type: "bytes" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "matches", inputs: [{ type: "bytes32" }], outputs: [
    { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "bool" },
    { type: "bool" }, { type: "uint64" }, { type: "uint64" }, { type: "uint8" },
  ], stateMutability: "view" },
] as const satisfies Abi;

const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const w = (k: string) => createWalletClient({ account: privateKeyToAccount(k as Hex), chain: foundry, transport: http(RPC) });
const owner = w(KEYS.owner);
const p1 = w(KEYS.p1);
const p2 = w(KEYS.p2);
const P1 = p1.account.address;
const P2 = p2.account.address;

async function send(c: ReturnType<typeof w>, address: Hex, abi: Abi, fn: string, args: unknown[]) {
  const hash = await c.writeContract({ address, abi, functionName: fn, args, account: c.account, chain: foundry } as never);
  await pub.waitForTransactionReceipt({ hash });
}
const bal = (a: Hex) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;

function play2048(seed: number, maxMoves: number) {
  const g = new Game2048(seed);
  const moves: Dir[] = [];
  const dirs: Dir[] = ["left", "up", "right", "down"];
  let i = 0;
  while (!g.over && moves.length < maxMoves && i < 4000) {
    if (g.move(dirs[i % 4])) moves.push(dirs[i % 4]);
    i++;
  }
  return { score: g.score, replay: { seed, moves } };
}

/** Dos jugadores SIN fondos/allowance se emparejan: el arbitro NO debe crear la
 *  partida on-chain (asi un bot no le drena el gas). */
async function noFundsScenario() {
  const X = "0x1111111111111111111111111111111111111111" as Hex;
  const Y = "0x2222222222222222222222222222222222222222" as Hex;
  const mx = await matchmake("2048", 1, X);
  await matchmake("2048", 1, Y); // intenta emparejar, pero sin fondos
  await onchainReady(mx.matchId);
  const st = (await pub.readContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "matches",
    args: [mx.matchId as Hex],
  })) as unknown[];
  const created = Number(st[7]) !== 0; // status != None
  console.log("✓ sin fondos: el arbitro NO creó la partida (gas a salvo):", !created);
  if (created) {
    console.log("\n❌ Se creó una partida sin fondos (vulnerabilidad)");
    process.exit(1);
  }
}

async function main() {
  const stake = 5_000_000n;
  // Preparacion: mesa habilitada, gas para el arbitro, USDC para los jugadores.
  await send(owner, ESCROW, escrowAbi, "setAllowedStake", [stake, true]);
  await owner.sendTransaction({
    to: privateKeyToAccount(process.env.ARBITER_PRIVATE_KEY as Hex).address,
    value: parseEther("1"),
    chain: foundry,
  });
  await send(owner, USDC, erc20Abi, "mint", [P1, stake]);
  await send(owner, USDC, erc20Abi, "mint", [P2, stake]);

  // 0) Anti-drenaje: sin fondos/allowance, el arbitro NO crea la partida (no gasta gas).
  await noFundsScenario();

  // approve ANTES de emparejar (el backend chequea allowance al emparejar).
  await send(p1, USDC, erc20Abi, "approve", [ESCROW, stake]);
  await send(p2, USDC, erc20Abi, "approve", [ESCROW, stake]);

  // 1) Emparejamiento: con fondos+allowance ok, el arbitro crea la partida on-chain.
  const m1 = await matchmake("2048", 5, P1);
  const m2 = await matchmake("2048", 5, P2);
  await onchainReady(m2.matchId);
  console.log("✓ partida creada on-chain por el arbitro:", m1.matchId === m2.matchId);

  // 2) Los dos depositan.
  await send(p1, ESCROW, escrowAbi, "deposit", [m1.matchId as Hex]);
  await send(p2, ESCROW, escrowAbi, "deposit", [m2.matchId as Hex]);
  console.log("✓ los dos depositaron · escrow:", Number(await bal(ESCROW)) / 1e6, "USDC");

  // 3) Juegan y el arbitro decide + firma (P1 gana).
  const sA = play2048(m1.seed, 500);
  await submitScore(m1.matchId, P1, sA.score, sA.replay);
  const sB = play2048(m2.seed, 12);
  const res = await submitScore(m2.matchId, P2, sB.score, sB.replay);
  console.log("✓ ganador:", res.winner === P1 ? "P1" : "P2", "· firma:", !!res.signature);

  // 4) El ganador cobra del contrato con la firma del arbitro.
  await send(owner, ESCROW, escrowAbi, "settle", [res.matchId as Hex, res.winner as Hex, res.signature as Hex]);

  // 5) Verificacion.
  const winner = await bal(P1);
  const platform = await bal(PLATFORM);
  const left = await bal(ESCROW);
  console.log("✓ ganador cobró:", Number(winner) / 1e6, "USDC (esperado 8.5)");
  console.log("✓ plataforma (15%):", Number(platform) / 1e6, "USDC (esperado 1.5)");
  console.log("✓ escrow:", Number(left) / 1e6, "USDC (esperado 0)");

  if (winner !== 8_500_000n || platform !== 1_500_000n || left !== 0n) {
    console.log("\n❌ Balances no cuadran");
    process.exit(1);
  }
  console.log("\nCICLO COMPLETO ON-CHAIN (con el backend) VERIFICADO ✅");

  await drawScenario();
}

/** Empate: los dos juegan IGUAL -> el arbitro cancela on-chain y se reembolsa. */
async function drawScenario() {
  console.log("\n--- Empate (reembolso on-chain) ---");
  const stake = 10_000_000n;
  await send(owner, ESCROW, escrowAbi, "setAllowedStake", [stake, true]);
  await send(owner, USDC, erc20Abi, "mint", [P1, stake]);
  await send(owner, USDC, erc20Abi, "mint", [P2, stake]);
  // approve ANTES de emparejar (allowance ya gastado en el escenario anterior).
  await send(p1, USDC, erc20Abi, "approve", [ESCROW, stake]);
  await send(p2, USDC, erc20Abi, "approve", [ESCROW, stake]);
  const b1 = await bal(P1);
  const b2 = await bal(P2);
  const bE = await bal(ESCROW);
  const bP = await bal(PLATFORM);

  const m1 = await matchmake("2048", 10, P1);
  const m2 = await matchmake("2048", 10, P2);
  await onchainReady(m2.matchId);

  await send(p1, ESCROW, escrowAbi, "deposit", [m1.matchId as Hex]);
  await send(p2, ESCROW, escrowAbi, "deposit", [m2.matchId as Hex]);

  const a = play2048(m1.seed, 80);
  await submitScore(m1.matchId, P1, a.score, a.replay);
  const b = play2048(m2.seed, 80);
  const res = await submitScore(m2.matchId, P2, b.score, b.replay);
  console.log("✓ empate detectado:", res.outcome === "draw");
  await onchainSettled(m2.matchId);

  const ok =
    (await bal(P1)) === b1 &&
    (await bal(P2)) === b2 &&
    (await bal(ESCROW)) === bE &&
    (await bal(PLATFORM)) === bP;
  console.log("✓ los dos reembolsados (balances vuelven al inicio):", ok);
  if (!ok) {
    console.log("\n❌ Empate: balances no cuadran");
    process.exit(1);
  }
  console.log("\nREEMBOLSO ON-CHAIN EN EMPATE VERIFICADO ✅");
}

main().catch((e) => {
  console.error("Error:", e.shortMessage || e.message);
  process.exit(1);
});
