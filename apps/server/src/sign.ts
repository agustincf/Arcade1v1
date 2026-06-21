// Firma de resultados con la llave del arbitro (EIP-712).
// El formato coincide EXACTAMENTE con el contrato Escrow1v1, asi la firma
// que produce el backend la puede verificar el contrato al pagar.

import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export const RESULT_TYPES = {
  Result: [
    { name: "matchId", type: "bytes32" },
    { name: "winner", type: "address" },
  ],
} as const;

export function arbiterAccount() {
  const pk = process.env.ARBITER_PRIVATE_KEY as Hex;
  if (!pk || !pk.startsWith("0x")) {
    throw new Error("Falta ARBITER_PRIVATE_KEY en el .env");
  }
  return privateKeyToAccount(pk);
}

export function arbiterAddress(): Hex {
  return arbiterAccount().address;
}

export function resultDomain() {
  return {
    name: "Arcade1v1Escrow",
    version: "1",
    chainId: Number(process.env.CHAIN_ID ?? 84532),
    verifyingContract: (process.env.ESCROW_ADDRESS ??
      "0x0000000000000000000000000000000000000000") as Hex,
  };
}

/** Firma (matchId, winner). El ganador presenta esta firma al contrato.
 *  La direccion se normaliza a minusculas (mismo valor de 20 bytes, evita
 *  el chequeo de checksum de viem; el contrato la compara por valor). */
export async function signResult(matchId: Hex, winner: Hex): Promise<Hex> {
  const account = arbiterAccount();
  return account.signTypedData({
    domain: resultDomain(),
    types: RESULT_TYPES,
    primaryType: "Result",
    message: { matchId, winner: winner.toLowerCase() as Hex },
  });
}
