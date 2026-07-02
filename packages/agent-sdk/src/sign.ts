// Wallet efímera + firmas de autenticación (emparejar y enviar puntaje). En
// Fase 1 la wallet SOLO firma mensajes (auth); no tiene fondos ni hace
// transacciones on-chain.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { scoreAuthMessage, matchmakeAuthMessage } from "@arcade1v1/game-sdk/auth";

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

/** Firma "quiero emparejar" (obligatoria en producción). Devuelve también el
 *  `ts` usado: el árbitro lo exige para validar la ventana anti-replay. */
export async function signMatchmake(opts: {
  game: string;
  stake: number;
  address: string;
  privateKey: Hex;
  ts?: number;
}): Promise<{ signature: Hex; ts: number }> {
  const ts = opts.ts ?? Date.now();
  const account = privateKeyToAccount(opts.privateKey);
  const signature = await account.signMessage({
    message: matchmakeAuthMessage(opts.game, opts.stake, opts.address, ts),
  });
  return { signature, ts };
}
