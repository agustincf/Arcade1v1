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
  setHouseAddressCheck,
  startSweeper,
  stopSweeper,
} from "./matchmaking.js";
import { leaderboard, ratingsOf, restoreRatings } from "./ratings.js";
import { restoreAgents, listAgents, hostedAgentByAddress, isHouseWallet } from "./agents.js";
import { statsSnapshot, restoreStats } from "./stats.js";
import { profilesRouter } from "./profiles-routes.js";
import { restoreProfiles, resolveDisplay } from "./profiles.js";
import { challengeRouter } from "./challenge-routes.js";
import { alephRouter } from "./aleph-routes.js";
import { liveRouter } from "./live-routes.js";
import { restoreAleph, startAlephTicker, stopAlephTicker } from "./aleph.js";
import { restoreAlephHouse } from "./aleph-house-seats.js";
import { startAlephHouse, stopAlephHouse } from "./aleph-house.js";
import { persistenceBackend, handoverEnabled, flushAll } from "./persist.js";
import { readLease, startLeaseHeartbeat, confirmHolder } from "./lease.js";
import {
  takeOver,
  abortStartup,
  answerDoorbell,
  doorbellAt,
  installFence,
  installShutdown,
  type HandoverDeps,
} from "./handover.js";
import { readinessGate, getMode, setMode, waitForIdle, HANDOVER_PATH } from "./readiness.js";
import { deployedCommit } from "./version.js";
import { arbiterAddress } from "./sign.js";
import { productionConfigErrors, parseTrustProxy } from "./config-guard.js";
import { agentsRouter, agentsPostLimit } from "./agents-routes.js";
import { gasSnapshot, startGasMonitor, stopGasMonitor } from "./gas-monitor.js";
import { startAgentRunner, stopAgentRunner } from "./agent-runner.js";
import { registerJob, startJobs, stopJobs } from "./jobs.js";

// Guarda de producción (fail-fast): no arrancar con dinero real mal configurado.
const cfgErrors = productionConfigErrors();
if (cfgErrors.length) {
  console.error("❌ Configuración de producción inválida — el servidor no arranca:");
  for (const e of cfgErrors) console.error("   - " + e);
  process.exit(1);
}

// El traspaso entre instancias (ver handover.ts). El timbre va a la URL pública
// del servicio: Render define RENDER_EXTERNAL_URL; HANDOVER_URL la reemplaza
// (pruebas locales).
const HANDOVER_BASE_URL = process.env.HANDOVER_URL ?? process.env.RENDER_EXTERNAL_URL;
const handoverDeps: HandoverDeps = {
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  doorbellConfigured: !!HANDOVER_BASE_URL,
  ringDoorbell: doorbellAt(HANDOVER_BASE_URL),
  flushAll,
  startJobs,
  stopJobs,
  waitForIdle,
  log: (m) => console.log(m),
  exit: (code) => process.exit(code),
};

/** Responde el error de un endpoint y —esto es lo nuevo— DEJA RASTRO.
 *
 *  Antes todo terminaba en `res.status(400).json({ error: e.message })`, sin un
 *  solo log: daba igual que fuera un pedido mal formado del cliente (400 real)
 *  o que el árbitro se hubiera roto por dentro (500). Con los logs de Render
 *  como única ventana, un incidente de producción era literalmente invisible —
 *  no quedaba ni la línea para saber que había pasado algo.
 *
 *  Los errores esperables (validación, partida vencida, mesa no permitida) son
 *  400 y no se loguean: son ruido. Cualquier otro es 500 y SÍ se loguea con su
 *  stack, la ruta y el método. */
const ERRORES_ESPERABLES =
  /not found|already|invalid|required|expired|too long|mismatch|not allowed|not open|unknown game|bad |missing |limit|forbidden|disabled/i;

function responderError(req: express.Request, res: express.Response, e: unknown): void {
  const err = e as Error;
  const msg = err?.message ?? String(e);
  if (ERRORES_ESPERABLES.test(msg)) {
    res.status(400).json({ error: msg });
    return;
  }
  console.error(`[error] ${req.method} ${req.path}:`, err?.stack ?? msg);
  res.status(500).json({ error: "internal error" });
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

// EL TIMBRE DEL TRASPASO: una instancia nueva le pide la posta a esta (ver
// handover.ts). Va antes de la puerta de readiness: se atiende en cualquier modo.
app.post(HANDOVER_PATH, async (req, res) => {
  try {
    const r = await answerDoorbell(handoverDeps, req.body ?? {});
    res.status(r.status).json(r.body);
  } catch (e) {
    console.error("[traspaso] timbre:", (e as Error).message);
    res.status(503).json({ accepted: false });
  }
});

// LOS MODOS DE LA INSTANCIA (ver readiness.ts): hasta tener el estado, /health y
// todo lo demás dan 503 (así Render le sigue mandando el tráfico a la vieja);
// también mientras entrega la posta.
app.use(readinessGate());

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
// Partidas EN VIVO: una partida compromete una vez por tubo, y el estricto (12
// cada 10 s) se queda corto con varios jugadores detrás de la misma IP.
const liveLimit = rateLimiter(Number(process.env.RL_MAX_LIVE ?? 60));
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

// Salud + qué versión corre y en qué modo está la instancia (ver readiness.ts):
// alcanza para confirmar desde afuera que un deploy salió y cómo quedó el
// traspaso.
const COMMIT = deployedCommit();
app.get("/health", (_req, res) => res.json({ ok: true, commit: COMMIT, mode: getMode() }));

// MÉTRICAS públicas (página /status): datos reales del árbitro, sin inflar.
// activeAgents se cuenta en vivo acá (vive en agents.ts) y se inyecta al
// snapshot para no acoplar stats.ts con agents.ts.
app.get("/stats", (_req, res) => {
  const activeAgents = listAgents().filter((a) => a.active).length;
  res.json({ ...statsSnapshot(activeAgents), gas: gasSnapshot() });
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
        "public arbiter metrics: uptime, matches created/settled, verification rejects, active agents, gas monitor",
      "POST /matchmake":
        "{ game, stake, address, signature?, ts? } -> { matchId, seed, rulesV, status }. " +
        "In production sign matchmakeAuthMessage(game, stake, address, ts) with your wallet.",
      "POST /match/:id/score":
        "{ address, score, replay, signature } -> verifies & settles (replay shape per game; " +
        "the replay must declare the match's rules version, e.g. v: 2 for snake/racing — " +
        "stale-rules submissions are rejected with 'rules version mismatch')",
      "POST /match/:id/live/start":
        "{ address, signature, ts } -> open or resume your live attempt (live games only; matchmake says live: true). Sign liveStartAuthMessage(matchId, address, ts). Returns { token, tick, flaps, reveal, revealed }",
      "POST /match/:id/live/commit":
        "{ address, token, from, to, flaps, have, final? } -> commit your flaps in [from, to) and get the random values the game uses in the next 15 ticks. 409 { tick, reveal } = resend from tick",
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
      "POST /challenge":
        "{ challenger, targetAgentId, signature, ts } (human) or { byAgentId, targetAgentId, signature, ts } (agent) -> a direct free-ladder duel vs a specific agent",
      "POST /aleph/join":
        "{ stake, address, signature, ts } -> a seat in Aleph, the 4–8 agent room (sign matchmakeAuthMessage('aleph', stake, address, ts)). stake 0 = free table; a money table (see GET /aleph/lobbies `stakes`) closes into a `funding` phase: your private view then carries `deposit` (escrow, pass, deadlines) and the room starts once every seat deposited on-chain",
      "GET /aleph/lobbies":
        "{ lobbies, stakes }: rooms waiting for seats or funding (status lobby|funding, deposited), and the stakes this arbiter accepts",
      "GET /aleph/:id?address=&signature=&ts=":
        "room view (stage, phase, deadline, pot, box, seats, public messages); with a valid view pass (sign alephViewAuthMessage(roomId, address, ts)) you also get your seat's private view: fragment, whispers, decided/ready",
      "POST /aleph/:id/act":
        "{ address, stage, phase, action, signature, ts } -> one signed action (keep/contribute, accept/decline, vote, submit, split/steal, ready, say, whisper). Sign alephActionAuthMessage(roomId, stage, phase, actionLine(action), ts)",
      "GET /aleph/:id/log":
        "settled room: secret seed, commit, signed events, payouts (re-simulate with replayAleph)",
      "GET /aleph/recent?limit=": "recently settled rooms",
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
    responderError(req, res, e);
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
    responderError(req, res, e);
  }
});

// PARTIDAS EN VIVO: abrir el intento y comprometer jugadas (ver live.ts).
app.use(liveRouter({ start: strictLimit, commit: liveLimit }));

// Completar la partida contra un bot (SOLO pruebas en solitario).
// Apagado en produccion salvo que se active con ENABLE_TEST_BOT=true.
app.post("/match/:id/bot", async (req, res) => {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_TEST_BOT !== "true") {
    return res.status(403).json({ error: "test bot disabled in production" });
  }
  try {
    res.json(await addBot(req.params.id));
  } catch (e) {
    responderError(req, res, e);
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
// recuperan firmas; las lecturas (GET) quedan con el límite global. La
// excepción es comprometer jugadas en vivo (una vez por tubo): liveLimit.
app.use("/agents", agentsPostLimit(strictLimit, liveLimit));
app.use(agentsRouter);

// PERFILES humanos: editar (POST) recupera una firma -> límite estricto; leer libre.
app.use("/profile", (req, res, next) =>
  req.method === "POST" ? strictLimit(req, res, next) : next(),
);
app.use(profilesRouter);

// DUELOS directos: crear (POST) recupera una firma -> límite estricto.
app.use("/challenge", (req, res, next) =>
  req.method === "POST" ? strictLimit(req, res, next) : next(),
);
app.use(challengeRouter);

// ALEPH (formato multi-agente): sentarse y actuar recuperan una firma ->
// límite estricto; las lecturas quedan con el límite global.
app.use("/aleph", (req, res, next) =>
  req.method === "POST" ? strictLimit(req, res, next) : next(),
);
app.use(alephRouter);

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

// LOS RELOJES (ver jobs.ts): arrancan después de cargar el estado, y la entrega
// de la posta los frena antes del guardado final.
//  - gas: no bloquea el API; en producción con escrow está activo por defecto.
//  - aleph-ticker: vence lobbies y fases aunque nadie consulte la sala.
//  - aleph-house: completa el lobby que está por vencerse y juega esos asientos.
//  - sweeper: vence partidas y pide sus reembolsos on-chain.
//  - agents: los agentes hosteados juegan solos.
registerJob({ name: "gas", start: () => void startGasMonitor(), stop: stopGasMonitor });
registerJob({ name: "aleph-ticker", start: startAlephTicker, stop: stopAlephTicker });
registerJob({ name: "aleph-house", start: startAlephHouse, stop: stopAlephHouse });
registerJob({ name: "sweeper", start: startSweeper, stop: stopSweeper });
registerJob({ name: "agents", start: startAgentRunner, stop: stopAgentRunner });

// PROBAR REDIS ANTES DE ESCUCHAR: si Upstash no responde, el proceso termina sin
// haber escuchado, el deploy falla y la instancia vieja sigue atendiendo.
if (handoverEnabled) await readLease();
installFence(handoverDeps);
installShutdown(handoverDeps);

// ESCUCHAR PRIMERO, ATENDER DESPUÉS: /health da 503 hasta tener el estado.
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

// TRASPASO: conseguir la posta (timbre a la vieja, o respaldo). Al volver, esta
// instancia es la dueña y carga exactamente lo que la vieja guardó.
const handover = await takeOver(handoverDeps);
console.log(`Traspaso: ${handover}`);
if (handoverEnabled) startLeaseHeartbeat();

// Restaurar el estado persistido. Si Redis está configurado y falla, el proceso
// termina sin haber atendido nada: mejor eso que atender "vacío" y pisar los
// datos reales. Antes de salir suelta la posta (abortStartup), así la próxima
// instancia no espera a que venza.
try {
  await Promise.all([
    restoreMatches(),
    restoreRatings(),
    restoreAgents(),
    restoreStats(),
    restoreProfiles(),
    restoreAleph(),
    restoreAlephHouse(),
  ]);

  // Embudo (v4.1): el settle clasifica cada partida por origen (casa/mixta/
  // terceros). El checker vive acá para no crear el ciclo matchmaking→agents.
  setHouseAddressCheck((a) => {
    const agent = hostedAgentByAddress(a);
    return !!agent && isHouseWallet(agent.owner);
  });

  // Si otra instancia tomó la posta mientras cargábamos, el cerco ya dejó esta en
  // "fenced" (/health 503) y Render la reinicia: no se atiende ni corren relojes.
  if (!handoverEnabled || (await confirmHolder())) {
    setMode("ready");
    startJobs();
    console.log("Árbitro listo: estado cargado");
  }
} catch (e) {
  await abortStartup(e, handoverDeps);
}
