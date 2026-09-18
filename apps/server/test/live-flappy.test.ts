// El protocolo EN VIVO del árbitro (Flappy): abrir un intento único, comprometer
// jugadas y recibir el azar justo, resincronizar, cerrar y liquidar. La
// propiedad central se prueba jugando con el driver real contra el árbitro real:
// nada revelado se usa más de LIVE_LEAD_TICKS después de lo comprometido.
//
// Correr: node --import tsx --test apps/server/test/live-flappy.test.ts

import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { FlappyEngine, FLAPPY_DT, FLAPPY_CONST } from "@arcade1v1/game-sdk/flappy";
import {
  LIVE_LEAD_TICKS,
  MAX_COMMIT_TICKS,
  SecretSource,
  liveSecretHash,
} from "@arcade1v1/game-sdk/live";
import {
  playFlappyLive,
  verifyFlappyLive,
  type FlappyLiveReply,
} from "@arcade1v1/game-sdk/flappy-live";
import { liveStartAuthMessage } from "@arcade1v1/game-sdk/auth";
import {
  matchmake,
  submitScore,
  getMatch,
  matchRecord,
  sweepMatches,
  MAX_REPLAY_TICKS,
  SUBMIT_WINDOW_MS,
} from "../src/matchmaking.js";
import {
  liveStart,
  liveCommit,
  __clearLiveEnginesForTest,
  type LiveStartView,
} from "../src/live.js";

RULES_V.flappy = 2;

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "0000");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);

function flapPolicy(g: FlappyEngine, t: number): boolean {
  if (t === 0) return true;
  if (t % 2 !== 0) return false;
  const next = g.pipes.find((p) => p.x + FLAPPY_CONST.PIPE_W >= FLAPPY_CONST.BIRD_X);
  const target = (next ? next.gapY : FLAPPY_CONST.HEIGHT / 2) + 15;
  return g.birdY > target && g.birdVy > 0;
}

async function livePair(game = "flappy") {
  const p1 = addr();
  const p2 = addr();
  const m1 = await matchmake(game, 0, p1);
  await matchmake(game, 0, p2);
  return { id: m1.matchId, p1, p2 };
}

function opened(s: LiveStartView) {
  assert.equal(s.over, false);
  return s as Extract<LiveStartView, { over: false }>;
}

/** Juega el intento entero con el driver real; registra (to, revealed) de cada compromiso. */
async function playLive(id: string, address: string, maxTicks = 3_000) {
  const s = opened(await liveStart(id, address));
  const log: { to: number; revealed: number }[] = [{ to: s.tick, revealed: s.revealed }];
  const result = await playFlappyLive({
    start: s,
    decide: flapPolicy,
    maxTicks,
    commit: async (c) => {
      const reply = (await liveCommit(id, address, { token: s.token, ...c })) as FlappyLiveReply;
      if (!reply.conflict) log.push({ to: reply.tick, revealed: reply.revealed });
      return reply;
    },
  });
  return { ...result, log, token: s.token };
}

test("abrir: el jugador recibe token y el primer valor; un tercero y un juego que no es en vivo no pueden", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  assert.match(s.token, /^[0-9a-f]{64}$/);
  assert.deepEqual([s.tick, s.flaps, s.revealed, s.reveal.length], [0, [], 1, 1]);
  await assert.rejects(liveStart(id, addr()), /not a player/);
  const other = await livePair("2048");
  await assert.rejects(liveStart(other.id, other.p1), /is not a live game/);
});

test("la firma, si viene, tiene que ser del jugador y reciente", async () => {
  const player = privateKeyToAccount(generatePrivateKey());
  const id = (await matchmake("flappy", 0, player.address)).matchId;
  await matchmake("flappy", 0, addr());
  const ts = Date.now();
  const good = await player.signMessage({ message: liveStartAuthMessage(id, player.address, ts) });
  assert.equal((await liveStart(id, player.address, { signature: good, ts })).over, false);
  const intruder = privateKeyToAccount(generatePrivateKey());
  const bad = await intruder.signMessage({ message: liveStartAuthMessage(id, player.address, ts) });
  await assert.rejects(liveStart(id, player.address, { signature: bad, ts }), /bad signature/);
  const old = Date.now() - 11 * 60_000;
  const stale = await player.signMessage({
    message: liveStartAuthMessage(id, player.address, old),
  });
  await assert.rejects(
    liveStart(id, player.address, { signature: stale, ts: old }),
    /auth expired/,
  );
});

test("ni el secreto ni la semilla aparecen en ninguna respuesta antes de decidir", async () => {
  const { id, p1 } = await livePair();
  const m = matchRecord(id)!;
  const seed = String(m.seed);
  const secret = String(m.liveSecret);
  assert.match(secret, /^[0-9a-f]{64}$/, "la partida en vivo nace con su secreto");
  const s = opened(await liveStart(id, p1));
  const c = await liveCommit(id, p1, {
    token: s.token,
    from: 0,
    to: 30,
    flaps: [0],
    have: s.revealed,
  });
  for (const out of [s, c, getMatch(id, p1), getMatch(id)]) {
    assert.ok(!JSON.stringify(out).includes(seed), "la semilla se filtró");
    assert.ok(!JSON.stringify(out).includes(secret), "el secreto se filtró");
  }
});

test("el azar revelado sale del secreto de 256 bits, no de la semilla numérica", async () => {
  // La semilla de 32 bits se recuperaba por fuerza bruta en ~3 s con el primer
  // valor revelado (mulberry32). Esto fija que lo revelado sale del secreto.
  const { id, p1 } = await livePair();
  const m = matchRecord(id)!;
  const s = opened(await liveStart(id, p1));
  assert.ok(s.reveal.length > 0);
  assert.deepEqual(s.reveal, new SecretSource(m.liveSecret!).slice(0, s.revealed));
});

test("un segundo abrir no reinicia: devuelve el mismo progreso, rota el token y el viejo deja de servir", async () => {
  const { id, p1 } = await livePair();
  const s1 = opened(await liveStart(id, p1));
  await liveCommit(id, p1, {
    token: s1.token,
    from: 0,
    to: 60,
    flaps: [0, 20, 40],
    have: s1.revealed,
  });
  const s2 = opened(await liveStart(id, p1));
  assert.deepEqual([s2.tick, s2.flaps], [60, [0, 20, 40]], "retoma, no reinicia");
  assert.notEqual(s2.token, s1.token);
  await assert.rejects(
    liveCommit(id, p1, { token: s1.token, from: 60, to: 70, flaps: [], have: s2.revealed }),
    /bad token/,
  );
  const ok = await liveCommit(id, p1, {
    token: s2.token,
    from: 60,
    to: 70,
    flaps: [],
    have: s2.revealed,
  });
  assert.equal(ok.tick, 70);
});

test("from desfasado: conflicto con el tick del árbitro y los valores desde have", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  const out = await liveCommit(id, p1, { token: s.token, from: 50, to: 80, flaps: [], have: 0 });
  assert.equal(out.conflict, true);
  assert.equal(out.tick, 0);
  assert.deepEqual(out.reveal, s.reveal, "reenvía todo lo revelado desde have=0");
});

test("topes: rangos y aleteos inválidos se rechazan sin avanzar el intento", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  const bad = (body: Partial<{ from: number; to: number; flaps: number[] }>) =>
    liveCommit(id, p1, { token: s.token, from: 0, to: 10, flaps: [], have: 1, ...body });
  await assert.rejects(bad({ to: 0 }), /invalid commit range/);
  await assert.rejects(bad({ to: MAX_COMMIT_TICKS + 1 }), /invalid commit range/);
  await assert.rejects(bad({ flaps: [10] }), /invalid flaps/);
  await assert.rejects(bad({ flaps: [5, 5] }), /invalid flaps/);
  await assert.rejects(bad({ flaps: [7, 3] }), /invalid flaps/);
  await assert.rejects(bad({ flaps: [1.5] }), /invalid flaps/);
  const ok = await bad({});
  assert.equal(ok.tick, 10, "después de los rechazos el intento sigue en 0 y avanza bien");
});

test("jugar en vivo contra el árbitro da el puntaje que verifica el secreto publicado, y liquida al terminar los dos", async () => {
  const { id, p1, p2 } = await livePair();
  const a = await playLive(id, p1);
  const b = await playLive(id, p2);
  const m = matchRecord(id)!;
  const view = getMatch(id, p1)!;
  assert.ok(view.status === "settled" || view.status === "draw");
  assert.equal(view.secret, m.liveSecret, "decidida: ya se puede ver el secreto");
  assert.equal(liveSecretHash(view.secret!), view.secretHash);
  for (const [player, run] of [
    [p1, a],
    [p2, b],
  ] as const) {
    const replay = m.replays[player.toLowerCase()] as { ticks: number; flaps: number[] };
    assert.equal(
      run.score,
      verifyFlappyLive(view.secret!, replay),
      "el puntaje re-verifica con el secreto publicado",
    );
  }
});

test("propiedad central: nada revelado se usa más de LIVE_LEAD_TICKS después de lo comprometido", async () => {
  for (let i = 0; i < 6; i++) {
    const { id, p1 } = await livePair();
    const run = await playLive(id, p1);
    const m = matchRecord(id)!;
    const replay = m.replays[p1.toLowerCase()] as { ticks: number; flaps: number[] };
    // En qué tick se usa cada valor en la partida real (-1: al construir el motor).
    const consumedAt: number[] = [];
    let now = -1;
    const src = new SecretSource(m.liveSecret!);
    const g = new FlappyEngine({
      next: () => {
        consumedAt.push(now);
        return src.next();
      },
    });
    const set = new Set(replay.flaps);
    for (now = 0; now < replay.ticks && !g.over; now++) {
      if (set.has(now)) g.flap();
      g.update(FLAPPY_DT);
    }
    assert.equal(g.score, run.score);
    for (const entry of run.log) {
      for (let k = 0; k < entry.revealed && k < consumedAt.length; k++) {
        assert.ok(
          consumedAt[k] <= entry.to + LIVE_LEAD_TICKS,
          `valor ${k} usado en el tick ${consumedAt[k]} y revelado con to=${entry.to}`,
        );
      }
    }
  }
});

test("final cierra con el puntaje alcanzado; después todo compromiso devuelve el cierre", async () => {
  const { id, p1 } = await livePair();
  // 120 ticks: el primer tubo recién alcanza al pájaro cerca del 159, así que
  // llega vivo sea cual sea la semilla, y el cierre es por `final`.
  const run = await playLive(id, p1, 120);
  assert.equal(run.ticks, 120, "llegó vivo al tope y cerró con final");
  const again = await liveCommit(id, p1, {
    token: run.token,
    from: 120,
    to: 130,
    flaps: [],
    have: 0,
  });
  assert.equal(again.conflict, undefined);
  assert.equal(again.over, true);
  assert.equal(again.score, run.score);
  const reopened = await liveStart(id, p1);
  assert.deepEqual(reopened, { over: true, score: run.score, tick: 120 });
});

test("rendirse con un intento abierto lo cierra con 0", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  await liveCommit(id, p1, { token: s.token, from: 0, to: 40, flaps: [0], have: s.revealed });
  await submitScore(id, p1, 0, { ticks: 0, flaps: [], v: 2 });
  const after = await liveCommit(id, p1, { token: s.token, from: 40, to: 50, flaps: [], have: 0 });
  assert.deepEqual([after.over, after.score], [true, 0]);
});

test("sin el caché de motores (un reinicio) el intento sigue exactamente igual", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  // Hasta el tick 140: el primer tubo todavía no llega al pájaro, y en los 15
  // ticks siguientes nace el segundo, así que ya hay dos valores revelados. Un
  // aleteo cada 36 ticks mantiene el vuelo casi estable (cada 18 lo estrella
  // contra el techo cerca del tick 75).
  const first = await liveCommit(id, p1, {
    token: s.token,
    from: 0,
    to: 140,
    flaps: [0, 36, 72, 108],
    have: s.revealed,
  });
  assert.deepEqual([first.over, first.tick, first.revealed], [false, 140, 2]);
  __clearLiveEnginesForTest();
  const second = await liveCommit(id, p1, {
    token: s.token,
    from: 140,
    to: 141,
    flaps: [],
    have: 0,
  });
  assert.equal(second.conflict, undefined);
  assert.equal(second.tick, 141);
  assert.deepEqual(
    second.reveal.slice(0, 2),
    [...s.reveal, ...first.reveal],
    "el motor reconstruido revela exactamente los mismos valores",
  );
});

test("llegar a MAX_REPLAY_TICKS cierra el intento", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  // Sin aletear el juego no arranca: nada muere, y el tope es lo único que cierra.
  let from = 0;
  let last;
  while (from < MAX_REPLAY_TICKS) {
    const to = Math.min(from + MAX_COMMIT_TICKS, MAX_REPLAY_TICKS);
    last = await liveCommit(id, p1, { token: s.token, from, to, flaps: [], have: 0 });
    from = last.tick;
  }
  assert.deepEqual([last!.over, last!.tick, last!.score], [true, MAX_REPLAY_TICKS, 0]);
});

// Va ÚLTIMO: el barrendero vence todas las partidas de este proceso.
test("un intento abandonado vence con la partida y ya no acepta compromisos", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  await liveCommit(id, p1, { token: s.token, from: 0, to: 30, flaps: [0], have: s.revealed });
  sweepMatches(Date.now() + SUBMIT_WINDOW_MS + 16 * 60_000);
  assert.equal(getMatch(id, p1)!.status, "draw");
  await assert.rejects(
    liveCommit(id, p1, { token: s.token, from: 30, to: 40, flaps: [], have: 0 }),
    /match already decided/,
  );
});
