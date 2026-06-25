// Auto-test del arbitro (sin red): emparejamiento, firma, empate, feedback rico,
// ELO y ANTI-TRAMPA (replay) de los 6 juegos. Correr: npm run selftest -w @arcade1v1/server

import "dotenv/config";
import "./offline-env.js"; // el selftest corre offline a propósito (ver el módulo)
import { recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { matchmake, submitScore } from "./matchmaking.js";
import { arbiterAddress, RESULT_TYPES, resultDomain } from "./sign.js";
import { Game2048, type Dir } from "@arcade1v1/game-sdk/g2048";
import { TetrisEngine, type TetrisAction } from "@arcade1v1/game-sdk/tetris";
import { FlappyEngine, FLAPPY_DT } from "@arcade1v1/game-sdk/flappy";
import { RacingEngine, RACING_DT, type RaceAction } from "@arcade1v1/game-sdk/racing";
import { SnakeEngine } from "@arcade1v1/game-sdk/snake";
import { InvadersEngine, type InvaderAction } from "@arcade1v1/game-sdk/invaders";
import { scoreAuthMessage } from "@arcade1v1/game-sdk/auth";

function play2048(seed: number, maxMoves = 500) {
  const g = new Game2048(seed);
  const moves: Dir[] = [];
  const dirs: Dir[] = ["left", "up", "right", "down"];
  let i = 0;
  while (!g.over && moves.length < maxMoves && i < 4000) {
    if (g.move(dirs[i % 4])) moves.push(dirs[i % 4]);
    i++;
  }
  return { score: g.score, replay: { seed, moves } };
}

function playTetris(seed: number) {
  const g = new TetrisEngine(seed);
  const inputs: { t: number; a: TetrisAction }[] = [];
  let t = 0;
  while (!g.over && t < 3000) {
    if (t % 6 === 0) {
      g.apply("h");
      inputs.push({ t, a: "h" });
    }
    g.tick();
    t++;
  }
  return { score: g.score, replay: { seed, ticks: t, inputs } };
}

function playFlappy(seed: number) {
  const g = new FlappyEngine(seed);
  const flaps: number[] = [];
  let t = 0;
  while (!g.over && t < 600) {
    if (t % 18 === 0) {
      g.flap();
      flaps.push(t);
    }
    g.update(FLAPPY_DT);
    t++;
  }
  return { score: g.score, replay: { seed, ticks: t, flaps } };
}

function playRacing(seed: number) {
  const g = new RacingEngine(seed);
  const inputs: { t: number; a: RaceAction }[] = [];
  let t = 0;
  while (!g.over && t < 1200) {
    if (t % 40 === 0) {
      g.moveRight();
      inputs.push({ t, a: "r" });
    } else if (t % 40 === 20) {
      g.moveLeft();
      inputs.push({ t, a: "l" });
    }
    g.update(RACING_DT);
    t++;
  }
  return { score: g.score, replay: { seed, ticks: t, inputs } };
}

function playSnake(seed: number) {
  const g = new SnakeEngine(seed);
  let t = 0;
  while (!g.over && t < 2000) {
    g.tick();
    t++;
  }
  return { score: g.score, replay: { seed, ticks: t, inputs: [] } };
}

function playInvaders(seed: number) {
  const g = new InvadersEngine(seed);
  const inputs: { t: number; a: InvaderAction }[] = [];
  let t = 0;
  g.apply("r1");
  inputs.push({ t: 0, a: "r1" });
  g.apply("f1"); // mantiene el disparo (auto-fire)
  inputs.push({ t: 0, a: "f1" });
  while (!g.over && t < 3000) {
    g.tick();
    t++;
  }
  return { score: g.score, replay: { seed, ticks: t, inputs } };
}

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

async function main() {
  console.log("Arbitro:", arbiterAddress());

  // 1) Emparejamiento + 2) cada uno juega (A gana) + 3) firma valida.
  const m1 = await matchmake("2048", 5, A);
  const m2 = await matchmake("2048", 5, B);
  console.log("✓ emparejados:", m1.matchId === m2.matchId);
  console.log("✓ misma semilla (juego justo):", m1.seed === m2.seed, "(", m1.seed, ")");
  const sA = play2048(m1.seed, 500); // A juega completo
  const sB = play2048(m2.seed, 12); // B juega poco -> menos puntos
  await submitScore(m2.matchId, A, sA.score, sA.replay);
  const r = await submitScore(m2.matchId, B, sB.score, sB.replay);
  console.log("✓ estado:", r.status, "· ganador:", r.winner === A ? "A (p1)" : "B (p2)");
  const signer = await recoverTypedDataAddress({
    domain: resultDomain(),
    types: RESULT_TYPES,
    primaryType: "Result",
    message: { matchId: r.matchId as Hex, winner: r.winner as Hex },
    signature: r.signature as Hex,
  });
  const ok = signer.toLowerCase() === arbiterAddress().toLowerCase();
  console.log("✓ firma valida (recupera al arbitro):", ok);
  // Feedback rico: el envio de B (cerro la partida) trae el replay de A + PnL.
  const richOk =
    r.rivalReplay !== undefined && r.rivalScore === sA.score && typeof r.netPnl === "number";
  console.log("✓ feedback rico (rivalReplay + rivalScore + netPnl):", richOk, "· PnL B:", r.netPnl);
  const eloOk =
    typeof r.rating === "number" && typeof r.ratingDelta === "number" && r.ratingDelta < 0; // B perdio -> su rating baja
  console.log(
    "✓ rating ELO (B perdió → baja):",
    eloOk,
    "· rating B:",
    r.rating,
    "delta",
    r.ratingDelta,
  );

  // 4) Empate -> reembolso (mismos movimientos = mismo puntaje).
  const e1 = await matchmake("2048", 10, A);
  const e2 = await matchmake("2048", 10, B);
  const eA = play2048(e1.seed, 30);
  const eB = play2048(e2.seed, 30);
  await submitScore(e1.matchId, A, eA.score, eA.replay);
  const draw = await submitScore(e2.matchId, B, eB.score, eB.replay);
  console.log("✓ empate -> reembolso:", draw.outcome === "draw");

  // 5) ANTI-TRAMPA 2048: legitimo aceptado, inventado rechazado.
  const cA = await matchmake("2048", 2, A);
  const pA = play2048(cA.seed, 500);
  const rA = await submitScore(cA.matchId, A, pA.score, pA.replay);
  console.log("✓ replay 2048 aceptado:", rA.scores[A] === pA.score);
  const cB = await matchmake("2048", 2, B);
  let cheat2048 = false;
  try {
    await submitScore(cB.matchId, B, 999999, { seed: cB.seed, moves: [] });
  } catch {
    cheat2048 = true;
  }
  console.log("✓ puntaje 2048 inventado RECHAZADO:", cheat2048);

  // 6) AUTENTICACION: firma valida aceptada, firma que no corresponde rechazada.
  const wC = privateKeyToAccount(generatePrivateKey());
  const wD = privateKeyToAccount(generatePrivateKey());
  const C = wC.address;
  const D = wD.address;
  const cm = await matchmake("2048", 1, C);
  await matchmake("2048", 1, D);
  const pC = play2048(cm.seed, 30);
  const sigC = await wC.signMessage({ message: scoreAuthMessage(cm.matchId, C, pC.score) });
  const authOk = await submitScore(cm.matchId, C, pC.score, pC.replay, sigC);
  console.log("✓ firma valida aceptada:", authOk.scores[C] === pC.score);
  const pD = play2048(cm.seed, 30);
  const badSig = await wD.signMessage({ message: scoreAuthMessage(cm.matchId, D, 999999) });
  let badRejected = false;
  try {
    await submitScore(cm.matchId, D, pD.score, pD.replay, badSig);
  } catch {
    badRejected = true;
  }
  console.log("✓ firma que no corresponde RECHAZADA:", badRejected);

  // 7) ANTI-TRAMPA en los juegos de TIEMPO REAL (paso fijo determinístico).
  const games: {
    name: "tetris" | "flappy" | "racing" | "snake" | "invaders";
    play: (s: number) => { score: number; replay: unknown };
  }[] = [
    { name: "tetris", play: playTetris },
    { name: "flappy", play: playFlappy },
    { name: "racing", play: playRacing },
    { name: "snake", play: playSnake },
    { name: "invaders", play: playInvaders },
  ];
  let realtimeOk = true;
  for (const g of games) {
    const p1 = await matchmake(g.name, 5, A);
    await matchmake(g.name, 5, B);
    const pl = g.play(p1.seed);
    const res = await submitScore(p1.matchId, A, pl.score, pl.replay);
    const legitOk = res.scores[A] === pl.score;
    let cheatOk = false;
    try {
      await submitScore(p1.matchId, B, 999999, {
        seed: p1.seed,
        ticks: 5,
        inputs: [],
        flaps: [],
        moves: [],
      });
    } catch {
      cheatOk = true;
    }
    console.log(
      `✓ ${g.name}: replay aceptado (${pl.score} pts) = ${legitOk} · inventado rechazado = ${cheatOk}`,
    );
    realtimeOk = realtimeOk && legitOk && cheatOk;
  }

  // 8) DEFAULT-DENY: un juego desconocido no se empareja (y por ende jamás
  //    podría liquidar un puntaje sin verificar).
  let unknownRejected = false;
  try {
    await matchmake("juego-trucho", 5, A);
  } catch {
    unknownRejected = true;
  }
  console.log("✓ juego desconocido RECHAZADO (default-deny):", unknownRejected);

  const allOk =
    ok &&
    cheat2048 &&
    rA.scores[A] === pA.score &&
    authOk.scores[C] === pC.score &&
    badRejected &&
    draw.outcome === "draw" &&
    realtimeOk &&
    unknownRejected;
  if (!allOk) process.exit(1);
  console.log("\nTODO OK ✅");
}

main();
