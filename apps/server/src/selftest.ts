// Auto-test del arbitro (sin red): simula dos jugadores, decide el resultado
// y verifica que la firma recupere la direccion del arbitro (lo que hace el
// contrato al pagar). Correr con: npm run selftest -w @arcade1v1/server

import "dotenv/config";
import { recoverTypedDataAddress, type Hex } from "viem";
import { matchmake, submitScore } from "./matchmaking.js";
import { arbiterAddress, RESULT_TYPES, resultDomain } from "./sign.js";
import { Game2048, type Dir } from "@arcade1v1/game-sdk/g2048";
import { scoreAuthMessage } from "@arcade1v1/game-sdk/auth";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Juega un 2048 (mismo motor que la web) y devuelve los movimientos + puntaje.
function play2048(seed: number, maxMoves = 500) {
  const g = new Game2048(seed);
  const moves: Dir[] = [];
  const dirs: Dir[] = ["left", "up", "right", "down"];
  let i = 0;
  while (!g.over && moves.length < maxMoves && i < 4000) {
    if (g.move(dirs[i % 4])) moves.push(dirs[i % 4]);
    i++;
  }
  return { moves, score: g.score };
}

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

  // 5) ANTI-TRAMPA en 2048: replay legitimo se acepta, puntaje inventado se rechaza.
  const cA = matchmake("2048", 5, A);
  const pA = play2048(cA.seed, 500); // A juega bien
  const rA = await submitScore(cA.matchId, A, pA.score, {
    seed: cA.seed,
    moves: pA.moves,
  });
  console.log("✓ replay legitimo aceptado:", rA.scores[A] === pA.score);

  const cB = matchmake("2048", 5, B); // se empareja con A (misma semilla)
  let cheatRejected = false;
  try {
    // B intenta hacer trampa: dice 999999 con un replay que no lo respalda.
    await submitScore(cB.matchId, B, 999999, { seed: cB.seed, moves: [] });
  } catch {
    cheatRejected = true;
  }
  console.log("✓ puntaje inventado RECHAZADO:", cheatRejected);

  const pB = play2048(cB.seed, 12); // B juega menos -> menos puntos
  const rB = await submitScore(cB.matchId, B, pB.score, {
    seed: cB.seed,
    moves: pB.moves,
  });
  const settled = rB.status === "settled" || rB.status === "draw";
  console.log("✓ 2048 verificado y liquidado:", settled);

  // 6) AUTENTICACION: firma valida aceptada, firma que no corresponde rechazada.
  const wC = privateKeyToAccount(generatePrivateKey());
  const wD = privateKeyToAccount(generatePrivateKey());
  const C = wC.address;
  const D = wD.address;
  const cm = matchmake("2048", 5, C);
  matchmake("2048", 5, D);
  const pC = play2048(cm.seed, 30);
  const sigC = await wC.signMessage({
    message: scoreAuthMessage(cm.matchId, C, pC.score),
  });
  const authOk = await submitScore(
    cm.matchId,
    C,
    pC.score,
    { seed: cm.seed, moves: pC.moves },
    sigC,
  );
  console.log("✓ firma valida aceptada:", authOk.scores[C] === pC.score);

  const pD = play2048(cm.seed, 30);
  // D firma un mensaje que NO corresponde al envio -> debe rechazarse.
  const badSig = await wD.signMessage({
    message: scoreAuthMessage(cm.matchId, D, 999999),
  });
  let badRejected = false;
  try {
    await submitScore(cm.matchId, D, pD.score, { seed: cm.seed, moves: pD.moves }, badSig);
  } catch {
    badRejected = true;
  }
  console.log("✓ firma que no corresponde RECHAZADA:", badRejected);

  const allOk =
    ok &&
    cheatRejected &&
    settled &&
    authOk.scores[C] === pC.score &&
    badRejected;
  if (!allOk) process.exit(1);
  console.log("\nTODO OK ✅");
}

main();
