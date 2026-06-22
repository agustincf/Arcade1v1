// Acciones on-chain del arbitro (crear la partida en el contrato escrow).
// Se activa solo si ESCROW_ADDRESS esta configurado; si no, es no-op (dev).

import {
  createWalletClient,
  createPublicClient,
  http,
  type Hex,
  type Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, baseSepolia } from "viem/chains";

const RPC = process.env.RPC_URL || "http://localhost:8545";
const ESCROW = (process.env.ESCROW_ADDRESS || "") as Hex;
const ZERO = "0x0000000000000000000000000000000000000000";

export function onchainEnabled(): boolean {
  return !!ESCROW && ESCROW.toLowerCase() !== ZERO;
}

function chain() {
  return Number(process.env.CHAIN_ID ?? 84532) === 31337 ? foundry : baseSepolia;
}

const escrowAbi = [
  {
    type: "function",
    name: "createMatch",
    inputs: [
      { type: "bytes32" },
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint64" },
      { type: "uint64" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelMatch",
    inputs: [{ type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const satisfies Abi;

let wallet: ReturnType<typeof createWalletClient> | null = null;
let pub: ReturnType<typeof createPublicClient> | null = null;

function clients() {
  if (!wallet) {
    const account = privateKeyToAccount(process.env.ARBITER_PRIVATE_KEY as Hex);
    wallet = createWalletClient({ account, chain: chain(), transport: http(RPC) });
    pub = createPublicClient({ chain: chain(), transport: http(RPC) });
  }
  return { wallet: wallet!, pub: pub! };
}

/** El arbitro crea la partida en el contrato (necesario antes de los depositos). */
export async function createMatchOnchain(
  matchId: Hex,
  p1: Hex,
  p2: Hex,
  stakeUnits: bigint,
  fundDeadline: bigint,
  playDeadline: bigint,
) {
  if (!onchainEnabled()) return;
  const { wallet: w, pub: p } = clients();
  const hash = await w.writeContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "createMatch",
    args: [matchId, p1, p2, stakeUnits, fundDeadline, playDeadline],
    account: w.account!,
    chain: chain(),
  });
  await p.waitForTransactionReceipt({ hash });
}

/** En empate/disputa: el arbitro cancela y el contrato reembolsa a ambos. */
export async function cancelMatchOnchain(matchId: Hex) {
  if (!onchainEnabled()) return;
  const { wallet: w, pub: p } = clients();
  const hash = await w.writeContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "cancelMatch",
    args: [matchId],
    account: w.account!,
    chain: chain(),
  });
  await p.waitForTransactionReceipt({ hash });
}
