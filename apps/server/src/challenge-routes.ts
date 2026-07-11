// Ruta HTTP de duelos directos (ladder gratis). Crear un desafío va FIRMADO:
// - humano→agente: el humano firma challengeAuthMessage(challenger, targetAddr, ts).
// - agente→agente: el dueño firma agentAuthMessage("challenge", byAgentId, owner, ts).
// El target es siempre un agente hosteado activo; su runner lo acepta y juega.

import { Router } from "express";
import { recoverMessageAddress, type Hex } from "viem";
import {
  challengeAuthMessage,
  agentAuthMessage,
  AGENT_AUTH_TTL_MS,
} from "@arcade1v1/game-sdk/auth";
import { AUTH_REQUIRED, createChallenge } from "./matchmaking.js";
import { getAgent, setAgentPending } from "./agents.js";

const normAddr = (a: string) => String(a).toLowerCase();

function freshTs(ts: unknown): number {
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > AGENT_AUTH_TTL_MS) {
    throw new Error("auth expired");
  }
  return t;
}

export const challengeRouter = Router();

challengeRouter.post("/challenge", async (req, res) => {
  try {
    const { challenger, targetAgentId, byAgentId, signature, ts } = req.body ?? {};
    if (!targetAgentId) return res.status(400).json({ error: "falta targetAgentId" });
    const target = getAgent(String(targetAgentId));
    if (!target || !target.active) {
      return res.status(400).json({ error: "target agent not available" });
    }

    if (byAgentId) {
      // AGENTE → AGENTE: firma del dueño del agente desafiante.
      const by = getAgent(String(byAgentId));
      if (!by) return res.status(400).json({ error: "agent not found" });
      if (by.game !== target.game) return res.status(400).json({ error: "distinto juego" });
      if (by.owner === target.owner) {
        return res.status(400).json({ error: "no podés desafiar a tu propio agente" });
      }
      if (signature) {
        const t = freshTs(ts);
        const signer = await recoverMessageAddress({
          message: agentAuthMessage("challenge", by.id, by.owner, t),
          signature: signature as Hex,
        });
        if (signer.toLowerCase() !== normAddr(by.owner)) throw new Error("bad signature");
      } else if (AUTH_REQUIRED) {
        throw new Error("signature required");
      }
      const m = createChallenge(by.game, by.address, target.address);
      setAgentPending(by, m.matchId); // su runner juega el intento del challenger
      return res.json(m);
    }

    // HUMANO → AGENTE: firma del propio challenger.
    if (!challenger) return res.status(400).json({ error: "falta challenger" });
    const ch = normAddr(String(challenger));
    if (signature) {
      const t = freshTs(ts);
      const signer = await recoverMessageAddress({
        message: challengeAuthMessage(ch, normAddr(target.address), t),
        signature: signature as Hex,
      });
      if (signer.toLowerCase() !== ch) throw new Error("bad signature");
    } else if (AUTH_REQUIRED) {
      throw new Error("signature required");
    }
    if (ch === normAddr(target.address)) {
      return res.status(400).json({ error: "cannot challenge yourself" });
    }
    return res.json(createChallenge(target.game, ch, target.address));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
