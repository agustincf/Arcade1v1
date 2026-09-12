// Firma de resultados con la llave del arbitro (EIP-712).
// El formato coincide EXACTAMENTE con el contrato Escrow1v1, asi la firma
// que produce el backend la puede verificar el contrato al pagar.

import { privateKeyToAccount } from "viem/accounts";
import { keccak256, encodeAbiParameters, type Hex } from "viem";

export const RESULT_TYPES = {
  Result: [
    { name: "matchId", type: "bytes32" },
    { name: "winner", type: "address" },
  ],
} as const;

export const SEAT_TYPES = {
  Seat: [
    { name: "matchId", type: "bytes32" },
    { name: "player", type: "address" },
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

/** Firma el "asiento" (matchId, player): autoriza a `player` a depositar en esa
 *  partida (open/join). Ata al rival on-chain SIN que el árbitro pague gas —
 *  cada jugador presenta su asiento al depositar, así un tercero no puede
 *  secuestrar el slot. Mismo dominio EIP-712 que el resultado; el contrato la
 *  verifica con _requireSeat. */
export async function signSeat(matchId: Hex, player: Hex): Promise<Hex> {
  const account = arbiterAccount();
  return account.signTypedData({
    domain: resultDomain(),
    types: SEAT_TYPES,
    primaryType: "Seat",
    message: { matchId, player: player.toLowerCase() as Hex },
  });
}

// ---- Aleph: mesas de plata (EscrowAleph) ----------------------------------
// Dominio EIP-712 PROPIO, distinto del 1v1 a propósito: aunque el
// verifyingContract ya separa los dominios, el nombre lo deja explícito.

const ZERO = "0x0000000000000000000000000000000000000000";

export const ALEPH_SEAT_TYPES = {
  Seat: [
    { name: "roomId", type: "bytes32" },
    { name: "seatsHash", type: "bytes32" },
    { name: "stake", type: "uint256" },
    { name: "fundDeadline", type: "uint64" },
    { name: "playDeadline", type: "uint64" },
    { name: "player", type: "address" },
  ],
} as const;

export const ALEPH_PAYOUT_TYPES = {
  Payout: [
    { name: "roomId", type: "bytes32" },
    { name: "tableHash", type: "bytes32" },
  ],
} as const;

export function alephDomain() {
  return {
    name: "Arcade1v1EscrowAleph",
    version: "1",
    chainId: Number(process.env.CHAIN_ID ?? 84532),
    verifyingContract: (process.env.ALEPH_ESCROW_ADDRESS ?? ZERO) as Hex,
  };
}

/** `keccak256(abi.encode(seats))`, lo que ata cada pase a la lista congelada.
 *  Cada address se normaliza a minúsculas antes de codificar (mismo valor de
 *  20 bytes, evita el chequeo de checksum de viem ante una mayúscula que no
 *  sea un EIP-55 válido; el contrato compara por valor, no por escritura). */
export function alephSeatsHash(seats: Hex[]): Hex {
  const lower = seats.map((a) => a.toLowerCase() as Hex);
  return keccak256(encodeAbiParameters([{ type: "address[]" }], [lower]));
}

/** `keccak256(abi.encode(seats, amounts))`: el contrato lo recompone desde el
 *  calldata, así la firma no depende del largo de la tabla. Mismo motivo que
 *  `alephSeatsHash` para normalizar `seats` a minúsculas antes de codificar. */
export function alephTableHash(seats: Hex[], amounts: bigint[]): Hex {
  const lower = seats.map((a) => a.toLowerCase() as Hex);
  return keccak256(
    encodeAbiParameters([{ type: "address[]" }, { type: "uint256[]" }], [lower, amounts]),
  );
}

export interface AlephSeatPass {
  roomId: Hex;
  seatsHash: Hex;
  stake: bigint; // micro-USDC
  fundDeadline: bigint; // segundos (epoch)
  playDeadline: bigint; // segundos (epoch)
  player: Hex;
}

/** El PASE: autoriza a `player` a depositar en `roomId` con exactamente esa
 *  lista, ese stake y esos plazos. Como cubre todo, el que abre la sala no
 *  puede inventar la mesa. Sin gas del árbitro: cada asiento lo presenta. */
export async function signAlephSeat(p: AlephSeatPass): Promise<Hex> {
  return arbiterAccount().signTypedData({
    domain: alephDomain(),
    types: ALEPH_SEAT_TYPES,
    primaryType: "Seat",
    message: { ...p, player: p.player.toLowerCase() as Hex },
  });
}

/** La TABLA: firma el hash; el contrato verifica y paga a todos de una vez. */
export async function signAlephPayout(roomId: Hex, tableHash: Hex): Promise<Hex> {
  return arbiterAccount().signTypedData({
    domain: alephDomain(),
    types: ALEPH_PAYOUT_TYPES,
    primaryType: "Payout",
    message: { roomId, tableHash },
  });
}
