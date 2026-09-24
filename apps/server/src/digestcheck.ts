// Calcula los "digest" EIP-712 que firma el arbitro (con viem), usando el mismo
// dominio que el contrato (CHAIN_ID + ESCROW_ADDRESS): el del RESULTADO y el del
// ASIENTO, uno por línea. Sirve para comparar con lo que devuelve el contrato
// (resultDigest / seatDigest) y confirmar que las firmas del arbitro van a ser
// aceptadas al depositar y al pagar.

import { hashTypedData, type Hex } from "viem";
import { RESULT_TYPES, SEAT_TYPES, resultDomain } from "./sign.js";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`falta ${k}`);
  return v;
};
const matchId = env("MATCHID") as Hex;

const result = hashTypedData({
  domain: resultDomain(),
  types: RESULT_TYPES,
  primaryType: "Result",
  message: { matchId, winner: env("WINNER") as Hex, deadline: BigInt(env("DEADLINE")) },
});

const seat = hashTypedData({
  domain: resultDomain(),
  types: SEAT_TYPES,
  primaryType: "Seat",
  message: {
    matchId,
    player: env("PLAYER") as Hex,
    stake: BigInt(env("STAKE")),
    fundDeadline: BigInt(env("FUND_DEADLINE")),
    playDeadline: BigInt(env("PLAY_DEADLINE")),
  },
});

console.log(result);
console.log(seat);
