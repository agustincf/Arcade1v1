// Wallet efímera + firma del envío de puntaje. En Fase 1 la wallet SOLO firma
// el mensaje del score (auth); no tiene fondos ni hace transacciones on-chain.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { scoreAuthMessage } from "@arcade1v1/game-sdk/auth";

export function randomWallet(): { privateKey: Hex; address: Hex } {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  return { privateKey, address };
}

export async function signScore(opts: {
  matchId: string;
  address: string;
  score: number;
  privateKey: Hex;
}): Promise<Hex> {
  const account = privateKeyToAccount(opts.privateKey);
  return account.signMessage({
    message: scoreAuthMessage(opts.matchId, opts.address, opts.score),
  });
}
