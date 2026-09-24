// Auto-test del arbitro (sin red): emparejamiento, firma, empate, feedback rico,
// ELO y ANTI-TRAMPA de los 6 juegos: replay con semilla en 5, y Flappy en vivo.
// Correr: npm run selftest -w @arcade1v1/server

import "dotenv/config";
import "./offline-env.js"; // el selftest corre offline a propósito (ver el módulo)
import { recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  matchmake,
  submitScore,
  getMatch,
  publicReplay,
  replayTooLong,
  sweepMatches,
  SUBMIT_WINDOW_MS,
} from "./matchmaking.js";
import { liveStart, liveCommit } from "./live.js";
import { arbiterAddress, RESULT_TYPES, resultDomain } from "./sign.js";
import { Game2048, type Dir } from "@arcade1v1/game-sdk/g2048";
import { TetrisEngine, type TetrisAction } from "@arcade1v1/game-sdk/tetris";
import { playFlappyLive, verifyFlappyLive } from "@arcade1v1/game-sdk/flappy-live";
import { liveSecretHash } from "@arcade1v1/game-sdk/live";
import { defaultParams, strategiesFor } from "@arcade1v1/strategies";
import {
  RacingEngine,
  RACING_DT,
  RACING_RULES_V,
  type RaceAction,
} from "@arcade1v1/game-sdk/racing";
import { SnakeEngine, SNAKE_RULES_V } from "@arcade1v1/game-sdk/snake";
import { InvadersEngine, type InvaderAction } from "@arcade1v1/game-sdk/invaders";
import { scoreAuthMessage, matchmakeAuthMessage } from "@arcade1v1/game-sdk/auth";
import { productionConfigErrors, parseTrustProxy } from "./config-guard.js";

/** Estas pruebas juegan juegos que NO son en vivo: la vista trae la semilla. */
function need(seed: number | undefined): number {
  if (seed === undefined) throw new Error("selftest: match without seed (live game?)");
  return seed;
}

function play2048(seedOrUndefined: number | undefined, maxMoves = 500) {
  const seed = need(seedOrUndefined);
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

function playTetris(seedOrUndefined: number | undefined) {
  const seed = need(seedOrUndefined);
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

function playRacing(seedOrUndefined: number | undefined) {
  const seed = need(seedOrUndefined);
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
  return { score: g.score, replay: { seed, ticks: t, inputs, v: RACING_RULES_V } };
}

function playSnake(seedOrUndefined: number | undefined) {
  const seed = need(seedOrUndefined);
  const g = new SnakeEngine(seed);
  let t = 0;
  while (!g.over && t < 2000) {
    g.tick();
    t++;
  }
  return { score: g.score, replay: { seed, ticks: t, inputs: [], v: SNAKE_RULES_V } };
}

function playInvaders(seedOrUndefined: number | undefined) {
  const seed = need(seedOrUndefined);
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
    message: {
      matchId: r.matchId as Hex,
      winner: r.winner as Hex,
      deadline: BigInt(r.signatureDeadline ?? 0),
    },
    signature: r.signature as Hex,
  });
  const ok = signer.toLowerCase() === arbiterAddress().toLowerCase();
  console.log("✓ firma valida (recupera al arbitro):", ok);
  // v2: la firma vence justo cuando el contrato abre el reembolso (plazo de
  // juego + 30 min de gracia); sin escrow, el plazo sale de la creación.
  const dlOk =
    typeof r.signatureDeadline === "number" &&
    r.signatureDeadline * 1000 > Date.now() + SUBMIT_WINDOW_MS &&
    r.signatureDeadline * 1000 <= Date.now() + SUBMIT_WINDOW_MS + 31 * 60_000;
  console.log("✓ la firma vence al abrirse el reembolso:", dlOk, "·", r.signatureDeadline);
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

  // 7) ANTI-TRAMPA en los juegos de TIEMPO REAL con semilla (paso fijo
  //    determinístico). Flappy no va acá: se juega en vivo (ver 7b).
  const games: {
    name: "tetris" | "racing" | "snake" | "invaders";
    play: (s: number | undefined) => { score: number; replay: unknown };
  }[] = [
    { name: "tetris", play: playTetris },
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

  // 7b) FLAPPY EN VIVO (reglas v2): la partida no tiene semilla. Cada jugador
  //     abre su intento y compromete sus aleteos; el azar le llega de a poco.
  //     Al decidirse se publica el secreto, y con él cualquiera re-verifica los
  //     dos intentos. L1 juega con la estrategia por defecto; L2 se planta en
  //     el tick 100, antes del primer tubo (puntaje 0), así hay un ganador.
  const L1 = "0x8888888888888888888888888888888888888888";
  const L2 = "0x9999999999999999999999999999999999999999";
  const lm = await matchmake("flappy", 1, L1);
  await matchmake("flappy", 1, L2);
  const liveNoSeedOk =
    lm.live === true && lm.seed === undefined && typeof lm.secretHash === "string";
  const flappyDef = strategiesFor("flappy").find((d) => d.step)!;
  for (const [who, cap] of [
    [L1, undefined],
    [L2, 100],
  ] as const) {
    const start = await liveStart(lm.matchId, who);
    if (start.over) continue;
    const step = flappyDef.step!(defaultParams(flappyDef));
    await playFlappyLive({
      start,
      decide: step.decide,
      maxTicks: cap ?? step.maxTicks,
      commit: (c) => liveCommit(lm.matchId, who, { ...c, token: start.token }),
    });
  }
  const lv = publicReplay(lm.matchId);
  const lvSecret = lv?.secret;
  // Gana L1, salvo que también haga 0: en 5000 secretos al azar nunca pasó, pero
  // el secreto es aleatorio, así que en ese caso tiene que dar empate (y no un
  // falso rojo en CI).
  const [s1, s2] = [L1, L2].map((a) => lv?.players.find((p) => p.address === a)?.score ?? -1);
  const liveDecidedOk =
    lv !== null && (s1 > s2 ? lv.winner === L1 : s1 === s2 && lv.outcome === "draw");
  const liveSecretOk = !!lvSecret && liveSecretHash(lvSecret) === lm.secretHash;
  const liveReverifyOk =
    !!lvSecret &&
    !!lv &&
    lv.players.every(
      (p) => verifyFlappyLive(lvSecret, p.replay as { ticks: number; flaps: number[] }) === p.score,
    );
  console.log(
    `✓ flappy EN VIVO: sin semilla = ${liveNoSeedOk} · decidida bien = ${liveDecidedOk}` +
      ` · secreto = hash = ${liveSecretOk} · los dos re-verifican = ${liveReverifyOk}`,
    `(${lv?.players.map((p) => p.score).join(" a ")})`,
  );
  // Un replay armado afuera no entra, aunque sea verosímil: en vivo solo
  // cuenta lo que se comprometió tick a tick.
  const L3 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const L4 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const om = await matchmake("flappy", 1, L3);
  await matchmake("flappy", 1, L4);
  let liveOutsideRejected = false;
  try {
    await submitScore(om.matchId, L3, 3, { ticks: 600, flaps: [0, 36, 72], v: 2 });
  } catch (e) {
    liveOutsideRejected = /replay not allowed/.test((e as Error).message);
  }
  console.log("✓ flappy EN VIVO: replay armado afuera RECHAZADO:", liveOutsideRejected);

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
  const fake = play2048(need(sm.seed) + 1, 200); // jugada válida, pero en OTRA semilla
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
    dlOk &&
    cheat2048 &&
    rA.scores[A] === pA.score &&
    authOk.scores[C] === pC.score &&
    badRejected &&
    draw.outcome === "draw" &&
    realtimeOk &&
    liveNoSeedOk &&
    liveDecidedOk &&
    liveSecretOk &&
    liveReverifyOk &&
    liveOutsideRejected &&
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
