// Prueba de PAGO de punta a punta en cadena local (anvil):
// depósito real de USDC -> el árbitro firma -> el contrato paga al ganador + comisión.
// Usa las direcciones que pasa el script (USDC_ADDR, ESCROW_ADDR).

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
import { signResult } from "./sign.js";

const RPC = "http://localhost:8545";
const USDC = process.env.USDC_ADDR as Hex;
const ESCROW = process.env.ESCROW_ADDR as Hex;

// Claves conocidas de anvil.
const KEYS = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  p1: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  p2: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  platform: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const;

const erc20Abi = [
  { type: "function", name: "mint", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const satisfies Abi;

const escrowAbi = [
  { type: "function", name: "setAllowedStake", inputs: [{ type: "uint256" }, { type: "bool" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "createMatch", inputs: [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint64" }, { type: "uint64" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "deposit", inputs: [{ type: "bytes32" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "settle", inputs: [{ type: "bytes32" }, { type: "address" }, { type: "bytes" }], outputs: [], stateMutability: "nonpayable" },
] as const satisfies Abi;

const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = (key: string) =>
  createWalletClient({ account: privateKeyToAccount(key as Hex), chain: foundry, transport: http(RPC) });

const owner = wallet(KEYS.owner);
const p1 = wallet(KEYS.p1);
const p2 = wallet(KEYS.p2);
const arbiter = wallet(process.env.ARBITER_PRIVATE_KEY as Hex);

const P1 = p1.account.address;
const P2 = p2.account.address;
const PLATFORM = privateKeyToAccount(KEYS.platform as Hex).address;

async function send(w: ReturnType<typeof wallet>, address: Hex, abi: Abi, functionName: string, args: unknown[]) {
  const hash = await w.writeContract({ address, abi, functionName, args } as never);
  await pub.waitForTransactionReceipt({ hash });
}

async function bal(addr: Hex): Promise<bigint> {
  return pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr] }) as Promise<bigint>;
}

async function main() {
  const stake = 5_000_000n; // 5 USDC (6 decimales)
  const matchId = ("0x" + "ab".repeat(32)) as Hex;
  const now = BigInt(Math.floor(Date.now() / 1000));

  // Preparacion: habilitar la mesa, dar gas al arbitro, repartir USDC.
  await send(owner, ESCROW, escrowAbi, "setAllowedStake", [stake, true]);
  await owner.sendTransaction({ to: arbiter.account.address, value: parseEther("1") });
  await send(owner, USDC, erc20Abi, "mint", [P1, stake]);
  await send(owner, USDC, erc20Abi, "mint", [P2, stake]);

  // 1) Cada jugador aprueba y deposita su USDC.
  await send(p1, USDC, erc20Abi, "approve", [ESCROW, stake]);
  await send(p2, USDC, erc20Abi, "approve", [ESCROW, stake]);

  // 2) El arbitro crea la partida en el contrato.
  await send(arbiter, ESCROW, escrowAbi, "createMatch", [matchId, P1, P2, stake, now + 3600n, now + 7200n]);

  // 3) Los dos depositan.
  await send(p1, ESCROW, escrowAbi, "deposit", [matchId]);
  await send(p2, ESCROW, escrowAbi, "deposit", [matchId]);
  console.log("✓ los dos depositaron · escrow tiene", (await bal(ESCROW)) / 1_000_000n, "USDC");

  // 4) El arbitro firma el resultado (gana P1) y se liquida.
  const signature = await signResult(matchId, P1);
  await send(owner, ESCROW, escrowAbi, "settle", [matchId, P1, signature]);

  // 5) Verificacion de balances.
  const winner = await bal(P1);
  const platform = await bal(PLATFORM);
  const escrowLeft = await bal(ESCROW);
  console.log("✓ ganador (P1) cobró:", Number(winner) / 1e6, "USDC (esperado 8.5)");
  console.log("✓ plataforma (comisión 15%):", Number(platform) / 1e6, "USDC (esperado 1.5)");
  console.log("✓ escrow quedó en:", Number(escrowLeft) / 1e6, "USDC (esperado 0)");

  const okPay = winner === 8_500_000n && platform === 1_500_000n && escrowLeft === 0n;
  if (!okPay) {
    console.log("\n❌ Los balances no cuadran");
    process.exit(1);
  }
  console.log("\nPAGO ON-CHAIN VERIFICADO ✅");
}

main().catch((e) => {
  console.error("Error:", e.shortMessage || e.message);
  process.exit(1);
});
