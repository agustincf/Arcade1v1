// Auto-test del arbitro (sin red): emparejamiento, firma, empate, feedback rico,
// ELO y ANTI-TRAMPA (replay) de los 6 juegos. Correr: npm run selftest -w @arcade1v1/server

import "dotenv/config";
import "./offline-env.js"; // el selftest corre offline a propósito (ver el módulo)
import { recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  matchmake,
  submitScore,
  getMatch,
  replayTooLong,
  sweepMatches,
  SUBMIT_WINDOW_MS,
} from "./matchmaking.js";
import { arbiterAddress, RESULT_TYPES, resultDomain } from "./sign.js";
import { Game2048, type Dir } from "@arcade1v1/game-sdk/g2048";
import { TetrisEngine, type TetrisAction } from "@arcade1v1/game-sdk/tetris";
import { FlappyEngine, FLAPPY_DT } from "@arcade1v1/game-sdk/flappy";
import { RacingEngine, RACING_DT, type RaceAction } from "@arcade1v1/game-sdk/racing";
import { SnakeEngine } from "@arcade1v1/game-sdk/snake";
import { InvadersEngine, type InvaderAction } from "@arcade1v1/game-sdk/invaders";
import { scoreAuthMessage, matchmakeAuthMessage } from "@arcade1v1/game-sdk/auth";
import { productionConfigErrors, parseTrustProxy } from "./config-guard.js";

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
  // El árbitro normaliza las direcciones a minúsculas (claves internas).
  const C = wC.address.toLowerCase();
  const D = wD.address.toLowerCase();
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

  // 9) ANTI-TRAMPA (semilla): el replay DEBE usar la semilla real de la partida.
  //    Si se aceptara una semilla distinta, el tramposo probaría muchas semillas
  //    offline y mandaría una favorable -> ganaría con dinero real de forma desleal.
  //    (Direcciones/mesas dedicadas para que el caso sea hermético.)
  const E = "0x3333333333333333333333333333333333333333";
  const sm = await matchmake("2048", 3, E);
  const fake = play2048(sm.seed + 1, 200); // jugada válida, pero en OTRA semilla
  let seedCheatRejected = false;
  try {
    await submitScore(sm.matchId, E, fake.score, fake.replay);
  } catch {
    seedCheatRejected = true;
  }
  console.log("✓ replay con semilla ajena RECHAZADO:", seedCheatRejected);

  // 10) UN INTENTO POR JUGADOR: reenviar el puntaje (para "mejorar") se rechaza.
  //     Si no, el primero en enviar reintenta hasta sacar su mejor marca (ventaja
  //     desleal sobre el rival, que al enviar cierra la partida y no puede repetir).
  const F = "0x4444444444444444444444444444444444444444";
  const ri = await matchmake("2048", 7, F);
  const firstTry = play2048(ri.seed, 30);
  await submitScore(ri.matchId, F, firstTry.score, firstTry.replay);
  let resubmitRejected = false;
  try {
    const secondTry = play2048(ri.seed, 200); // intenta de nuevo (otra jugada)
    await submitScore(ri.matchId, F, secondTry.score, secondTry.replay);
  } catch {
    resubmitRejected = true;
  }
  console.log("✓ reenvío de puntaje RECHAZADO (un intento):", resubmitRejected);

  // 10b) MESAS PERMITIDAS: un stake fuera de la lista se rechaza (corta colas
  //      basura con montos arbitrarios / NaN).
  let stakeRejected = false;
  try {
    await matchmake("2048", 4, A); // 4 no está en STAKES_ALLOWED
  } catch {
    stakeRejected = true;
  }
  let stakeNaNRejected = false;
  try {
    await matchmake("2048", Number("nada"), A);
  } catch {
    stakeNaNRejected = true;
  }
  console.log("✓ mesa no permitida RECHAZADA (4 y NaN):", stakeRejected && stakeNaNRejected);

  // 10c) ANTI-ESPIONAJE: el rival NO ve tu puntaje hasta que la partida se
  //      decide (antes podía consultarlo y jugar sabiendo cuánto superar).
  const H1 = "0x6666666666666666666666666666666666666666";
  const H2 = "0x7777777777777777777777777777777777777777";
  const am = await matchmake("snake", 3, H1);
  await matchmake("snake", 3, H2);
  const ph = playSnake(am.seed);
  await submitScore(am.matchId, H1, ph.score, ph.replay);
  const spy = getMatch(am.matchId, H2)!;
  const hiddenOk =
    spy.scores[H1] === undefined && spy.rivalSubmitted === true && spy.rivalReplay === undefined;
  const anon = getMatch(am.matchId)!; // un tercero sin address: no ve nada
  const anonOk = Object.keys(anon.scores).length === 0;
  const ph2 = playSnake(am.seed);
  const decidedView = await submitScore(am.matchId, H2, ph2.score, ph2.replay);
  const revealedOk = decidedView.scores[H1] !== undefined; // al decidir, se revela
  console.log(
    "✓ puntaje del rival OCULTO hasta decidir (y revelado después):",
    hiddenOk && anonOk && revealedOk,
  );

  // 10d) EMPAREJAR FIRMADO: firma válida aceptada; firma de otra wallet
  //      rechazada; firma vencida (ts viejo) rechazada.
  const wJ = privateKeyToAccount(generatePrivateKey());
  const tsJ = Date.now();
  const sigJ = await wJ.signMessage({
    message: matchmakeAuthMessage("2048", 5, wJ.address, tsJ),
  });
  const mmOk = await matchmake("2048", 5, wJ.address, { signature: sigJ, ts: tsJ });
  const wK = privateKeyToAccount(generatePrivateKey());
  let mmForgedRejected = false;
  try {
    // reusar la firma de wJ para encolar a wK (suplantación) -> rechazado
    await matchmake("2048", 5, wK.address, { signature: sigJ, ts: tsJ });
  } catch {
    mmForgedRejected = true;
  }
  let mmStaleRejected = false;
  const tsOld = Date.now() - 11 * 60_000;
  const sigOld = await wJ.signMessage({
    message: matchmakeAuthMessage("2048", 5, wJ.address, tsOld),
  });
  try {
    await matchmake("2048", 5, wJ.address, { signature: sigOld, ts: tsOld });
  } catch {
    mmStaleRejected = true;
  }
  const mmAuthOk = !!mmOk.matchId && mmForgedRejected && mmStaleRejected;
  console.log("✓ emparejar firmado (válida sí / ajena no / vencida no):", mmAuthOk);

  // 10e) BARRENDERO: una partida emparejada SIN resultado al vencer la ventana
  //      se expira (draw -> reembolso); y ya decidida no acepta envíos tardíos.
  const sw1 = await matchmake("tetris", 10, A);
  await matchmake("tetris", 10, B);
  sweepMatches(Date.now() + SUBMIT_WINDOW_MS + 16 * 60_000);
  const swept = getMatch(sw1.matchId)!;
  let lateRejected = false;
  try {
    const late = playTetris(sw1.seed);
    await submitScore(sw1.matchId, A, late.score, late.replay);
  } catch {
    lateRejected = true;
  }
  const sweepOk = swept.status === "draw" && swept.outcome === "draw" && lateRejected;
  console.log("✓ partida vencida expira a reembolso y rechaza envíos tardíos:", sweepOk);

  // 11) GUARDA DE CONFIG (mainnet): en producción con escrow activo, faltar
  //     CHAIN_ID / clave del árbitro / origen permitido / RPC debe DETECTARSE
  //     (si no, se firmaría para la red equivocada y los cobros no funcionarían).
  const badCfg = productionConfigErrors({
    NODE_ENV: "production",
    ESCROW_ADDRESS: "0x000000000000000000000000000000000000dEaD",
    // faltan CHAIN_ID, ARBITER_PRIVATE_KEY, ALLOWED_ORIGIN y RPC_URL a propósito
  } as NodeJS.ProcessEnv);
  const cfgGuardOk = badCfg.length === 4;
  console.log("✓ guarda de config mainnet detecta faltantes:", cfgGuardOk, `(${badCfg.length})`);
  const goodCfg = productionConfigErrors({
    NODE_ENV: "production",
    ESCROW_ADDRESS: "0x000000000000000000000000000000000000dEaD",
    CHAIN_ID: "8453",
    ARBITER_PRIVATE_KEY: "0x" + "a".repeat(64),
    ALLOWED_ORIGIN: "https://arcade1v1.example",
    RPC_URL: "https://mainnet.base.org",
  } as NodeJS.ProcessEnv);
  const cfgGoodOk = goodCfg.length === 0;
  console.log("✓ guarda de config mainnet OK con todo seteado:", cfgGoodOk);
  // La guarda ahora valida FORMATO, no solo presencia: un CHAIN_ID no numérico y
  // una clave truncada (errores de despliegue típicos) deben DETECTARSE aunque
  // estén "seteados". Antes arrancaban igual y los cobros se rompían en silencio.
  const malformedCfg = productionConfigErrors({
    NODE_ENV: "production",
    ESCROW_ADDRESS: "0x000000000000000000000000000000000000dEaD",
    CHAIN_ID: "base-sepolia",
    ARBITER_PRIVATE_KEY: "0xabc",
    ALLOWED_ORIGIN: "https://arcade1v1.example",
    RPC_URL: "https://mainnet.base.org",
  } as NodeJS.ProcessEnv);
  const cfgMalformedOk =
    malformedCfg.some((e) => e.includes("CHAIN_ID inválido")) &&
    malformedCfg.some((e) => e.includes("ARBITER_PRIVATE_KEY mal formada"));
  console.log("✓ guarda de config mainnet detecta valores mal formados:", cfgMalformedOk);

  // 12) ANTI-DoS: un replay con `ticks` gigantes (re-jugar sería O(ticks)) se
  //     rechaza ANTES de iterar. Probamos la guarda pura (no dispara el bucle).
  const dosBig = replayTooLong({ seed: 1, ticks: 1e9, inputs: [] });
  const dosNormal = replayTooLong({ seed: 1, ticks: 100, inputs: [] });
  const dosGuardOk = dosBig === true && dosNormal === false;
  console.log("✓ guarda anti-DoS (replay gigante rechazado, normal aceptado):", dosGuardOk);
  // Integración: el endpoint corta el replay gigante ANTES de entrar al bucle.
  const G = "0x5555555555555555555555555555555555555555";
  const dm = await matchmake("tetris", 5, G);
  let dosEndpointRejected = false;
  try {
    await submitScore(dm.matchId, G, 999999, { seed: dm.seed, ticks: 1e9, inputs: [] });
  } catch {
    dosEndpointRejected = true;
  }
  console.log("✓ endpoint corta el replay gigante:", dosEndpointRejected);

  // 13) TRUST_PROXY robusto: número/bool/IP se interpretan; la basura se ignora
  //     (no se pasa cruda a Express) y queda el default seguro.
  const tpOk =
    parseTrustProxy("1") === 1 &&
    parseTrustProxy("true") === true &&
    parseTrustProxy("false") === false &&
    parseTrustProxy("10.0.0.0/8") === "10.0.0.0/8" &&
    parseTrustProxy("si") === undefined &&
    parseTrustProxy("") === undefined;
  console.log("✓ parseTrustProxy (numero/bool/IP ok, basura ignorada):", tpOk);

  const allOk =
    ok &&
    cheat2048 &&
    rA.scores[A] === pA.score &&
    authOk.scores[C] === pC.score &&
    badRejected &&
    draw.outcome === "draw" &&
    realtimeOk &&
    unknownRejected &&
    seedCheatRejected &&
    resubmitRejected &&
    stakeRejected &&
    stakeNaNRejected &&
    hiddenOk &&
    anonOk &&
    revealedOk &&
    mmAuthOk &&
    sweepOk &&
    cfgGuardOk &&
    cfgGoodOk &&
    cfgMalformedOk &&
    dosGuardOk &&
    dosEndpointRejected &&
    tpOk;
  if (!allOk) process.exit(1);
  console.log("\nTODO OK ✅");
}

main();
