// Acciones on-chain del arbitro. En el modelo asincronico (open/join), cada
// jugador abre/se une depositando su propia apuesta, asi que el arbitro NO crea
// la partida ni paga gas: SOLO cancela en empate (reembolso). Se activa si
// ESCROW_ADDRESS esta configurado; si no, es no-op (dev).

import { createWalletClient, createPublicClient, http, type Hex, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, base, baseSepolia } from "viem/chains";
import { escrowAbi } from "./abi.js";

const RPC = process.env.RPC_URL || "http://localhost:8545";
const ESCROW = (process.env.ESCROW_ADDRESS || "") as Hex;
const ZERO = "0x0000000000000000000000000000000000000000";

export function onchainEnabled(): boolean {
  return !!ESCROW && ESCROW.toLowerCase() !== ZERO;
}

/** Red segun CHAIN_ID: 31337 anvil, 8453 Base mainnet, si no Base Sepolia. */
function chain(): Chain {
  const id = Number(process.env.CHAIN_ID ?? 84532);
  if (id === 31337) return foundry;
  if (id === 8453) return base;
  return baseSepolia;
}

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
