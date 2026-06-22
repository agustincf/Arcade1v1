// Calcula el "digest" EIP-712 que firma el arbitro (con viem), usando el mismo
// dominio que el contrato (CHAIN_ID + ESCROW_ADDRESS). Sirve para comparar con
// lo que devuelve el contrato (resultDigest) y confirmar que la firma del
// arbitro va a ser aceptada al pagar.

import { hashTypedData, type Hex } from "viem";
import { RESULT_TYPES, resultDomain } from "./sign.js";

const matchId = process.env.MATCHID as Hex;
const winner = process.env.WINNER as Hex;

const digest = hashTypedData({
  domain: resultDomain(),
  types: RESULT_TYPES,
  primaryType: "Result",
  message: { matchId, winner },
});

console.log(digest);
