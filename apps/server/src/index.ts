// Servidor "arbitro": emparejamiento + decision + firma de resultados.
// API simple por HTTP (los juegos son asincronicos, no hace falta tiempo real).

import "dotenv/config";
import express from "express";
import { matchmake, submitScore, getMatch, addBot } from "./matchmaking.js";
import { arbiterAddress } from "./sign.js";

const app = express();
app.use(express.json());

// CORS basico para el frontend (localhost durante el desarrollo).
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});
app.options("/*splat", (_req, res) => res.sendStatus(204));

app.get("/health", (_req, res) => res.json({ ok: true }));

// API auto-descriptiva: un agente que pega a la raiz aprende como usarla.
app.get("/", (_req, res) =>
  res.json({
    name: "Arcade1v1 arbiter API",
    description:
      "1v1 asynchronous score-based games. Open to autonomous AI agents. Results are verified by replay (anti-cheat).",
    arbiter: arbiterAddress(),
    agentReadyGames: ["2048"],
    sharedEngine: "@arcade1v1/game-sdk",
    endpoints: {
      "POST /matchmake": "{ game, stake, address } -> { matchId, seed, status }",
      "POST /match/:id/score":
        "{ address, score, replay:{seed,moves} } -> verifies & settles",
      "GET /match/:id?address=":
        "match status; when settled returns { winner, signature }",
    },
    guide: "See AGENTS.md in the repository.",
  }),
);

// Direccion publica del arbitro (debe coincidir con la del contrato).
app.get("/arbiter", (_req, res) => res.json({ address: arbiterAddress() }));

// Emparejar: el 2do en llegar se junta con el 1ro.
app.post("/matchmake", (req, res) => {
  const { game, stake, address } = req.body ?? {};
  if (!game || !stake || !address) {
    return res.status(400).json({ error: "faltan game, stake o address" });
  }
  res.json(matchmake(String(game), Number(stake), String(address)));
});

// Enviar puntaje. Cuando estan los dos, decide y firma.
app.post("/match/:id/score", async (req, res) => {
  try {
    const { address, score, replay, signature } = req.body ?? {};
    const out = await submitScore(
      req.params.id,
      String(address),
      Number(score),
      replay,
      signature,
    );
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// Completar la partida contra un bot (SOLO pruebas en solitario).
// Apagado en produccion salvo que se active con ENABLE_TEST_BOT=true.
app.post("/match/:id/bot", async (req, res) => {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_TEST_BOT !== "true"
  ) {
    return res.status(403).json({ error: "test bot disabled in production" });
  }
  try {
    res.json(await addBot(req.params.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// Consultar estado/resultado de una partida.
app.get("/match/:id", (req, res) => {
  const m = getMatch(req.params.id, req.query.address as string | undefined);
  if (!m) return res.status(404).json({ error: "match not found" });
  res.json(m);
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Arbitro escuchando en http://localhost:${port}`);
  console.log(`Direccion del arbitro: ${arbiterAddress()}`);
});
