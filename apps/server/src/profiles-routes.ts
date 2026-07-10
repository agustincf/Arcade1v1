// Rutas HTTP de perfiles humanos. Editar exige la firma del propio dueño
// (profileAuthMessage con ts anti-replay), igual que el resto de la API. Leer
// es público (no hay nada secreto en un nombre/avatar).

import { Router } from "express";
import { recoverMessageAddress, type Hex } from "viem";
import { profileAuthMessage, AGENT_AUTH_TTL_MS } from "@arcade1v1/game-sdk/auth";
import { AUTH_REQUIRED } from "./matchmaking.js";
import { setProfile, getProfile } from "./profiles.js";

const normAddr = (a: string) => String(a).toLowerCase();

export const profilesRouter = Router();

// Perfil público de una address (o null si no tiene). Sin perfil no es error.
profilesRouter.get("/profile/:address", (req, res) => {
  res.json({ profile: getProfile(req.params.address) ?? null });
});

// Crear/editar el perfil propio. Firma sobre profileAuthMessage("set", addr, ts).
profilesRouter.post("/profile", async (req, res) => {
  try {
    const { address, name, avatar, signature, ts } = req.body ?? {};
    if (!address) return res.status(400).json({ error: "falta address" });
    const addr = normAddr(String(address));
    if (signature) {
      const t = Number(ts);
      if (!Number.isFinite(t) || Math.abs(Date.now() - t) > AGENT_AUTH_TTL_MS) {
        throw new Error("auth expired");
      }
      const signer = await recoverMessageAddress({
        message: profileAuthMessage("set", addr, t),
        signature: signature as Hex,
      });
      if (signer.toLowerCase() !== addr) throw new Error("bad signature");
    } else if (AUTH_REQUIRED) {
      throw new Error("signature required");
    }
    res.json({ profile: setProfile({ address: addr, name, avatar }) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
