// Auto-test del arbitro (sin red): simula dos jugadores, decide el resultado
// y verifica que la firma recupere la direccion del arbitro (lo que hace el
// contrato al pagar). Correr con: npm run selftest -w @arcade1v1/server

import "dotenv/config";
import { recoverTypedDataAddress, type Hex } from "viem";
import { matchmake, submitScore } from "./matchmaking.js";
import { arbiterAddress, RESULT_TYPES, resultDomain } from "./sign.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

async function main() {
  console.log("Arbitro:", arbiterAddress());

  // 1) Emparejamiento por orden de llegada.
  const m1 = matchmake("tetris", 5, A);
  const m2 = matchmake("tetris", 5, B);
  console.log("✓ emparejados:", m1.matchId === m2.matchId);
  console.log("✓ misma semilla (juego justo):", m1.seed === m2.seed, "(", m1.seed, ")");

  // 2) Cada uno juega su intento (A hace mas puntos).
  await submitScore(m2.matchId, A, 1200);
  const r = await submitScore(m2.matchId, B, 800);
  console.log("✓ estado:", r.status, "· ganador:", r.winner === A ? "A (p1)" : "B (p2)");

  // 3) La firma del arbitro debe recuperar su direccion (lo que verifica el contrato).
  const signer = await recoverTypedDataAddress({
    domain: resultDomain(),
    types: RESULT_TYPES,
    primaryType: "Result",
    message: { matchId: r.matchId as Hex, winner: r.winner as Hex },
    signature: r.signature as Hex,
  });
  const ok = signer.toLowerCase() === arbiterAddress().toLowerCase();
  console.log("✓ firma valida (recupera al arbitro):", ok);

  // 4) Caso empate -> reembolso.
  const e1 = matchmake("flappy", 10, A);
  matchmake("flappy", 10, B);
  await submitScore(e1.matchId, A, 50);
  const draw = await submitScore(e1.matchId, B, 50);
  console.log("✓ empate -> reembolso:", draw.outcome === "draw");

  if (!ok) process.exit(1);
  console.log("\nTODO OK ✅");
}

main();
