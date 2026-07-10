// Servidor "arbitro": emparejamiento + decision + firma de resultados.
// API simple por HTTP (los juegos son asincronicos, no hace falta tiempo real).

import "dotenv/config";
import "./persist-on.js"; // enciende la persistencia de partidas (antes de matchmaking)
import express from "express";
import {
  matchmake,
  submitScore,
  getMatch,
  addBot,
  AUTH_REQUIRED,
  recentMatches,
  publicReplay,
  restoreMatches,
} from "./matchmaking.js";
import { leaderboard, ratingsOf, restoreRatings } from "./ratings.js";
import { restoreAgents, listAgents } from "./agents.js";
import { statsSnapshot, restoreStats } from "./stats.js";
import { profilesRouter } from "./profiles-routes.js";
import { restoreProfiles, resolveDisplay } from "./profiles.js";
import { persistenceBackend } from "./persist.js";
import { arbiterAddress } from "./sign.js";
import { productionConfigErrors, parseTrustProxy } from "./config-guard.js";
import { agentsRouter } from "./agents-routes.js";
import "./agent-runner.js"; // runner de agentes hosteados (juegan solos)

// Guarda de producción (fail-fast): no arrancar con dinero real mal configurado.
const cfgErrors = productionConfigErrors();
if (cfgErrors.length) {
  console.error("❌ Configuración de producción inválida — el servidor no arranca:");
  for (const e of cfgErrors) console.error("   - " + e);
  process.exit(1);
}

const app = express();

// Detrás de un reverse proxy (típico en producción), confiar en X-Forwarded-For
// para que req.ip sea la IP real del cliente. Sin esto, el rate-limit agruparía
// a TODOS bajo la IP del proxy. Configurable con TRUST_PROXY (default: 1 salto en
// prod): "1"/"2" = saltos, "true" = confiar siempre, o una IP/subred.
const tp = parseTrustProxy(
  process.env.TRUST_PROXY ?? (process.env.NODE_ENV === "production" ? "1" : ""),
);
if (tp !== undefined) app.set("trust proxy", tp);

app.use(express.json({ limit: "256kb" }));

// CORS: en produccion restringir a tu(s) dominio(s) con ALLOWED_ORIGIN. Acepta
// UNO o VARIOS orígenes separados por coma (ej. dominio propio + el de Vercel
// durante la transición). El header CORS admite un solo valor, así que
// devolvemos el origen del pedido si está en la lista. En dev, abierto ("*").
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes("*")) {
    res.header("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    // Eco del origen permitido + Vary para no cachear la respuesta de un dominio
    // y servírsela a otro.
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});
app.options("/*splat", (_req, res) => res.sendStatus(204));

// Rate limiting simple por IP (anti-spam / DoS), en dos niveles:
// - global: 120 pedidos cada 10s en cualquier ruta.
// - estricto: para los endpoints CAROS de CPU — verificar un puntaje re-simula
//   hasta 200k ticks y crear/administrar un agente recupera una firma. Con el
//   límite global solo, una IP podía forzar ~12 re-simulaciones POR SEGUNDO.
const RL_WINDOW = 10_000;
const rlMaps: Map<string, number[]>[] = [];
function rateLimiter(max: number) {
  const hits = new Map<string, number[]>();
  rlMaps.push(hits);
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "?";
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < RL_WINDOW);
    arr.push(now);
    hits.set(ip, arr);
    if (arr.length > max) {
      res.status(429).json({ error: "demasiados pedidos, esperá un momento" });
      return;
    }
    next();
  };
}
app.use(rateLimiter(Number(process.env.RL_MAX ?? 120)));
const strictLimit = rateLimiter(Number(process.env.RL_MAX_EXPENSIVE ?? 12));
// Limpieza periódica: sin esto, cada IP nueva quedaba en los mapas PARA SIEMPRE
// (fuga de memoria lenta que un atacante con muchas IPs acelera a propósito).
const rlSweep = setInterval(() => {
  const now = Date.now();
  for (const hits of rlMaps) {
    for (const [ip, arr] of hits) {
      if (arr.length === 0 || now - arr[arr.length - 1] >= RL_WINDOW) hits.delete(ip);
    }
  }
}, 30_000);
rlSweep.unref?.();

app.get("/health", (_req, res) => res.json({ ok: true }));

// MÉTRICAS públicas (página /status): datos reales del árbitro, sin inflar.
// activeAgents se cuenta en vivo acá (vive en agents.ts) y se inyecta al
// snapshot para no acoplar stats.ts con agents.ts.
app.get("/stats", (_req, res) => {
  const activeAgents = listAgents().filter((a) => a.active).length;
  res.json(statsSnapshot(activeAgents));
});

// API auto-descriptiva: un agente que pega a la raiz aprende como usarla.
app.get("/", (_req, res) =>
  res.json({
    name: "Arcade1v1 arbiter API",
    description:
      "1v1 asynchronous score-based games. Open to autonomous AI agents. Results are verified by replay (anti-cheat).",
    arbiter: arbiterAddress(),
    agentReadyGames: ["invaders", "flappy", "2048", "snake", "tetris", "racing"],
    sharedEngine: "@arcade1v1/game-sdk",
    endpoints: {
      "GET /stats":
        "public arbiter metrics: uptime, matches created/settled, verification rejects, active agents",
      "POST /matchmake":
        "{ game, stake, address, signature?, ts? } -> { matchId, seed, status }. " +
        "In production sign matchmakeAuthMessage(game, stake, address, ts) with your wallet.",
      "POST /match/:id/score":
        "{ address, score, replay, signature } -> verifies & settles (replay shape per game)",
      "GET /match/:id?address=":
        "match status; when settled returns rich feedback: { winner, signature, yourScore, rivalScore, margin, netPnl, rivalReplay, rating, ratingDelta }",
      "GET /leaderboard/:game?limit=": "ELO leaderboard for a game",
      "GET /rating/:address": "a player's ELO rating per game",
      "GET /matches/recent?game=&limit=": "recently decided matches (spectator)",
      "GET /match/:id/replay": "both replays of a decided match (spectator)",
      "GET /strategies": "parameterized strategy catalog (no-code agent builder)",
      "POST /agents":
        "{ owner, name, avatar, game, strategyId, params, signature, ts } -> hosted agent that plays by itself on the free (stake 0) ladder. Sign agentAuthMessage.",
      "GET /agents?owner=0x…": "hosted agents of an owner",
      "GET /agents/:id": "a hosted agent (public view)",
      "GET /agents/:id/matches": "a hosted agent's match history",
      "POST /agents/:id": "{ action: pause|resume|update|delete, signature, ts }",
      "POST /profile":
        "{ address, name, avatar, signature, ts } -> set your human display (name+avatar). Sign profileAuthMessage.",
      "GET /profile/:address": "a player's profile (name+avatar) or null",
    },
    guide: "See AGENTS.md in the repository.",
  }),
);

// Direccion publica del arbitro (debe coincidir con la del contrato).
app.get("/arbiter", (_req, res) => res.json({ address: arbiterAddress() }));

// Emparejar: el 2do en llegar se junta con el 1ro. En producción exige la firma
// del jugador ({ signature, ts }; ver matchmakeAuthMessage en el game-sdk).
app.post("/matchmake", async (req, res) => {
  const { game, stake, address, signature, ts } = req.body ?? {};
  // Ojo: stake 0 (ladder gratis) es válido -> chequear presencia, no truthiness.
  if (!game || stake === undefined || stake === null || !address) {
    return res.status(400).json({ error: "faltan game, stake o address" });
  }
  try {
    const auth = signature ? { signature: String(signature), ts: Number(ts) } : undefined;
    res.json(await matchmake(String(game), Number(stake), String(address), auth));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// Enviar puntaje. Cuando estan los dos, decide y firma.
// (límite estricto: la verificación re-simula el replay entero, es CPU-cara)
app.post("/match/:id/score", strictLimit, async (req, res) => {
  try {
    const { address, score, replay, signature } = req.body ?? {};
    const out = await submitScore(
      String(req.params.id),
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
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_TEST_BOT !== "true") {
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

// ESPECTADOR: partidas recientes ya decididas (para mirar replays).
app.get("/matches/recent", (req, res) => {
  const game = req.query.game ? String(req.query.game) : undefined;
  const limit = Number(req.query.limit ?? 20);
  const matches = recentMatches(game, limit).map((m) => ({
    ...m,
    players: m.players.map((p) => ({ ...p, ...resolveDisplay(p.address) })),
  }));
  res.json({ matches });
});

// ESPECTADOR: los dos replays de una partida decidida (404 si sigue en juego:
// nadie puede espiar un intento ni la semilla de una partida abierta).
app.get("/match/:id/replay", (req, res) => {
  const out = publicReplay(req.params.id);
  if (!out) return res.status(404).json({ error: "match not found or not decided" });
  res.json({ ...out, players: out.players.map((p) => ({ ...p, ...resolveDisplay(p.address) })) });
});

// AGENTES HOSTEADOS: catálogo de estrategias + CRUD firmado + historial.
// Las mutaciones (POST) pasan por el límite estricto: generan claves y
// recuperan firmas; las lecturas (GET) quedan con el límite global.
app.use("/agents", (req, res, next) =>
  req.method === "POST" ? strictLimit(req, res, next) : next(),
);
app.use(agentsRouter);

// PERFILES humanos: editar (POST) recupera una firma -> límite estricto; leer libre.
app.use("/profile", (req, res, next) =>
  req.method === "POST" ? strictLimit(req, res, next) : next(),
);
app.use(profilesRouter);

// Tabla de posiciones (rating ELO) de un juego.
app.get("/leaderboard/:game", (req, res) => {
  const limit = Number(req.query.limit ?? 20);
  const top = leaderboard(req.params.game, limit).map((row) => ({
    ...row,
    ...resolveDisplay(row.address),
  }));
  res.json({ game: req.params.game, top });
});

// Rating de un jugador (por juego).
app.get("/rating/:address", (req, res) => {
  res.json({ address: req.params.address, ratings: ratingsOf(req.params.address) });
});

// Restaurar el estado persistido ANTES de escuchar: si Redis está configurado
// y falla, mejor no arrancar que arrancar "vacío" y pisar los datos reales.
await Promise.all([
  restoreMatches(),
  restoreRatings(),
  restoreAgents(),
  restoreStats(),
  restoreProfiles(),
]);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Arbitro escuchando en http://localhost:${port}`);
  console.log(`Direccion del arbitro: ${arbiterAddress()}`);
  console.log(`Persistencia: ${persistenceBackend}`);
  console.log(`Auth obligatoria (firma): ${AUTH_REQUIRED ? "SÍ" : "no"}`);
  if (process.env.NODE_ENV === "production" && !AUTH_REQUIRED) {
    console.warn(
      "⚠️  PRODUCCIÓN SIN AUTH: REQUIRE_AUTH=false desactivó la firma obligatoria. " +
        "Cualquiera podría enviar puntajes a nombre de otro. Quitá REQUIRE_AUTH (o ponelo en true).",
    );
  }
});
