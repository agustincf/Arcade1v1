// Rutas HTTP de agentes hosteados. La administración (crear, editar, pausar,
// borrar) exige la firma del dueño (agentAuthMessage), igual que el resto de
// la API exige firmas para emparejar/enviar puntaje.

import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { recoverMessageAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  agentAuthMessage,
  AGENT_AUTH_TTL_MS,
  liveStartAuthMessage,
  scoreAuthMessage,
} from "@arcade1v1/game-sdk/auth";
import { STRATEGIES, defaultParams } from "@arcade1v1/strategies";
import { AUTH_REQUIRED, getMatch, submitScore } from "./matchmaking.js";
import {
  AGENT_AVATARS,
  createHostedAgent,
  deleteAgent,
  getAgent,
  listAgents,
  recordSettledResult,
  resetWebhookFailures,
  setAgentActive,
  setAgentPending,
  toView,
  updateAgent,
  type HostedAgent,
} from "./agents.js";
import { liveStart, liveCommit, LiveError } from "./live.js";
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
/** Guardia 1 de una jugada BYO: el agente existe y es webhook, los webhooks
 *  están habilitados, el secreto es el suyo y `matchId` es su partida pendiente.
 *  Si algo falla, contesta y devuelve null. */
function webhookAgent(
  req: Request,
  res: Response,
): { a: HostedAgent; matchId: string; address: string } | null {
  const a = getAgent(String(req.params.id));
  // Mismo 404 para "no existe" y "no es webhook": no revelar cuál es cuál.
  if (!a || !a.webhook) {
    res.status(404).json({ error: "agent not found" });
    return null;
  }
  if (!webhookAgentsEnabled()) {
    res.status(403).json({ error: "webhook agents disabled" });
    return null;
  }
  const auth = String(req.headers.authorization ?? "");
  // El esquema Authorization es case-insensitive (RFC 7235): aceptamos
  // "Bearer" y "bearer" para no rebotar a un cliente con el secreto correcto.
  const given = /^bearer /i.test(auth)
    ? auth.slice(7)
    : String(req.headers["x-agent-secret"] ?? "");
  if (!given || !secretMatches(given, a.webhook.secret)) {
    res.status(401).json({ error: "bad secret" });
    return null;
  }
  const matchId = String(req.body?.matchId ?? "");
  // Nota: se acepta aunque active===false — pausar no mata una partida viva.
  if (!matchId || matchId !== a.pendingMatchId) {
    res.status(409).json({ error: "no pending match with that id" });
    return null;
  }
  return { a, matchId, address: a.address.toLowerCase() };
}

/** Guardia 2: la partida sigue viva, emparejada y le toca jugar. */
function webhookReadyMatch(
  res: Response,
  a: HostedAgent,
  matchId: string,
  address: string,
): boolean {
  const m = getMatch(matchId, address);
  if (!m) {
    // La partida fue purgada/expirada: soltar el pending para que el runner
    // vuelva a encolar en el próximo tick.
    setAgentPending(a, undefined);
    res.status(410).json({ error: "match gone" });
    return false;
  }
  if (m.status !== "ready") {
    res.status(409).json({ error: `match is ${m.status}` });
    return false;
  }
  // Defensa en profundidad: en un desafío no se juega hasta que el retador
  // jugó (normalmente ni se notificó; ver agent-runner).
  if (m.challengeTarget && !m.rivalSubmitted) {
    res.status(409).json({ error: "challenger has not played yet" });
    return false;
  }
  return true;
}

agentsRouter.post("/agents/:id/play", async (req, res) => {
  const who = webhookAgent(req, res);
  if (!who) return;
  const n = Number(req.body?.score);
  if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "bad score" });
  if (!webhookReadyMatch(res, who.a, who.matchId, who.address)) return;

  try {
    const account = privateKeyToAccount(who.a.privateKey);
    const signature = await account.signMessage({
      message: scoreAuthMessage(who.matchId, who.address, n),
    });
    const after = await submitScore(who.matchId, who.address, n, req.body?.replay, signature);
    resetWebhookFailures(who.a); // el endpoint del dev vive y juega
    recordSettledResult(who.a, after, who.address); // no-op si la partida no se decidió
    // El MatchView estándar: el mismo feedback rico que cualquier jugador.
    res.json(after);
  } catch (e) {
    // Verificación fallida (replay no reproduce el score, etc.): 400 y el dev
    // puede reintentar hasta el deadline; si nunca valida, el forfeit captura.
    res.status(400).json({ error: (e as Error).message });
  }
});

function liveFail(res: Response, e: unknown): void {
  if (e instanceof LiveError) {
    res.status(400).json({ error: e.message });
    return;
  }
  console.error("[live byo]", (e as Error)?.stack ?? e);
  res.status(500).json({ error: "internal error" });
}

// EN VIVO para BYO: el secreto prueba el control del agente, así que el server
// firma la apertura con la clave del agente, como en /play firma el puntaje.
agentsRouter.post("/agents/:id/live/start", async (req, res) => {
  const who = webhookAgent(req, res);
  if (!who || !webhookReadyMatch(res, who.a, who.matchId, who.address)) return;
  try {
    const ts = Date.now();
    const signature = await privateKeyToAccount(who.a.privateKey).signMessage({
      message: liveStartAuthMessage(who.matchId, who.address, ts),
    });
    res.json(await liveStart(who.matchId, who.address, { signature, ts }));
  } catch (e) {
    liveFail(res, e);
  }
});

agentsRouter.post("/agents/:id/live/commit", async (req, res) => {
  const who = webhookAgent(req, res);
  if (!who || !webhookReadyMatch(res, who.a, who.matchId, who.address)) return;
  const { token, from, to, flaps, have, final } = req.body ?? {};
  if (!Array.isArray(flaps)) return res.status(400).json({ error: "invalid flaps" });
  try {
    const out = await liveCommit(who.matchId, who.address, {
      token: String(token ?? ""),
      from: Number(from),
      to: Number(to),
      flaps: flaps.map(Number),
      have: Number(have ?? 0),
      final: final === true,
    });
    if (!out.conflict && out.over) {
      resetWebhookFailures(who.a);
      const after = getMatch(who.matchId, who.address);
      if (after) recordSettledResult(who.a, after, who.address);
    }
    res.status(out.conflict ? 409 : 200).json(out);
  } catch (e) {
    liveFail(res, e);
  }
});
