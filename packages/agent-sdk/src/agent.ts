// Helpers de alto nivel: crear un agente y "jugá y enviá" en una sola llamada.
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { ArbiterClient, type MatchView } from "./client.js";
import { randomWallet, signScore } from "./sign.js";
import { DEFAULT_STRATEGIES, type Strategy } from "./strategies.js";

export function createAgent(opts: {
  arbiterUrl?: string;
  privateKey?: Hex;
  client?: ArbiterClient;
}): {
  address: Hex;
  client: ArbiterClient;
  playAndSubmit(args: { game: string; stake: number; strategy?: Strategy }): Promise<MatchView>;
} {
  const wallet = opts.privateKey
    ? { privateKey: opts.privateKey, address: privateKeyToAccount(opts.privateKey).address }
    : randomWallet();
  const client = opts.client ?? new ArbiterClient(opts.arbiterUrl ?? "http://localhost:4000");

  async function playAndSubmit(args: { game: string; stake: number; strategy?: Strategy }): Promise<MatchView> {
    const m = await client.matchmake(args.game, args.stake, wallet.address);
    const strat = args.strategy ?? DEFAULT_STRATEGIES[args.game];
    if (!strat) throw new Error(`no hay estrategia por defecto para el juego: ${args.game}`);
    const { score, replay } = strat(m.seed);
    const signature = await signScore({ matchId: m.matchId, address: wallet.address, score, privateKey: wallet.privateKey });
    return client.submitScore(m.matchId, wallet.address, score, replay, signature);
  }

  return { address: wallet.address, client, playAndSubmit };
}
