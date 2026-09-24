// Firma de resultados con la llave del arbitro (EIP-712).
// El formato coincide EXACTAMENTE con el contrato Escrow1v1 v2, asi la firma
// que produce el backend la puede verificar el contrato al pagar.

import { privateKeyToAccount } from "viem/accounts";
import { keccak256, encodeAbiParameters, type Hex } from "viem";

/** El resultado lleva VENCIMIENTO (segundos, como el contrato): pasado
 *  `deadline`, la firma no liquida nada. Ver `resultDeadlineOf` en matchmaking.ts. */
export const RESULT_TYPES = {
  Result: [
    { name: "matchId", type: "bytes32" },
    { name: "winner", type: "address" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

/** El asiento ata las CONDICIONES de la partida, no solo quién entra: quien
 *  abre no puede elegir otro stake ni otros plazos que los que le firmó el
 *  árbitro, y el asiento del que se une verifica contra los mismos. */
export const SEAT_TYPES = {
  Seat: [
    { name: "matchId", type: "bytes32" },
    { name: "player", type: "address" },
    { name: "stake", type: "uint256" },
    { name: "fundDeadline", type: "uint64" },
    { name: "playDeadline", type: "uint64" },
  ],
} as const;

/** Las condiciones de una partida de plata, como las ata el asiento. */
export interface SeatTerms {
  stake: bigint; // micro-USDC
  fundDeadline: bigint; // segundos (epoch)
  playDeadline: bigint; // segundos (epoch)
}

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

/** Versión "2" del dominio: la de Escrow1v1 v2 (resultado con vencimiento y
 *  asiento con condiciones). Un árbitro de este código solo habla con un
 *  contrato v2. */
export function resultDomain() {
  return {
    name: "Arcade1v1Escrow",
    version: "2",
    chainId: Number(process.env.CHAIN_ID ?? 84532),
    verifyingContract: (process.env.ESCROW_ADDRESS ??
      "0x0000000000000000000000000000000000000000") as Hex,
  };
}

/** Firma (matchId, winner, deadline). La presenta el árbitro (y si no, el
 *  ganador) al contrato, hasta `deadline` (segundos).
 *  La direccion se normaliza a minusculas (mismo valor de 20 bytes, evita
 *  el chequeo de checksum de viem; el contrato la compara por valor). */
export async function signResult(matchId: Hex, winner: Hex, deadline: bigint): Promise<Hex> {
  const account = arbiterAccount();
  return account.signTypedData({
    domain: resultDomain(),
    types: RESULT_TYPES,
    primaryType: "Result",
    message: { matchId, winner: winner.toLowerCase() as Hex, deadline },
  });
}

/** Firma el "asiento": autoriza a `player` a depositar en esa partida
 *  (open/join) con ESAS condiciones. Ata al rival on-chain SIN que el árbitro
 *  pague gas —cada jugador presenta su asiento al depositar, así un tercero no
 *  puede secuestrar el slot— y ata el stake y los plazos, así quien abre no
 *  puede inventarlos. Mismo dominio EIP-712 que el resultado; el contrato la
 *  verifica con _requireSeat. */
export async function signSeat(matchId: Hex, player: Hex, terms: SeatTerms): Promise<Hex> {
  const account = arbiterAccount();
  return account.signTypedData({
    domain: resultDomain(),
    types: SEAT_TYPES,
    primaryType: "Seat",
    message: { matchId, player: player.toLowerCase() as Hex, ...terms },
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

/** La tabla lleva VENCIMIENTO (segundos, como el contrato): pasado `deadline`,
 *  la firma no liquida nada. Ver `settleOnchain` en aleph.ts. */
export const ALEPH_PAYOUT_TYPES = {
  Payout: [
    { name: "roomId", type: "bytes32" },
    { name: "tableHash", type: "bytes32" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

/** Versión "2" del dominio: la de EscrowAleph v2 (tabla con vencimiento). La v1
 *  firmaba `Payout(roomId, tableHash)`; un árbitro de este código solo habla
 *  con un contrato v2. */
export function alephDomain() {
  return {
    name: "Arcade1v1EscrowAleph",
    version: "2",
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

/** La TABLA: firma el hash y el vencimiento (segundos); el contrato verifica y
 *  paga a todos de una vez, si todavía no venció. */
export async function signAlephPayout(roomId: Hex, tableHash: Hex, deadline: bigint): Promise<Hex> {
  return arbiterAccount().signTypedData({
    domain: alephDomain(),
    types: ALEPH_PAYOUT_TYPES,
    primaryType: "Payout",
    message: { roomId, tableHash, deadline },
  });
}
