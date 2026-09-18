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
import { SecretSource, liveSecretHash } from "@arcade1v1/game-sdk/live";
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

test("una estrategia de semilla en un juego en vivo se rechaza con el motivo", async () => {
  const c = createAgent({ arbiterUrl: BASE });
  await assert.rejects(
    c.playAndSubmit({ game: "flappy", stake: 0, strategy: () => ({ score: 0, replay: {} }) }),
    /played live/,
  );
});
