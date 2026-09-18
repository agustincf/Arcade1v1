// El SDK REAL contra las rutas REALES: dos agentes juegan Flappy en vivo con
// playAndSubmit y cada uno llega al MISMO puntaje que la estrategia jugada de un
// tirón con el secreto que se publica al decidir. Es la prueba de que la
// estrategia no usaba información del futuro. Además, el SDK comprueba el
// secreto publicado contra lo que el árbitro comprometió y reveló.
//
// Correr: node --import tsx --test apps/server/test/live-sdk-e2e.test.ts

import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { FlappyEngine, FLAPPY_DT } from "@arcade1v1/game-sdk/flappy";
import { SecretSource, checkLiveReveals, liveSecretHash } from "@arcade1v1/game-sdk/live";
import { ArbiterClient, createAgent } from "@arcade1v1/agent-sdk";
import { getStrategy, defaultParams } from "@arcade1v1/strategies";

process.env.REQUIRE_AUTH = "true"; // como en producción
RULES_V.flappy = 2;
const { matchmake, getMatch } = await import("../src/matchmaking.js");
const { liveRouter } = await import("../src/live-routes.js");

// Las dos rutas de index.ts que usa playAndSubmit, más el router en vivo.
const pass: express.RequestHandler = (_req, _res, next) => next();
const app = express();
app.use(express.json());
app.post("/matchmake", async (req, res) => {
  const { game, stake, address, signature, ts } = req.body ?? {};
  try {
    res.json(await matchmake(game, stake, address, signature ? { signature, ts } : undefined));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
app.get("/match/:id", (req, res) => {
  const v = getMatch(req.params.id, req.query.address ? String(req.query.address) : undefined);
  if (!v) return res.status(404).json({ error: "match not found" });
  res.json(v);
});
app.use(liveRouter({ start: pass, commit: pass }));
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

/** La estrategia por defecto jugada de un tirón, con todo el azar a la vista. */
function batchWithSecret(secret: string): number {
  const def = getStrategy("flappy.threshold")!;
  const step = def.step!(defaultParams(def));
  const g = new FlappyEngine(new SecretSource(secret));
  for (let t = 0; t < step.maxTicks && !g.over; t++) {
    if (step.decide(g, t)) g.flap();
    g.update(FLAPPY_DT);
  }
  return g.score;
}

test("dos agentes del SDK juegan Flappy en vivo; cada puntaje es el de la estrategia de un tirón", async () => {
  const a = createAgent({ arbiterUrl: BASE });
  const b = createAgent({ arbiterUrl: BASE });

  const va = await a.playAndSubmit({ game: "flappy", stake: 0 });
  assert.equal(va.live, true);
  assert.equal(va.secret, undefined, "sin decidir, el secreto no sale del árbitro");
  assert.match(String(va.secretHash), /^[0-9a-f]{64}$/);
  assert.equal(typeof va.scores[a.address.toLowerCase()], "number", "su intento cerró");
  assert.equal(va.liveReceipt?.secretHash, va.secretHash, "guarda el compromiso");
  assert.ok(va.liveReceipt!.reveals.length > 0, "y todo lo que le revelaron");

  const vb = await b.playAndSubmit({ game: "flappy", stake: 0 });
  assert.ok(vb.status === "settled" || vb.status === "draw", `estado: ${vb.status}`);
  assert.equal(liveSecretHash(vb.secret!), va.secretHash, "el secreto es el comprometido");
  assert.deepEqual(
    va.liveReceipt!.reveals,
    new SecretSource(vb.secret!).slice(0, va.liveReceipt!.reveals.length),
    "lo que le revelaron a A salió del secreto",
  );

  const expected = batchWithSecret(vb.secret!);
  assert.equal(vb.scores[a.address.toLowerCase()], expected);
  assert.equal(vb.scores[b.address.toLowerCase()], expected);
});

test("si el árbitro publica un secreto que no es el comprometido, el SDK lo dice", async () => {
  const honest = createAgent({ arbiterUrl: BASE });
  await honest.playAndSubmit({ game: "flappy", stake: 0 });

  // Un "árbitro" que al decidir publica otro secreto (bien formado).
  const lying: typeof fetch = async (input, init) => {
    const r = await fetch(input, init);
    if (!String(input).includes("/match/") || String(input).includes("/live/")) return r;
    const body = (await r.json()) as Record<string, unknown>;
    if (body.secret) body.secret = "00".repeat(32);
    return new Response(JSON.stringify(body), { status: r.status });
  };
  const victim = createAgent({
    client: new ArbiterClient(BASE, { fetchImpl: lying }),
  });
  await assert.rejects(
    victim.playAndSubmit({ game: "flappy", stake: 0 }),
    /does not match what the arbiter committed/,
  );
});

/** Un fetch que cuenta los pedidos por ruta y deja tocar cada uno antes de
 *  mandarlo (`edit`) o la respuesta antes de devolverla (`reply`). */
function spyFetch(
  opts: {
    edit?: (path: string, body: Record<string, unknown>) => void;
    reply?: (path: string, body: Record<string, unknown>) => void;
  } = {},
) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    let body = init?.body;
    if (opts.edit && typeof body === "string") {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      opts.edit(path, parsed);
      body = JSON.stringify(parsed);
    }
    const r = await fetch(input, { ...init, body });
    if (!opts.reply || !r.ok) return r;
    const parsed = (await r.json()) as Record<string, unknown>;
    opts.reply(path, parsed);
    return new Response(JSON.stringify(parsed), { status: r.status });
  };
  return { calls, fetchImpl };
}

test("una estrategia de semilla en un juego en vivo se rechaza con el motivo, ANTES de emparejar", async () => {
  const spy = spyFetch();
  const c = createAgent({ client: new ArbiterClient(BASE, { fetchImpl: spy.fetchImpl }) });
  await assert.rejects(
    c.playAndSubmit({ game: "flappy", stake: 0, strategy: () => ({ score: 0, replay: {} }) }),
    /played live/,
  );
  assert.deepEqual(spy.calls, [], "no dejó una partida emparejada sin jugar");
});

test("si un compromiso se rechaza a mitad de partida, retoma el intento y termina igual", async () => {
  // El tercer compromiso sale con un token viejo (como si otro proceso de la
  // misma wallet hubiera reabierto el intento): el árbitro lo rechaza de verdad.
  let commits = 0;
  const spy = spyFetch({
    edit: (path, body) => {
      if (path.endsWith("/live/commit") && ++commits === 3) body.token = "0".repeat(64);
    },
  });
  const a = createAgent({ client: new ArbiterClient(BASE, { fetchImpl: spy.fetchImpl }) });
  const b = createAgent({ arbiterUrl: BASE });

  const va = await a.playAndSubmit({ game: "flappy", stake: 0 });
  assert.equal(spy.calls.filter((p) => p.endsWith("/live/start")).length, 2, "retomó una vez");
  const vb = await b.playAndSubmit({ game: "flappy", stake: 0 });
  assert.equal(vb.matchId, va.matchId);
  const expected = batchWithSecret(vb.secret!);
  assert.equal(vb.scores[a.address.toLowerCase()], expected, "el corte no cambió la partida");
  assert.ok(
    checkLiveReveals(vb.secret!, va.secretHash!, va.liveReceipt!.reveals),
    "el recibo sigue siendo la serie revelada, en orden",
  );
});

test("si la partida se decide y el árbitro no publica el secreto, el SDK lo dice", async () => {
  const honest = createAgent({ arbiterUrl: BASE });
  await honest.playAndSubmit({ game: "flappy", stake: 0 });
  const hiding = spyFetch({
    reply: (path, body) => {
      if (!path.includes("/live/")) delete body.secret;
    },
  });
  const victim = createAgent({ client: new ArbiterClient(BASE, { fetchImpl: hiding.fetchImpl }) });
  await assert.rejects(
    victim.playAndSubmit({ game: "flappy", stake: 0 }),
    /did not publish its secret/,
  );
});
