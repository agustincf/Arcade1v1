// Prueba de PAGO de punta a punta en cadena local (anvil) del modelo ASINCRONICO
// (open/join) usando el BACKEND real: emparejar -> P1 ABRE (deposita) -> P2 se
// UNE (deposita), los dos con las condiciones que firmó el árbitro -> juegan ->
// el árbitro decide, firma y LIQUIDA él mismo (v2). Verifica premio + comisión,
// el reembolso en empate, el ganador que se adelanta al árbitro con la misma
// firma, y el ganador en la blacklist de USDC (cobra después, con withdraw). Al
// final, dos cancels del árbitro que se minan REVERTIDOS porque otra
// transacción se adelanta: uno que hay que reintentar y otro en el que hay que
// cortar.
//
// A propósito SIN "dotenv/config": todo lo que hace falta lo pasa
// check-payment-e2e.sh por entorno, y así ningún .env del repo (que localmente
// puede tener la clave y el RPC de una red de VERDAD) se cuela en una corrida
// contra anvil. Mismo criterio que aleph-onchain-e2e.ts.

import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseEther,
  parseGwei,
  type Hex,
  type Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { matchmake, submitScore, onchainSettled, getMatch, type MatchView } from "./matchmaking.js";
import {
  cancelMatchOnchain,
  readMatchOnchain,
  ONCHAIN_STATUS,
  ESCROW_REFUND_GRACE_S,
} from "./onchain.js";
import { signSeat } from "./sign.js";
import { Game2048, type Dir } from "@arcade1v1/game-sdk/g2048";
import { escrowAbi, erc20Abi } from "./abi.js";

const RPC = process.env.RPC_URL || "http://localhost:8545";
const USDC = process.env.USDC_ADDR as Hex;
const ESCROW = process.env.ESCROW_ADDRESS as Hex;

const KEYS = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  p1: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  p2: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
} as const;
const PLATFORM = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Hex;

const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const w = (k: string) =>
  createWalletClient({
    account: privateKeyToAccount(k as Hex),
    chain: foundry,
    transport: http(RPC),
  });
const owner = w(KEYS.owner);
const p1 = w(KEYS.p1);
const p2 = w(KEYS.p2);
const P1 = p1.account.address;
const P2 = p2.account.address;

async function send(c: ReturnType<typeof w>, address: Hex, abi: Abi, fn: string, args: unknown[]) {
  const hash = await c.writeContract({
    address,
    abi,
    functionName: fn,
    args,
    account: c.account,
    chain: foundry,
  } as never);
  await pub.waitForTransactionReceipt({ hash });
}
const bal = (a: Hex) =>
  pub.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [a],
  }) as Promise<bigint>;
const usd = (x: bigint) => (Number(x) / 1e6).toFixed(2);
const owed = (a: Hex) =>
  pub.readContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "owed",
    args: [a],
  }) as Promise<bigint>;

// El USDC de este e2e es BlacklistUSDC (packages/contracts/test): un MockUSDC
// con la blacklist de Circle, para el escenario del ganador bloqueado.
const blacklistAbi = [
  {
    type: "function",
    name: "blacklist",
    inputs: [{ type: "address" }, { type: "bool" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/** P1 ABRE con las condiciones de SU vista (las que firmó el árbitro) y P2 se
 *  UNE con su asiento. Sin asiento, o con otras condiciones, revierten. */
async function openAndJoin(v1: MatchView, v2: MatchView, stake: bigint) {
  if (!v1.seatSig || !v2.seatSig || v1.fundDeadline === undefined || !v1.playDeadline) {
    throw new Error("matchmake no emitió el asiento y sus plazos (¿escrow activo?)");
  }
  await send(p1, ESCROW, escrowAbi, "open", [
    v1.matchId,
    stake,
    BigInt(v1.fundDeadline),
    BigInt(v1.playDeadline),
    v1.seatSig,
  ]);
  await send(p2, ESCROW, escrowAbi, "join", [v2.matchId, v2.seatSig]);
}

/** USDC y approve exacto para los dos jugadores. */
async function fundBoth(stake: bigint) {
  await send(owner, USDC, erc20Abi, "mint", [P1, stake]);
  await send(owner, USDC, erc20Abi, "mint", [P2, stake]);
  await send(p1, USDC, erc20Abi, "approve", [ESCROW, stake]);
  await send(p2, USDC, erc20Abi, "approve", [ESCROW, stake]);
}

function play2048(seed: number | undefined, maxMoves: number) {
  // 2048 no es un juego en vivo: la vista siempre trae la semilla.
  if (seed === undefined) throw new Error("2048 match without seed");
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

async function main() {
  const stake = 5_000_000n;
  // La gracia del contrato y la del árbitro son la MISMA constante: el
  // resultado firmado vence justo cuando se abre el reembolso.
  const grace = await pub.readContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "REFUND_GRACE",
  });
  if (Number(grace) !== ESCROW_REFUND_GRACE_S) {
    fail(
      `REFUND_GRACE del contrato (${grace}) != ESCROW_REFUND_GRACE_S (${ESCROW_REFUND_GRACE_S})`,
    );
  }
  console.log("✓ REFUND_GRACE del contrato coincide con el del árbitro:", Number(grace), "s");

  // Preparacion: mesa habilitada, gas para el arbitro (liquida y cancela), USDC.
  await send(owner, ESCROW, escrowAbi, "setAllowedStake", [stake, true]);
  await owner.sendTransaction({
    to: privateKeyToAccount(process.env.ARBITER_PRIVATE_KEY as Hex).address,
    value: parseEther("1"),
    chain: foundry,
  });
  await fundBoth(stake);

  // 1) Emparejamiento (backend): A es p1, B es p2 (mismo matchId).
  const m1 = await matchmake("2048", 5, P1);
  const m2 = await matchmake("2048", 5, P2);
  console.log("✓ emparejados:", m1.matchId === m2.matchId);
  console.log(
    "✓ las dos vistas traen las MISMAS condiciones:",
    m1.fundDeadline === m2.fundDeadline && m1.playDeadline === m2.playDeadline,
  );

  // 2) P1 ABRE (deposita), P2 se UNE (deposita). El arbitro no toca nada.
  //    Cada uno presenta su ASIENTO (firma del árbitro que lo autoriza a ESA
  //    partida con ESAS condiciones): sin él, open/join revierten "bad seat".
  //    El backend lo emite en la respuesta de matchmake para mesas de plata.
  await openAndJoin(m1, m2, stake);
  console.log("✓ P1 abrió + P2 se unió · escrow:", usd(await bal(ESCROW)), "USDC");

  // 3) Juegan y el arbitro decide + firma (P1 gana)...
  const sA = play2048(m1.seed, 500);
  await submitScore(m1.matchId, P1, sA.score, sA.replay);
  const sB = play2048(m2.seed, 12);
  const res = await submitScore(m2.matchId, P2, sB.score, sB.replay);
  // El árbitro normaliza direcciones a minúsculas: comparar case-insensitive.
  console.log(
    "✓ ganador:",
    res.winner?.toLowerCase() === P1.toLowerCase() ? "P1" : "P2",
    "· firma:",
    !!res.signature,
    "· vence:",
    res.signatureDeadline === m1.playDeadline! + ESCROW_REFUND_GRACE_S,
  );

  // 4) ...y LIQUIDA ÉL MISMO: nadie más manda una transacción.
  await onchainSettled(res.matchId);
  const after = getMatch(res.matchId, P1);
  if (!after?.settleTx) fail("el árbitro no dejó el hash de su settle en la vista");
  console.log("✓ el árbitro liquidó solo · tx:", after.settleTx);

  console.log("✓ ganador cobró:", usd(await bal(P1)), "USDC (esperado 8.50)");
  console.log("✓ plataforma (15%):", usd(await bal(PLATFORM)), "USDC (esperado 1.50)");
  console.log("✓ escrow:", usd(await bal(ESCROW)), "USDC (esperado 0.00)");
  if (
    (await bal(P1)) !== 8_500_000n ||
    (await bal(PLATFORM)) !== 1_500_000n ||
    (await bal(ESCROW)) !== 0n
  ) {
    console.log("\n❌ Balances no cuadran");
    process.exit(1);
  }
  console.log("\nCICLO ASINCRONICO (open/join, con el backend, liquida el árbitro) VERIFICADO ✅");

  await drawScenario();
  await ghostScenario();
  await winnerBeatsTheArbiter();
  await blacklistedWinner();
  await rivalJoinsWhileCancelTravels();
  await refundedWhileCancelTravels();
}

/** Empate: los dos juegan IGUAL -> el arbitro cancela on-chain y se reembolsa. */
async function drawScenario() {
  console.log("\n--- Empate (reembolso on-chain) ---");
  const stake = 10_000_000n;
  await send(owner, ESCROW, escrowAbi, "setAllowedStake", [stake, true]);
  await fundBoth(stake);
  const b1 = await bal(P1);
  const b2 = await bal(P2);
  const bE = await bal(ESCROW);
  const bP = await bal(PLATFORM);

  const m1 = await matchmake("2048", 10, P1);
  const m2 = await matchmake("2048", 10, P2);
  await openAndJoin(m1, m2, stake);

  const a = play2048(m1.seed, 80);
  await submitScore(m1.matchId, P1, a.score, a.replay);
  const b = play2048(m2.seed, 80);
  const res = await submitScore(m2.matchId, P2, b.score, b.replay);
  console.log("✓ empate detectado:", res.outcome === "draw");
  await onchainSettled(m2.matchId);

  const ok =
    (await bal(P1)) === b1 &&
    (await bal(P2)) === b2 &&
    (await bal(ESCROW)) === bE &&
    (await bal(PLATFORM)) === bP;
  console.log("✓ los dos reembolsados (balances vuelven al inicio):", ok);
  if (!ok) {
    console.log("\n❌ Empate: balances no cuadran");
    process.exit(1);
  }
  console.log("\nREEMBOLSO ON-CHAIN EN EMPATE VERIFICADO ✅");
}

/** FANTASMA: emparejar en una mesa de plata NO alcanza — hay que depositar.
 *
 *  El árbitro no leía la cadena, así que un atacante podía encolar wallets
 *  recién generadas en las mesas de plata (solo cuesta una firma), no depositar
 *  nunca, y dejar trabada la plata de cada humano que sí depositó hasta que
 *  venciera el plazo. Acá se comprueba contra una cadena de verdad que el envío
 *  del fantasma se rechaza. */
async function ghostScenario() {
  console.log("\n--- Fantasma (empareja pero no deposita) ---");
  const stake = 1_000_000n;
  await send(owner, ESCROW, escrowAbi, "setAllowedStake", [stake, true]);

  // El fantasma empareja y juega, pero NUNCA llama a open/join.
  const m = await matchmake("2048", 1, P1);
  const run = play2048(m.seed, 120);

  let rechazado = false;
  let motivo = "";
  try {
    await submitScore(m.matchId, P1, run.score, run.replay);
  } catch (e) {
    rechazado = true;
    motivo = (e as Error).message;
  }
  console.log("✓ envío sin depósito RECHAZADO:", rechazado, motivo ? `(${motivo})` : "");
  if (!rechazado || !/no on-chain deposit/.test(motivo)) {
    console.log("\n❌ El fantasma pudo enviar puntaje en una mesa de plata");
    process.exit(1);
  }

  // Y el control: el mismo jugador, DESPUÉS de depositar, sí puede enviar.
  await send(owner, USDC, erc20Abi, "mint", [P1, stake]);
  await send(p1, USDC, erc20Abi, "approve", [ESCROW, stake]);
  const m2 = await matchmake("2048", 1, P2); // se empareja con la de P1
  if (!m.seatSig || m.fundDeadline === undefined || m.playDeadline === undefined) {
    throw new Error("matchmake no emitió el asiento");
  }
  await send(p1, ESCROW, escrowAbi, "open", [
    m.matchId as Hex,
    stake,
    BigInt(m.fundDeadline),
    BigInt(m.playDeadline),
    m.seatSig as Hex,
  ]);
  const run2 = play2048(m.seed, 120);
  await submitScore(m.matchId, P1, run2.score, run2.replay);
  console.log(
    "✓ el mismo jugador, ya depositado, SÍ envía:",
    true,
    `(rival ${m2.matchId === m.matchId ? "emparejado" : "?"})`,
  );

  console.log("\nGUARDA DE DEPÓSITO ON-CHAIN VERIFICADA ✅");
}

/** EL GANADOR SE ADELANTA AL ÁRBITRO. `settle` es permissionless y la web
 *  todavía muestra el botón de cobrar: el ganador puede presentar la MISMA
 *  firma mientras viaja la del árbitro. La suya entra primero, la del árbitro
 *  revierte ya minada, y el árbitro tiene que leer la cadena y darla por
 *  liquidada por otro ("external"), sin reintentar ni tomarla como propia. */
async function winnerBeatsTheArbiter() {
  console.log("\n--- El ganador presenta la firma mientras viaja la del árbitro ---");
  const stake = 5_000_000n;
  await fundBoth(stake);
  const m1 = await matchmake("2048", 5, P1);
  const m2 = await matchmake("2048", 5, P2);
  await openAndJoin(m1, m2, stake);
  const sA = play2048(m1.seed, 500);
  await submitScore(m1.matchId, P1, sA.score, sA.replay);
  const b1 = await bal(P1);

  const sB = play2048(m2.seed, 12);
  let arbiterTx: Hex | undefined;
  let winnerTx: Hex;
  await anvil.setAutomine(false);
  try {
    // La decisión dispara el settle del árbitro, que se queda en el mempool.
    const res = await submitScore(m2.matchId, P2, sB.score, sB.replay);
    if (!res.signature || res.signatureDeadline === undefined) {
      fail("la vista del que cerró la partida no trae la firma y su vencimiento");
    }
    arbiterTx = await pendingFrom(ARBITER);
    if (!arbiterTx) fail("el settle del árbitro nunca llegó al mempool");
    // El ganador, con la firma de SU vista, y más propina.
    const own = getMatch(m1.matchId, P1)!;
    winnerTx = await p1.writeContract({
      address: ESCROW,
      abi: escrowAbi,
      functionName: "settle",
      args: [m1.matchId, own.winner as Hex, BigInt(own.signatureDeadline!), own.signature!],
      chain: foundry,
      ...AHEAD,
    });
    await anvil.mine({ blocks: 1 });
  } finally {
    await anvil.setAutomine(true);
  }
  const mine = await pub.getTransactionReceipt({ hash: winnerTx });
  const theirs = await pub.getTransactionReceipt({ hash: arbiterTx });
  if (mine.status !== "success" || theirs.status !== "reverted") {
    fail(`la carrera no se reprodujo: ganador ${mine.status}, árbitro ${theirs.status}`);
  }
  console.log("✓ el settle del árbitro se minó REVERTIDO:", arbiterTx);

  await onchainSettled(m1.matchId);
  const v = getMatch(m1.matchId, P1)!;
  if (v.settleOutcome !== "external" || v.settleTx) {
    fail(`esperaba settleOutcome "external" sin hash propio: ${v.settleOutcome} / ${v.settleTx}`);
  }
  if ((await bal(P1)) - b1 !== 8_500_000n) fail("el ganador no cobró exactamente una vez");
  console.log("✓ el árbitro la dio por liquidada por otro (external); el ganador cobró una vez");
  console.log("\nGANADOR ADELANTADO AL ÁRBITRO VERIFICADO ✅");
}

/** EL GANADOR EN LA BLACKLIST DE USDC (v2). Circle bloquea al ganador después
 *  de depositar: en la v1 el `settle` revertía y la plata quedaba trabada. Ahora
 *  el árbitro liquida igual, la comisión sale, el premio queda ACREDITADO, y el
 *  ganador lo retira cuando sale de la blacklist. */
async function blacklistedWinner() {
  console.log("\n--- Ganador en la blacklist de USDC (crédito y retiro) ---");
  const stake = 10_000_000n;
  await fundBoth(stake);
  const m1 = await matchmake("2048", 10, P1);
  const m2 = await matchmake("2048", 10, P2);
  await openAndJoin(m1, m2, stake);
  const [b1, bP] = await Promise.all([bal(P1), bal(PLATFORM)]);
  await send(owner, USDC, blacklistAbi as unknown as Abi, "blacklist", [P1, true]);

  const sA = play2048(m1.seed, 500);
  await submitScore(m1.matchId, P1, sA.score, sA.replay);
  const sB = play2048(m2.seed, 12);
  await submitScore(m2.matchId, P2, sB.score, sB.replay);
  await onchainSettled(m1.matchId);

  const v = getMatch(m1.matchId, P1)!;
  if (!v.settleTx) fail("el árbitro no liquidó con el ganador en la blacklist");
  const status = (await readMatchOnchain(m1.matchId as Hex))?.status;
  if (status !== ONCHAIN_STATUS.Settled) fail(`esperaba Settled, está en ${status}`);
  const prize = 17_000_000n; // 20 USDC de pozo, 15 % de comisión
  if ((await owed(P1)) !== prize || (await bal(P1)) !== b1) {
    fail("el premio tenía que quedar acreditado, sin llegar a la wallet bloqueada");
  }
  if ((await bal(PLATFORM)) - bP !== 3_000_000n) fail("la comisión tenía que salir igual");
  console.log("✓ liquidada igual: comisión pagada, premio acreditado (owed):", usd(prize), "USDC");

  await send(owner, USDC, blacklistAbi as unknown as Abi, "blacklist", [P1, false]);
  // Cualquiera se lo entrega a su dueño; la plata va SOLO al acreedor.
  await send(owner, ESCROW, escrowAbi, "withdrawFor", [P1]);
  if ((await bal(P1)) - b1 !== prize || (await owed(P1)) !== 0n) {
    fail("al salir de la blacklist, el retiro no le entregó el premio");
  }
  console.log("✓ fuera de la blacklist, withdrawFor le entregó el premio");
  console.log("\nCRÉDITO DE RESPALDO (1v1) VERIFICADO ✅");
}

// UN REVERT MINADO NO ES UN REEMBOLSO. Los tests del árbitro prueban la
// decisión con un nodo de mentira; esto la cruza con un nodo de verdad. Se
// llama a `cancelMatchOnchain` directo porque es ahí donde se decide: sus tres
// llamadores (empate, mesa sin rival, partida vencida) solo loguean el error.
//
// Por lo mismo, estas partidas no pasan por `matchmake`: se abren con un id
// nuevo y el asiento firmado directo. Emparejar dejaría a P1 esperando rival en
// la cola del árbitro, y el próximo `matchmake` de P1 en esa mesa le devolvería
// esa misma partida, ya reembolsada ("match exists" al abrir).

// Control de anvil (minado automático, mempool y reloj).
const anvil = createTestClient({ mode: "anvil", chain: foundry, transport: http(RPC) });
const ARBITER = privateKeyToAccount(process.env.ARBITER_PRIVATE_KEY as Hex).address.toLowerCase();

// `refundUnfunded` no está en el ABI del árbitro (él nunca la llama): acá sí,
// para que el jugador se reembolse mientras viaja el cancel.
const refundUnfundedAbi = [
  {
    type: "function",
    name: "refundUnfunded",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

function fail(msg: string): never {
  console.log(`\n❌ ${msg}`);
  process.exit(1);
}

const chainNow = async () => (await pub.getBlock()).timestamp;
const freshMatchId = () => ("0x" + randomBytes(32).toString("hex")) as Hex;

// Gas y fees fijos para la transacción que se adelanta: nada se estima contra
// un bloque donde ya espera el cancel del árbitro, y la propina alcanza de
// sobra para minarse primero.
const AHEAD = {
  gas: 300_000n,
  maxFeePerGas: parseGwei("100"),
  maxPriorityFeePerGas: parseGwei("100"),
};

/** La primera transacción de `from` que espera en el mempool (sin minado
 *  automático), o undefined si no llega en ~30 s. */
async function pendingFrom(from: string): Promise<Hex | undefined> {
  for (let i = 0; i < 300; i++) {
    const { pending } = await anvil.getTxpoolContent();
    const [tx] = Object.entries(pending)
      .filter(([addr]) => addr.toLowerCase() === from)
      .flatMap(([, byNonce]) => Object.values(byNonce));
    if (tx?.hash) return tx.hash;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

/** Sin minado automático, el cancel del árbitro (ya simulado) se queda
 *  esperando en el mempool. Ahí `ahead` manda la suya con más propina: anvil
 *  ordena por propina, así que las dos entran en el mismo bloque con la de
 *  `ahead` primero, y el cancel revierte YA MINADO. Devuelve el hash del cancel
 *  y cómo terminó la llamada del árbitro (el error, o null si resolvió). */
async function raceTheCancel(matchId: Hex, ahead: () => Promise<Hex>, blockTimestamp?: bigint) {
  let arbiterTx: Hex | undefined;
  let aheadTx: Hex;
  let outcome: Promise<Error | null>;
  await anvil.setAutomine(false);
  try {
    outcome = cancelMatchOnchain(matchId).then(
      () => null,
      (e: Error) => e,
    );
    arbiterTx = await pendingFrom(ARBITER);
    if (!arbiterTx) throw new Error("el cancel del árbitro nunca llegó al mempool");
    aheadTx = await ahead();
    if (blockTimestamp !== undefined) {
      await anvil.setNextBlockTimestamp({ timestamp: blockTimestamp });
    }
    await anvil.mine({ blocks: 1 });
  } finally {
    await anvil.setAutomine(true);
  }

  const first = await pub.getTransactionReceipt({ hash: aheadTx });
  const cancel = await pub.getTransactionReceipt({ hash: arbiterTx });
  if (
    first.status !== "success" ||
    cancel.status !== "reverted" ||
    first.blockNumber !== cancel.blockNumber
  ) {
    fail(
      `la carrera no se reprodujo: la que se adelanta ${first.status} (bloque ${first.blockNumber}), el cancel ${cancel.status} (bloque ${cancel.blockNumber})`,
    );
  }
  console.log("✓ el cancel del árbitro se minó REVERTIDO:", arbiterTx);
  return { arbiterTx, error: await outcome };
}

/** El rival se UNE mientras viaja el cancel: la partida sigue cancelable y
 *  hay que insistir. El cancel se estimó con la partida Open (UN depósito que
 *  devolver); el join entra antes, la deja Funded, y el cancel se queda sin gas
 *  al devolver dos. Es la forma directa de producir en anvil un revert minado
 *  que NO cierra la partida.
 *
 *  Depende de que anvil estime el gas justo, sin margen. Si una versión futura
 *  agregara margen, el cancel alcanzaría para devolver los dos y esto fallaría
 *  siempre con "la carrera no se reprodujo". Por eso CI fija la versión de
 *  Foundry (ci.yml): hay que revisar esto al subirla. */
async function rivalJoinsWhileCancelTravels() {
  console.log("\n--- Revert minado: el rival se une mientras viaja el cancel del árbitro ---");
  const stake = 2_000_000n;
  await send(owner, ESCROW, escrowAbi, "setAllowedStake", [stake, true]);
  await send(owner, USDC, erc20Abi, "mint", [P1, stake]);
  await send(owner, USDC, erc20Abi, "mint", [P2, stake]);
  await send(p1, USDC, erc20Abi, "approve", [ESCROW, stake]);
  await send(p2, USDC, erc20Abi, "approve", [ESCROW, stake]);
  const [b1, b2, bE] = await Promise.all([bal(P1), bal(P2), bal(ESCROW)]);

  const id = freshMatchId();
  const now = await chainNow();
  const terms = { stake, fundDeadline: now + 3600n, playDeadline: now + 7200n };
  const seat1 = await signSeat(id, P1, terms);
  await send(p1, ESCROW, escrowAbi, "open", [
    id,
    stake,
    terms.fundDeadline,
    terms.playDeadline,
    seat1,
  ]);

  const seat2 = await signSeat(id, P2, terms);
  const { error } = await raceTheCancel(id, () =>
    p2.writeContract({
      address: ESCROW,
      abi: escrowAbi,
      functionName: "join",
      args: [id, seat2],
      chain: foundry,
      ...AHEAD,
    }),
  );
  if (error) fail(`el árbitro no reintentó un reembolso que se seguía debiendo: ${error.message}`);
  const status = (await readMatchOnchain(id))?.status;
  if (status !== ONCHAIN_STATUS.Refunded) fail(`esperaba la partida Refunded, está en ${status}`);
  if ((await bal(P1)) !== b1 || (await bal(P2)) !== b2 || (await bal(ESCROW)) !== bE) {
    fail("reintento: los balances no vuelven al inicio");
  }
  console.log("✓ el árbitro vio la partida Funded, reintentó y reembolsó a los dos");
  console.log("\nREVERT MINADO DEL CANCEL (SE REINTENTA) VERIFICADO ✅");
}

/** El jugador se REEMBOLSA mientras viaja el cancel: ya no hay nada que
 *  cancelar y hay que cortar, pero sin tomarlo como reembolso propio. Es la
 *  carrera más probable: el barrendero cancela la mesa sin rival al vencer la
 *  espera (1 h) y /recover le habilita a P1 `refundUnfunded` al vencer el
 *  plazo de fondeo (1 h desde que abrió): casi el mismo momento. */
async function refundedWhileCancelTravels() {
  console.log(
    "\n--- Revert minado: el jugador se reembolsa mientras viaja el cancel del árbitro ---",
  );
  const stake = 2_000_000n;
  await send(owner, ESCROW, escrowAbi, "setAllowedStake", [stake, true]);
  await send(owner, USDC, erc20Abi, "mint", [P1, stake]);
  await send(p1, USDC, erc20Abi, "approve", [ESCROW, stake]);
  const [b1, bE] = await Promise.all([bal(P1), bal(ESCROW)]);

  const id = freshMatchId();
  // Plazo de fondeo corto, medido con el reloj de la cadena: el bloque de la
  // carrera se mina ya vencido, que es cuando `refundUnfunded` vale.
  const fund = (await chainNow()) + 60n;
  const seat = await signSeat(id, P1, { stake, fundDeadline: fund, playDeadline: fund + 60n });
  await send(p1, ESCROW, escrowAbi, "open", [id, stake, fund, fund + 60n, seat]);

  const { arbiterTx, error } = await raceTheCancel(
    id,
    () =>
      p1.writeContract({
        address: ESCROW,
        abi: refundUnfundedAbi,
        functionName: "refundUnfunded",
        args: [id],
        chain: foundry,
        ...AHEAD,
      }),
    fund + 1n,
  );
  if (!error) fail("el árbitro tomó como reembolso propio un cancel que se minó revertido");
  if (
    !error.message.toLowerCase().includes(arbiterTx.toLowerCase()) ||
    !/Refunded/.test(error.message)
  ) {
    fail(`el error tiene que decir el hash revertido y el estado: ${error.message}`);
  }
  console.log("✓ el cancel sale con error, con el hash y el estado:", error.message);
  if ((await bal(P1)) !== b1 || (await bal(ESCROW)) !== bE) {
    fail("corte: P1 no recuperó su depósito exactamente una vez");
  }
  console.log("✓ P1 recuperó su depósito una sola vez (el suyo); escrow sin cambios");
  console.log("\nREVERT MINADO DEL CANCEL (SE CORTA) VERIFICADO ✅");
}

main().catch((e) => {
  console.error("Error:", (e as { shortMessage?: string }).shortMessage || (e as Error).message);
  process.exit(1);
});
