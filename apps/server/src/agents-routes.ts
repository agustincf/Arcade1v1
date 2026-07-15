// Rutas HTTP de agentes hosteados. La administración (crear, editar, pausar,
// borrar) exige la firma del dueño (agentAuthMessage), igual que el resto de
// la API exige firmas para emparejar/enviar puntaje.

import { createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { recoverMessageAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentAuthMessage, AGENT_AUTH_TTL_MS, scoreAuthMessage } from "@arcade1v1/game-sdk/auth";
import { STRATEGIES, defaultParams } from "@arcade1v1/strategies";
import { AUTH_REQUIRED, getMatch, submitScore } from "./matchmaking.js";
import {
  AGENT_AVATARS,
  createHostedAgent,
  deleteAgent,
  getAgent,
  listAgents,
  recordAgentResult,
  resetWebhookFailures,
  setAgentActive,
  setAgentPending,
  toView,
  updateAgent,
} from "./agents.js";
import { webhookAgentsEnabled } from "./webhook-fetch.js";
import { resolveDisplay } from "./profiles.js";

const normAddr = (a: string) => String(a).toLowerCase();

/** Verifica la firma del dueño sobre agentAuthMessage(action, ref, owner, ts). */
async function checkAuth(opts: {
  action: string;
  agentRef: string;
  owner: string;
  signature?: string;
  ts?: unknown;
}) {
  if (opts.signature) {
    const ts = Number(opts.ts);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > AGENT_AUTH_TTL_MS) {
      throw new Error("auth expired");
    }
    const signer = await recoverMessageAddress({
      message: agentAuthMessage(opts.action, opts.agentRef, opts.owner, ts),
      signature: opts.signature as Hex,
    });
    if (signer.toLowerCase() !== normAddr(opts.owner)) throw new Error("bad signature");
  } else if (AUTH_REQUIRED) {
    throw new Error("signature required");
  }
}

export const agentsRouter = Router();

// Catálogo de estrategias del builder: juegos, controles y defaults. Público:
// la web dibuja el wizard con esto (una sola fuente de verdad, el registro).
agentsRouter.get("/strategies", (_req, res) => {
  const out = Object.values(STRATEGIES).map((def) => ({
    id: def.id,
    game: def.game,
    labelKey: def.labelKey,
    params: def.params,
    defaults: defaultParams(def),
  }));
  res.json({ strategies: out, avatars: AGENT_AVATARS });
});

// Crear un agente. Firma sobre "create" + "juego:estrategia:nombre".
// BYO por webhook: mismo flujo con strategyId "webhook" + webhookUrl; la
// respuesta incluye webhookSecret UNA sola vez (después es irrecuperable).
agentsRouter.post("/agents", async (req, res) => {
  try {
    const { owner, name, avatar, game, strategyId, params, webhookUrl, signature, ts } =
      req.body ?? {};
    if (!owner || !game || !strategyId) {
      return res.status(400).json({ error: "faltan owner, game o strategyId" });
    }
    await checkAuth({
      action: "create",
      agentRef: `${game}:${strategyId}:${String(name ?? "")}`,
      owner: String(owner),
      signature,
      ts,
    });
    const agent = createHostedAgent({
      owner: String(owner),
      name,
      avatar,
      game: String(game),
      strategyId: String(strategyId),
      params,
      webhookUrl,
    });
    res.json(
      agent.webhook ? { ...toView(agent), webhookSecret: agent.webhook.secret } : toView(agent),
    );
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// Listar agentes de un dueño (público: no hay nada secreto en la vista).
agentsRouter.get("/agents", (req, res) => {
  const owner = req.query.owner ? String(req.query.owner) : undefined;
  if (!owner) return res.status(400).json({ error: "falta ?owner=0x..." });
  res.json({ agents: listAgents(owner).map(toView) });
});

agentsRouter.get("/agents/:id", (req, res) => {
  const a = getAgent(req.params.id);
  if (!a) return res.status(404).json({ error: "agent not found" });
  res.json(toView(a));
});

// Historial de partidas del agente (ring buffer propio: las Match se purgan).
agentsRouter.get("/agents/:id/matches", (req, res) => {
  const a = getAgent(req.params.id);
  if (!a) return res.status(404).json({ error: "agent not found" });
  // name/avatar acá describen al RIVAL de cada partida (cada fila es "vs X").
  const matches = a.history.map((m) => ({
    ...m,
    ...(m.opponent ? resolveDisplay(m.opponent) : {}),
  }));
  res.json({ agentId: a.id, matches });
});

// Administrar: pause / resume / update / delete. Firma del dueño sobre el id.
agentsRouter.post("/agents/:id", async (req, res) => {
  try {
    const a = getAgent(req.params.id);
    if (!a) return res.status(404).json({ error: "agent not found" });
    const { action, name, avatar, params, webhookUrl, signature, ts } = req.body ?? {};
    const act = String(action ?? "");
    if (!["pause", "resume", "update", "delete"].includes(act)) {
      return res.status(400).json({ error: "action inválida (pause|resume|update|delete)" });
    }
    await checkAuth({ action: act, agentRef: a.id, owner: a.owner, signature, ts });
    if (act === "pause") return res.json(toView(setAgentActive(a.id, false)));
    if (act === "resume") return res.json(toView(setAgentActive(a.id, true)));
    if (act === "delete") {
      deleteAgent(a.id);
      return res.json({ ok: true });
    }
    return res.json(toView(updateAgent(a.id, { name, avatar, params, webhookUrl })));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Comparación en tiempo constante vía digests (evita el requisito de igual
 *  longitud de timingSafeEqual y no filtra el largo del secreto). */
function secretMatches(given: string, real: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(real));
}

// JUGADA de un agente BYO: el dev devuelve su corrida autenticado con el
// secreto (nada de firmas de wallet de su lado — esa es la gracia). El server
// firma con la clave del agente y pasa por submitScore, donde la verificación
// completa del replay re-corre: hacer trampa acá es tan imposible como siempre.
agentsRouter.post("/agents/:id/play", async (req, res) => {
  const a = getAgent(req.params.id);
  // Mismo 404 para "no existe" y "no es webhook": no revelar cuál es cuál.
  if (!a || !a.webhook) return res.status(404).json({ error: "agent not found" });
  if (!webhookAgentsEnabled()) return res.status(403).json({ error: "webhook agents disabled" });

  const auth = String(req.headers.authorization ?? "");
  const given = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : String(req.headers["x-agent-secret"] ?? "");
  if (!given || !secretMatches(given, a.webhook.secret)) {
    return res.status(401).json({ error: "bad secret" });
  }

  const { matchId, score, replay } = req.body ?? {};
  // Nota: se acepta aunque active===false — pausar no mata una partida viva.
  if (!matchId || String(matchId) !== a.pendingMatchId) {
    return res.status(409).json({ error: "no pending match with that id" });
  }
  const n = Number(score);
  if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "bad score" });

  const address = a.address.toLowerCase();
  const m = getMatch(String(matchId), address);
  if (!m) {
    // La partida fue purgada/expirada: soltar el pending para que el runner
    // vuelva a encolar en el próximo tick.
    setAgentPending(a, undefined);
    return res.status(410).json({ error: "match gone" });
  }
  if (m.status !== "ready") return res.status(409).json({ error: `match is ${m.status}` });
  // Defensa en profundidad: en un desafío no se juega hasta que el retador
  // jugó (normalmente ni se notificó; ver agent-runner).
  if (m.challengeTarget && !m.rivalSubmitted) {
    return res.status(409).json({ error: "challenger has not played yet" });
  }

  try {
    const account = privateKeyToAccount(a.privateKey);
    const signature = await account.signMessage({
      message: scoreAuthMessage(String(matchId), address, n),
    });
    const after = await submitScore(String(matchId), address, n, replay, signature);
    resetWebhookFailures(a); // el endpoint del dev vive y juega
    if (after.status === "settled" || after.status === "draw") {
      recordAgentResult(a, {
        matchId: after.matchId,
        game: after.game,
        opponent: after.opponent,
        yourScore: after.yourScore,
        rivalScore: after.rivalScore,
        outcome: after.status === "draw" ? "draw" : after.winner === address ? "win" : "loss",
        ratingDelta: after.ratingDelta,
        ts: Date.now(),
      });
    }
    // El MatchView estándar: el mismo feedback rico que cualquier jugador.
    res.json(after);
  } catch (e) {
    // Verificación fallida (replay no reproduce el score, etc.): 400 y el dev
    // puede reintentar hasta el deadline; si nunca valida, el forfeit captura.
    res.status(400).json({ error: (e as Error).message });
  }
});
