// Rutas HTTP de las partidas en vivo (1v1). Capa fina sobre live.ts: valida
// presencia de campos, traduce LiveError a 400, un conflicto de tick a 409 y un
// intento que no se pudo guardar a 503 (el cliente reintenta; no se reveló nada).

import { Router, type RequestHandler, type Response } from "express";
import { liveStart, liveCommit, LiveError, LiveUnavailableError } from "./live.js";

function fail(res: Response, e: unknown): void {
  if (e instanceof LiveError) {
    res.status(400).json({ error: e.message });
    return;
  }
  if (e instanceof LiveUnavailableError) {
    res.setHeader("Retry-After", "2");
    res.status(503).json({ error: e.message });
    return;
  }
  console.error("[live]", (e as Error)?.stack ?? e);
  res.status(500).json({ error: "internal error" });
}

/** Los limitadores los pone index.ts (los tests pasan otros). `start` recupera
 *  una firma y lee la cadena en las mesas de plata: va con el estricto, como el
 *  envío de puntaje. `commit` es barato y va una vez por tubo: tiene el suyo. */
export function liveRouter(limits: { start: RequestHandler; commit: RequestHandler }): Router {
  const router = Router();

  // Abrir o retomar el intento. En producción, firmado: liveStartAuthMessage.
  router.post("/match/:id/live/start", limits.start, async (req, res) => {
    const { address, signature, ts } = req.body ?? {};
    if (!address) return res.status(400).json({ error: "missing address" });
    try {
      const auth = signature ? { signature: String(signature), ts: Number(ts) } : undefined;
      res.json(await liveStart(String(req.params.id), String(address), auth));
    } catch (e) {
      fail(res, e);
    }
  });

  // Comprometer aleteos en [from, to) y recibir el azar de los próximos 15 ticks.
  router.post("/match/:id/live/commit", limits.commit, async (req, res) => {
    const { address, token, from, to, flaps, have, final } = req.body ?? {};
    if (!address) return res.status(400).json({ error: "missing address" });
    if (!Array.isArray(flaps)) return res.status(400).json({ error: "invalid flaps" });
    try {
      const out = await liveCommit(String(req.params.id), String(address), {
        token: String(token ?? ""),
        from: Number(from),
        to: Number(to),
        flaps: flaps.map(Number),
        have: Number(have ?? 0),
        final: final === true,
      });
      res.status(out.conflict ? 409 : 200).json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  return router;
}
