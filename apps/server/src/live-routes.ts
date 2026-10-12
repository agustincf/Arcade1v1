// Rutas HTTP de las partidas en vivo (1v1). Capa fina sobre live.ts: valida
// presencia de campos, traduce LiveError a 400, un conflicto de tick a 409 y un
// intento que no se pudo guardar a 503 (el cliente reintenta; no se reveló nada).

import { Router, type RequestHandler, type Response } from "express";
import {
  liveStart,
  liveCommit,
  LiveError,
  LiveUnavailableError,
  type LiveCommitBody,
} from "./live.js";

/** El cuerpo de un compromiso, con los números como números. Las jugadas pasan
 *  tal cual vinieron: live.ts las valida según el juego. */
export function commitBody(body: Record<string, unknown> | undefined): LiveCommitBody {
  const { token, from, to, flaps, inputs, have, final } = body ?? {};
  return {
    token: String(token ?? ""),
    from: Number(from),
    to: Number(to),
    ...(Array.isArray(flaps) ? { flaps: flaps.map(Number) } : {}),
    ...(inputs !== undefined ? { inputs: inputs as LiveCommitBody["inputs"] } : {}),
    have: Number(have ?? 0),
    final: final === true,
  };
}

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

  // Comprometer las jugadas de [from, to) y recibir el azar de los próximos 15
  // ticks. Las jugadas van en el formato del juego (`flaps` o `inputs`): las
  // valida live.ts, con un 400 que dice qué espera.
  router.post("/match/:id/live/commit", limits.commit, async (req, res) => {
    const { address } = req.body ?? {};
    if (!address) return res.status(400).json({ error: "missing address" });
    try {
      const out = await liveCommit(String(req.params.id), String(address), commitBody(req.body));
      res.status(out.conflict ? 409 : 200).json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  return router;
}
