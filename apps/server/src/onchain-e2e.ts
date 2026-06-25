// Prueba de PAGO de punta a punta en cadena local (anvil) del modelo ASINCRONICO
// (open/join) usando el BACKEND real: emparejar -> P1 ABRE (deposita) -> P2 se
// UNE (deposita) -> juegan + el arbitro firma -> el ganador cobra. Verifica
// premio + comision, y el reembolso en empate.

import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseEther, type Hex, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { matchmake, submitScore, onchainSettled } from "./matchmaking.js";
import { Game2048, type Dir } from "@arcade1v1/game-sdk/g2048";
import { escrowAbi, erc20Abi } from "./abi.js";

const RPC = process.env.RPC_URL || "http://localhost:8545";
const USDC = process.env.USDC_ADDR as Hex;
const ESCROW = process.env.ESCROW_ADDRESS as Hex;

const KEYS = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  p1: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  p2: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
} as const;
const PLATFORM = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Hex;

const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const w = (k: string) =>
  createWalletClient({
    account: privateKeyToAccount(k as Hex),
    chain: foundry,
    transport: http(RPC),
  });
const owner = w(KEYS.owner);
const p1 = w(KEYS.p1);
const p2 = w(KEYS.p2);
const P1 = p1.account.address;
const P2 = p2.account.address;

async function send(c: ReturnType<typeof w>, address: Hex, abi: Abi, fn: string, args: unknown[]) {
  const hash = await c.writeContract({
    address,
    abi,
    functionName: fn,
    args,
    account: c.account,
    chain: foundry,
  } as never);
  await pub.waitForTransactionReceipt({ hash });
}
const bal = (a: Hex) =>
  pub.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [a],
  }) as Promise<bigint>;
const usd = (x: bigint) => (Number(x) / 1e6).toFixed(2);
const deadlines = () => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return [now + 3600n, now + 7200n] as const;
};

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

async function main() {
  const stake = 5_000_000n;
  // Preparacion: mesa habilitada, gas para el arbitro (cancela en empate), USDC.
  await send(owner, ESCROW, escrowAbi, "setAllowedStake", [stake, true]);
  await owner.sendTransaction({
    to: privateKeyToAccount(process.env.ARBITER_PRIVATE_KEY as Hex).address,
    value: parseEther("1"),
    chain: foundry,
  });
  await send(owner, USDC, erc20Abi, "mint", [P1, stake]);
  await send(owner, USDC, erc20Abi, "mint", [P2, stake]);
  await send(p1, USDC, erc20Abi, "approve", [ESCROW, stake]);
  await send(p2, USDC, erc20Abi, "approve", [ESCROW, stake]);

  // 1) Emparejamiento (backend): A es p1, B es p2 (mismo matchId).
  const m1 = await matchmake("2048", 5, P1);
  const m2 = await matchmake("2048", 5, P2);
  console.log("✓ emparejados:", m1.matchId === m2.matchId);

  // 2) P1 ABRE (deposita), P2 se UNE (deposita). El arbitro no toca nada.
  const [fund, play] = deadlines();
  await send(p1, ESCROW, escrowAbi, "open", [m1.matchId as Hex, stake, fund, play]);
  await send(p2, ESCROW, escrowAbi, "join", [m2.matchId as Hex]);
  console.log("✓ P1 abrió + P2 se unió · escrow:", usd(await bal(ESCROW)), "USDC");

  // 3) Juegan y el arbitro decide + firma (P1 gana).
  const sA = play2048(m1.seed, 500);
  await submitScore(m1.matchId, P1, sA.score, sA.replay);
  const sB = play2048(m2.seed, 12);
  const res = await submitScore(m2.matchId, P2, sB.score, sB.replay);
  console.log("✓ ganador:", res.winner === P1 ? "P1" : "P2", "· firma:", !!res.signature);

  // 4) El ganador cobra (cualquiera puede llamar settle con la firma).
  await send(owner, ESCROW, escrowAbi, "settle", [
    res.matchId as Hex,
    res.winner as Hex,
    res.signature as Hex,
  ]);

  console.log("✓ ganador cobró:", usd(await bal(P1)), "USDC (esperado 8.50)");
  console.log("✓ plataforma (15%):", usd(await bal(PLATFORM)), "USDC (esperado 1.50)");
  console.log("✓ escrow:", usd(await bal(ESCROW)), "USDC (esperado 0.00)");
  if (
    (await bal(P1)) !== 8_500_000n ||
    (await bal(PLATFORM)) !== 1_500_000n ||
    (await bal(ESCROW)) !== 0n
  ) {
    console.log("\n❌ Balances no cuadran");
    process.exit(1);
  }
  console.log("\nCICLO ASINCRONICO (open/join, con el backend) VERIFICADO ✅");

  await drawScenario();
}

/** Empate: los dos juegan IGUAL -> el arbitro cancela on-chain y se reembolsa. */
async function drawScenario() {
  console.log("\n--- Empate (reembolso on-chain) ---");
  const stake = 10_000_000n;
  await send(owner, ESCROW, escrowAbi, "setAllowedStake", [stake, true]);
  await send(owner, USDC, erc20Abi, "mint", [P1, stake]);
  await send(owner, USDC, erc20Abi, "mint", [P2, stake]);
  await send(p1, USDC, erc20Abi, "approve", [ESCROW, stake]);
  await send(p2, USDC, erc20Abi, "approve", [ESCROW, stake]);
  const b1 = await bal(P1);
  const b2 = await bal(P2);
  const bE = await bal(ESCROW);
  const bP = await bal(PLATFORM);

  const m1 = await matchmake("2048", 10, P1);
  const m2 = await matchmake("2048", 10, P2);
  const [fund, play] = deadlines();
  await send(p1, ESCROW, escrowAbi, "open", [m1.matchId as Hex, stake, fund, play]);
  await send(p2, ESCROW, escrowAbi, "join", [m2.matchId as Hex]);

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
  console.error("Error:", (e as { shortMessage?: string }).shortMessage || (e as Error).message);
  process.exit(1);
});
