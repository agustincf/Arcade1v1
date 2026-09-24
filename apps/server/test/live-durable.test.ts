// NADA SE REVELA ANTES DE QUEDAR GUARDADO (Flappy en vivo, antes de mainnet).
// Una caída dura del árbitro (OOM, crash) después de revelar valores nuevos y
// antes de guardar rebobinaba el intento hasta 20 s: el jugador, que ya había
// visto esos tubos, podía rehacer el tramo. Ahora cada intento tiene su registro
// durable (live-store.ts) y live.ts no contesta nada nuevo hasta tenerlo
// guardado. Acá se usa un store inyectado para mirar CUÁNDO se guarda, hacerlo
// fallar y simular la caída (el blob de partidas vuelve atrás, el registro no).
// Correr: node --import tsx --test apps/server/test/live-durable.test.ts

import "../src/offline-env.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { FlappyEngine, FLAPPY_CONST } from "@arcade1v1/game-sdk/flappy";
import { SecretSource } from "@arcade1v1/game-sdk/live";
import { playFlappyLive, type FlappyLiveReply } from "@arcade1v1/game-sdk/flappy-live";
import { matchmake, submitScore, getMatch, matchRecord, sweepMatches } from "../src/matchmaking.js";
import {
  liveStart,
  liveCommit,
  restoreLiveAttempts,
  LiveUnavailableError,
  __clearLiveEnginesForTest,
  type LiveStartView,
  type LiveCommitView,
} from "../src/live.js";
import {
  setLiveRecordStoreForTest,
  __resetLiveStoreForTest,
  type LiveRecordStore,
} from "../src/live-store.js";
import type { LiveAttempt } from "../src/matchmaking.js";

RULES_V.flappy = 2;

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "1111");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);

/** Un store en memoria que deja mirar y manejar cada guardado. */
function gatedStore() {
  const saved = new Map<string, string>();
  let gate: Promise<void> | null = null;
  let open: () => void = () => {};
  let failures = 0;
  const f = {
    saved,
    saves: 0,
    /** Los guardados siguientes esperan hasta `release()`. */
    hold() {
      gate = new Promise<void>((r) => (open = r));
    },
    release() {
      gate = null;
      open();
    },
    /** Los próximos `n` guardados fallan (Upstash caído). */
    failTimes(n: number) {
      failures = n;
    },
    record(id: string, address: string): LiveAttempt | undefined {
      const raw = saved.get(`${id}:${address.toLowerCase()}`);
      return raw ? (JSON.parse(raw) as LiveAttempt) : undefined;
    },
    store: {
      async save(key, json) {
        f.saves++;
        if (gate) await gate;
        if (failures > 0) {
          failures--;
          throw new Error("upstash caído");
        }
        saved.set(key, json);
      },
      async loadAll() {
        return new Map(saved);
      },
      async remove(keys) {
        for (const k of keys) saved.delete(k);
      },
    } satisfies LiveRecordStore,
  };
  return f;
}

let st: ReturnType<typeof gatedStore>;
beforeEach(() => {
  st = gatedStore();
  setLiveRecordStoreForTest(st.store);
  __resetLiveStoreForTest();
});

async function livePair() {
  const p1 = addr();
  const p2 = addr();
  const m1 = await matchmake("flappy", 0, p1);
  await matchmake("flappy", 0, p2);
  return { id: m1.matchId, p1, p2 };
}

function opened(s: LiveStartView) {
  assert.equal(s.over, false);
  return s as Extract<LiveStartView, { over: false }>;
}

function flapPolicy(g: FlappyEngine, t: number): boolean {
  if (t === 0) return true;
  if (t % 2 !== 0) return false;
  const next = g.pipes.find((p) => p.x + FLAPPY_CONST.PIPE_W >= FLAPPY_CONST.BIRD_X);
  const target = (next ? next.gapY : FLAPPY_CONST.HEIGHT / 2) + 15;
  return g.birdY > target && g.birdVy > 0;
}

/** Deja correr todo lo pendiente (microtareas y un par de vueltas del loop). */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

/** Juega con el driver real, sobre el intento ya abierto `s`, hasta `commits`
 *  compromisos exitosos y corta: el intento queda ABIERTO donde quedó (y su
 *  token sigue valiendo). Devuelve el último tick comprometido. */
async function playSome(
  id: string,
  address: string,
  commits: number,
  s: Extract<LiveStartView, { over: false }>,
): Promise<number> {
  let done = 0;
  let last = s.tick;
  const stop = Object.assign(new Error("corte del test"), { status: 400 });
  await playFlappyLive({
    start: s,
    decide: flapPolicy,
    maxTicks: 5_000,
    commit: async (c) => {
      if (done >= commits) throw stop;
      const reply = (await liveCommit(id, address, { token: s.token, ...c })) as FlappyLiveReply;
      if (!reply.conflict) {
        done++;
        last = reply.tick;
      }
      return reply;
    },
  }).catch((e) => {
    if (e !== stop) throw e;
  });
  return last;
}

test("abrir no devuelve ni el token ni el primer tubo hasta que el intento quedó guardado", async () => {
  const { id, p1 } = await livePair();
  st.hold();
  let answered = false;
  const pending = liveStart(id, p1).then((v) => {
    answered = true;
    return v;
  });
  await settle();
  assert.equal(answered, false, "sin el guardado no sale nada");
  assert.equal(st.saves, 1);
  st.release();
  const s = opened(await pending);
  const rec = st.record(id, p1)!;
  assert.equal(rec.revealed, s.revealed, "lo revelado es lo que quedó guardado");
  assert.equal(rec.tick, s.tick);
  assert.ok(rec.tokenHash, "con el hash del token que se entregó");
});

test("cada compromiso que revela valores nuevos los guarda ANTES de contestar", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  let checked = 0;
  // Las violaciones se juntan y se afirman al final: una aserción que tirara
  // DENTRO de `commit` la reintentaría el driver (un error sin status es
  // "pasajero"), y el reintento, que ya se resincroniza guardando, la taparía.
  const violations: string[] = [];
  await playFlappyLive({
    start: s,
    decide: flapPolicy,
    maxTicks: 3_000,
    commit: async (c) => {
      const reply = (await liveCommit(id, p1, { token: s.token, ...c })) as FlappyLiveReply;
      // En el instante de la respuesta, el registro ya tiene todo lo revelado.
      const rec = st.record(id, p1)!;
      if (rec.revealed < reply.revealed)
        violations.push(`revelados ${reply.revealed}, guardados ${rec.revealed}`);
      if (!reply.conflict && rec.tick !== reply.tick)
        violations.push(`tramo hasta ${reply.tick}, guardado hasta ${rec.tick}`);
      if (reply.over && rec.over !== true) violations.push("final sin guardar");
      checked++;
      return reply;
    },
  });
  assert.deepEqual(violations, [], "nada sale antes de quedar guardado");
  assert.ok(checked > 3, `se comprobaron ${checked} compromisos`);
});

test("si guardar falla, no revela nada (503); el reintento se resincroniza y recién ahí revela", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  const secret = matchRecord(id)!.liveSecret!;
  // El primer compromiso que necesita azar nuevo: hasta que el próximo tubo
  // entra en el margen.
  const body = { token: s.token, from: 0, to: 60, flaps: [0, 20, 40], have: s.revealed };
  st.failTimes(1);
  await assert.rejects(
    () => liveCommit(id, p1, body),
    (e: Error) => e instanceof LiveUnavailableError,
  );
  const before = st.record(id, p1)!;
  assert.equal(before.tick, 0, "el registro sigue en la apertura: nada nuevo quedó guardado");

  // El cliente reintenta el MISMO compromiso: el árbitro ya había avanzado en
  // memoria, así que contesta el conflicto con su tick, ahora sí guardado.
  const retry = (await liveCommit(id, p1, body)) as Extract<LiveCommitView, { conflict: true }>;
  assert.equal(retry.conflict, true);
  assert.equal(retry.tick, 60);
  const rec = st.record(id, p1)!;
  assert.equal(rec.tick, 60, "guardado antes de contestar");
  assert.equal(rec.revealed, retry.revealed);
  // Y lo revelado es exactamente lo que sale del secreto, desde lo que ya tenía.
  assert.deepEqual(retry.reveal, new SecretSource(secret).slice(s.revealed, retry.revealed));
});

test("tras una caída dura, el intento vuelve desde su registro, no desde el blob atrasado", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  const m = matchRecord(id)!;
  // Lo que tenía el blob de partidas: el intento recién abierto (el blob se
  // guarda cada 20 s, y ya no en cada compromiso).
  const blobCopy = structuredClone(m.live![p1]);
  const reached = await playSome(id, p1, 4, s);
  assert.ok(reached > s.tick);

  // LA CAÍDA: la memoria vuelve a lo que tenía el blob, se pierde el caché de
  // motores y lo que el proceso sabía que había guardado.
  m.live![p1] = blobCopy;
  __clearLiveEnginesForTest();
  __resetLiveStoreForTest();
  await restoreLiveAttempts();

  assert.equal(m.live![p1].tick, reached, "el intento vuelve donde llegó, no a la apertura");
  // Un cliente que quisiera rehacer desde la apertura recibe el conflicto con
  // el tick guardado: no puede volver a jugar lo que ya jugó.
  const again = (await liveCommit(id, p1, {
    token: s.token,
    from: 0,
    to: 30,
    flaps: [0],
    have: 0,
  })) as Extract<LiveCommitView, { conflict: true }>;
  assert.equal(again.conflict, true);
  assert.equal(again.tick, reached);
});

test("un intento que terminó sin llegar al blob se completa al arrancar, y la partida se liquida", async () => {
  const { id, p1, p2 } = await livePair();
  // p2 juega entero primero; la partida queda esperando a p1.
  const s2 = opened(await liveStart(id, p2));
  await playFlappyLive({
    start: s2,
    decide: flapPolicy,
    maxTicks: 3_000,
    commit: async (c) => (await liveCommit(id, p2, { token: s2.token, ...c })) as FlappyLiveReply,
  });
  const m = matchRecord(id)!;
  const s1 = opened(await liveStart(id, p1));
  // El blob de partidas, tal como estaba con p1 recién abierto.
  const blob = structuredClone({
    live: m.live,
    scores: m.scores,
    replays: m.replays,
    status: m.status,
  });
  await playFlappyLive({
    start: s1,
    decide: flapPolicy,
    maxTicks: 3_000,
    commit: async (c) => (await liveCommit(id, p1, { token: s1.token, ...c })) as FlappyLiveReply,
  });
  const decided = getMatch(id, p1)!;
  assert.equal(decided.status === "settled" || decided.status === "draw", true);
  const finalScore = st.record(id, p1)!.score;

  // LA CAÍDA, justo después de contestar el final y antes de que el blob lo guardara.
  Object.assign(m, structuredClone(blob));
  delete m.winner;
  delete m.outcome;
  delete m.signature;
  delete m.eloUpdate;
  assert.equal(m.scores[p1], undefined);
  __clearLiveEnginesForTest();
  __resetLiveStoreForTest();
  await restoreLiveAttempts();

  assert.equal(m.live![p1].over, true, "el intento vuelve cerrado");
  assert.equal(m.scores[p1], finalScore, "con el puntaje que el jugador vio");
  const after = getMatch(id, p1)!;
  assert.equal(after.status, decided.status, "y la partida se decide igual que antes");
});

test("dos compromisos a la vez del mismo intento se atienden de a uno: uno avanza, el otro resincroniza", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  const body = { token: s.token, from: 0, to: 60, flaps: [0, 20, 40], have: s.revealed };
  const before = st.saves;
  st.hold();
  const a = liveCommit(id, p1, body);
  const b = liveCommit(id, p1, body);
  await settle();
  assert.equal(st.saves, before + 1, "el segundo espera su turno: no avanza el motor a la vez");
  st.release();
  const [ra, rb] = await Promise.all([a, b]);
  const conflicts = [ra, rb].filter((r) => r.conflict).length;
  assert.equal(conflicts, 1, "exactamente uno se resincroniza");
  assert.equal(st.record(id, p1)!.tick, 60);
});

test("la rendición de un juego en vivo sale guardada, y si no se pudo guardar se reintenta", async () => {
  const { id, p1 } = await livePair();
  opened(await liveStart(id, p1));
  const forfeit = { ticks: 0, flaps: [], v: RULES_V.flappy };
  st.failTimes(1);
  await assert.rejects(
    () => submitScore(id, p1, 0, forfeit),
    (e: Error) => e instanceof LiveUnavailableError,
  );
  assert.equal(matchRecord(id)!.live![p1].over, undefined, "sin guardar, el intento sigue abierto");
  await submitScore(id, p1, 0, forfeit);
  const rec = st.record(id, p1)!;
  assert.equal(rec.over, true);
  assert.equal(rec.score, 0);
  assert.equal(matchRecord(id)!.scores[p1], 0);
});

test("un cierre que no se pudo guardar y nadie reintentó lo completa el barrendero", async () => {
  const { id, p1 } = await livePair();
  const s = opened(await liveStart(id, p1));
  // El final del intento (final: true) justo cuando el store falla, y el
  // cliente no vuelve (cerró la pestaña).
  st.failTimes(1);
  await assert.rejects(
    () =>
      liveCommit(id, p1, {
        token: s.token,
        from: 0,
        to: 30,
        flaps: [0],
        have: s.revealed,
        final: true,
      }),
    (e: Error) => e instanceof LiveUnavailableError,
  );
  const m = matchRecord(id)!;
  assert.equal(m.live![p1].over, true, "cerrado en memoria");
  assert.equal(m.scores[p1], undefined, "pero sin puntaje en la partida");
  assert.equal(st.record(id, p1)!.over, undefined, "ni guardado");

  sweepMatches(Date.now());
  await settle();
  assert.equal(st.record(id, p1)!.over, true, "el barrendero lo guardó");
  assert.equal(m.scores[p1], m.live![p1].score, "y anotó el puntaje");
});
