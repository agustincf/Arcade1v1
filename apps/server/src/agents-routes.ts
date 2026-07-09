// Rutas HTTP de agentes hosteados. La administración (crear, editar, pausar,
// borrar) exige la firma del dueño (agentAuthMessage), igual que el resto de
// la API exige firmas para emparejar/enviar puntaje.

import { Router } from "express";
import { recoverMessageAddress, type Hex } from "viem";
import { agentAuthMessage, AGENT_AUTH_TTL_MS } from "@arcade1v1/game-sdk/auth";
import { STRATEGIES, defaultParams } from "@arcade1v1/strategies";
import { AUTH_REQUIRED } from "./matchmaking.js";
import {
  AGENT_AVATARS,
  createHostedAgent,
  deleteAgent,
  getAgent,
  listAgents,
  setAgentActive,
  toView,
  updateAgent,
} from "./agents.js";

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
agentsRouter.post("/agents", async (req, res) => {
  try {
    const { owner, name, avatar, game, strategyId, params, signature, ts } = req.body ?? {};
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
    });
    res.json(toView(agent));
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
  res.json({ agentId: a.id, matches: a.history });
});

// Administrar: pause / resume / update / delete. Firma del dueño sobre el id.
agentsRouter.post("/agents/:id", async (req, res) => {
  try {
    const a = getAgent(req.params.id);
    if (!a) return res.status(404).json({ error: "agent not found" });
    const { action, name, avatar, params, signature, ts } = req.body ?? {};
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
    return res.json(toView(updateAgent(a.id, { name, avatar, params })));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
