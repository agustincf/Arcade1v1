// Carreras de submitScore en una MESA DE PLATA: mientras se espera la lectura
// del depósito on-chain, la partida puede decidirse o el mismo jugador puede
// cerrar su intento o mandar otro envío. Sin volver a mirar después de esa
// espera, el envío que llegaba tarde pisaba un puntaje ya guardado (y, si la
// partida ya estaba liquidada, el replay dejaba de re-verificar la victoria).
//
// Correr: node --import tsx --test apps/server/test/submit-race.test.ts

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { encodeFunctionResult } from "viem";
import { escrowAbi } from "../src/abi.js";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);

// RPC falso y LENTO: para cualquier partida, el contrato dice que A y B
// depositaron. La demora abre la ventana de la carrera.
const rpc = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const msg = JSON.parse(body);
    const one = (m: { id: number; method: string }) => {
      if (m.method === "eth_chainId") return { jsonrpc: "2.0", id: m.id, result: "0x7a69" };
      if (m.method === "eth_call") {
        const result = encodeFunctionResult({
          abi: escrowAbi,
          functionName: "matches",
          result: [A, B, 1_000_000n, true, true, 0n, 0n, 2],
        });
        return { jsonrpc: "2.0", id: m.id, result };
      }
      return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: m.method } };
    };
    const out = Array.isArray(msg) ? msg.map(one) : one(msg);
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out));
    }, 300);
  });
});
await new Promise<void>((r) => rpc.listen(0, "127.0.0.1", () => r()));
after(() => rpc.close());

// Escrow "activo" contra ese RPC. Todo ANTES de importar: onchain.ts y sign.ts
// leen estas variables al cargarse. La clave es la cuenta #1 de anvil, pública
// y sin valor (la misma de offline-env.ts).
process.env.ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "31337";
process.env.RPC_URL = `http://127.0.0.1:${(rpc.address() as AddressInfo).port}`;
process.env.ARBITER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const { RULES_V } = await import("@arcade1v1/game-sdk/rules");
RULES_V.flappy = 2;
const { FlappyEngine, FLAPPY_DT } = await import("@arcade1v1/game-sdk/flappy");
const { SecretSource } = await import("@arcade1v1/game-sdk/live");
const { verifyFlappyLive } = await import("@arcade1v1/game-sdk/flappy-live");
const { runStrategy } = await import("@arcade1v1/strategies");
const mm = await import("../src/matchmaking.js");
const live = await import("../src/live.js");

const forfeit = { ticks: 0, flaps: [], v: 2 };

test("en vivo: una rendición en vuelo no pisa el intento que el jugador ya cerró", async () => {
  const m1 = await mm.matchmake("flappy", 1, A);
  await mm.matchmake("flappy", 1, B);
  const id = m1.matchId;
  await mm.submitScore(id, B, 0, forfeit); // B se rinde: 0

  // A juega unos tubos: aletear cada 36 ticks lo mantiene vivo hasta el primero.
  const s = await live.liveStart(id, A);
  assert.equal(s.over, false);
  const token = (s as { token: string }).token;
  const flaps = [0, 36, 72, 108];
  await live.liveCommit(id, A, { token, from: 0, to: 140, flaps, have: 0 });

  // La rendición de A queda esperando el RPC mientras A cierra con `final`.
  const late = mm.submitScore(id, A, 0, forfeit);
  const closed = await live.liveCommit(id, A, {
    token,
    from: 140,
    to: 140,
    flaps: [],
    have: 0,
    final: true,
  });
  assert.equal(closed.over, true);
  await assert.rejects(late, /already submitted|already decided/);

  // El intento cerrado quedó intacto y re-verifica con el secreto.
  const m = mm.matchRecord(id)!;
  const g = new FlappyEngine(new SecretSource(m.liveSecret!));
  for (let t = 0; t < 140 && !g.over; t++) {
    if (flaps.includes(t)) g.flap();
    g.update(FLAPPY_DT);
  }
  assert.equal(m.scores[A], g.score);
  assert.deepEqual(m.replays[A], { ticks: 140, flaps, v: 2 });
  assert.equal(verifyFlappyLive(m.liveSecret!, m.replays[A] as typeof forfeit), g.score);
});

test("sin vivo: dos envíos a la vez del mismo jugador, solo el primero cuenta", async () => {
  const m1 = await mm.matchmake("2048", 1, A);
  await mm.matchmake("2048", 1, B);
  const id = m1.matchId;
  const seed = mm.matchRecord(id)!.seed;
  const run = runStrategy({ game: "2048", strategyId: "2048.priority", params: {} }, seed);
  assert.ok(run.score > 0);

  const first = mm.submitScore(id, A, run.score, run.replay);
  const second = mm.submitScore(id, A, 0, { seed, moves: [] });
  const [r1, r2] = await Promise.allSettled([first, second]);
  assert.equal(r1.status, "fulfilled");
  assert.equal(r2.status, "rejected");
  assert.match(String((r2 as PromiseRejectedResult).reason), /already submitted/);
  assert.equal(mm.matchRecord(id)!.scores[A], run.score, "el puntaje del primer envío");
});
