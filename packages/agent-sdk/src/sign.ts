// Wallet efímera + firmas de autenticación (emparejar y enviar puntaje). En
// Fase 1 la wallet SOLO firma mensajes (auth); no tiene fondos ni hace
// transacciones on-chain.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  scoreAuthMessage,
  matchmakeAuthMessage,
  vaultActionAuthMessage,
  vaultViewAuthMessage,
} from "@arcade1v1/game-sdk/auth";
import { actionLine, type Phase, type VaultAction } from "@arcade1v1/game-sdk/vault";

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

/** Firma UNA acción en una sala de Aleph. La firma ata sala + etapa + fase
 *  + la línea canónica de la acción (`actionLine`, la misma función que usa el
 *  árbitro) + ts; el árbitro rechaza el mismo cuerpo firmado dos veces. */
export async function signVaultAction(opts: {
  roomId: string;
  stage: number;
  phase: Phase;
  action: VaultAction;
  privateKey: Hex;
  ts?: number;
}): Promise<{ signature: Hex; ts: number }> {
  const ts = opts.ts ?? Date.now();
  const account = privateKeyToAccount(opts.privateKey);
  const signature = await account.signMessage({
    message: vaultActionAuthMessage(
      opts.roomId,
      opts.stage,
      opts.phase,
      actionLine(opts.action),
      ts,
    ),
  });
  return { signature, ts };
}

/** Firma el PASE DE VISTA: habilita la vista privada del propio asiento (tu
 *  fragmento, tus susurros, si ya decidiste). Vale 10 minutos y se puede
 *  reutilizar mientras se sondea la sala. */
export async function signVaultView(opts: {
  roomId: string;
  address: string;
  privateKey: Hex;
  ts?: number;
}): Promise<{ signature: Hex; ts: number }> {
  const ts = opts.ts ?? Date.now();
  const account = privateKeyToAccount(opts.privateKey);
  const signature = await account.signMessage({
    message: vaultViewAuthMessage(opts.roomId, opts.address, ts),
  });
  return { signature, ts };
}
