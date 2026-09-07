// Rutas HTTP de Aleph (formato multi-agente). Capa fina sobre aleph.ts:
// valida presencia de campos, traduce AlephError a 400 y decora los asientos
// con nombre/avatar (resolveDisplay), como el resto de las vistas públicas.
import { Router, type Response } from "express";
import {
  joinAleph,
  getAlephRoom,
  actAleph,
  alephLog,
  listAlephLobbies,
  recentAlephRooms,
  AlephError,
} from "./aleph.js";
import { resolveDisplay } from "./profiles.js";

function fail(res: Response, e: unknown): void {
  if (e instanceof AlephError) {
    res.status(400).json({ error: e.message });
    return;
  }
  console.error("[aleph]", (e as Error)?.stack ?? e);
  res.status(500).json({ error: "internal error" });
}

const withDisplay = <T extends { address: string }>(seats: T[]) =>
  seats.map((s) => ({ ...s, ...resolveDisplay(s.address) }));

export const alephRouter = Router();

// Pedir asiento (firmado en producción: matchmakeAuthMessage("aleph", stake, address, ts)).
alephRouter.post("/aleph/join", async (req, res) => {
  const { stake, address, signature, ts } = req.body ?? {};
  if (stake === undefined || stake === null || !address) {
    return res.status(400).json({ error: "faltan stake o address" });
  }
  if (signature && (ts === undefined || ts === null)) {
    return res.status(400).json({ error: "falta ts (junto con signature)" });
  }
  try {
    const auth = signature ? { signature: String(signature), ts: Number(ts) } : undefined;
    const v = await joinAleph(Number(stake), String(address), auth);
    res.json({ ...v, seats: withDisplay(v.seats) });
  } catch (e) {
    fail(res, e);
  }
});

// Lobbies abiertos (para que un agente sepa que hay mesa esperando).
alephRouter.get("/aleph/lobbies", (_req, res) => {
  try {
    res.json({ lobbies: listAlephLobbies() });
  } catch (e) {
    fail(res, e);
  }
});

// Salas terminadas recientes (espectador).
alephRouter.get("/aleph/recent", (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 20);
    res.json({ rooms: recentAlephRooms(limit) });
  } catch (e) {
    fail(res, e);
  }
});

// Vista de una sala. Con ?address= + un PASE DE VISTA válido (?signature=&ts=
// sobre alephViewAuthMessage(roomId, address, ts)) devuelve la vista de ESE
// asiento: su fragmento, sus susurros, si ya decidió. Sin pase válido, la
// vista pública: nunca decisiones ajenas ni la semilla antes del cierre.
alephRouter.get("/aleph/:id", async (req, res) => {
  const { address, signature, ts } = req.query as Record<string, string | undefined>;
  try {
    const v = await getAlephRoom(String(req.params.id), address, undefined, {
      signature,
      ts: ts === undefined ? undefined : Number(ts),
    });
    if (!v) return res.status(404).json({ error: "room not found" });
    res.json({ ...v, seats: withDisplay(v.seats) });
  } catch (e) {
    fail(res, e);
  }
});

// Una acción firmada: { address, stage, phase, action, signature, ts }.
alephRouter.post("/aleph/:id/act", async (req, res) => {
  const { address, stage, phase, action, signature, ts } = req.body ?? {};
  if (!address || stage === undefined || stage === null || !phase || !action) {
    return res.status(400).json({ error: "faltan address, stage, phase o action" });
  }
  if (signature && (ts === undefined || ts === null)) {
    return res.status(400).json({ error: "falta ts (junto con signature)" });
  }
  try {
    const v = await actAleph(String(req.params.id), String(address), {
      stage: Number(stage),
      phase: String(phase),
      action,
      signature: signature ? String(signature) : undefined,
      ts: ts === undefined || ts === null ? undefined : Number(ts),
    });
    res.json({ ...v, seats: withDisplay(v.seats) });
  } catch (e) {
    fail(res, e);
  }
});

// Registro completo (solo salas terminadas): semilla, eventos firmados, pagos.
alephRouter.get("/aleph/:id/log", (req, res) => {
  try {
    res.json(alephLog(String(req.params.id)));
  } catch (e) {
    fail(res, e);
  }
});
