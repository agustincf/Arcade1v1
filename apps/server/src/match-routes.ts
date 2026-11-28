// Las rutas del 1v1 (emparejar, enviar puntaje, ver la partida y la dirección
// del árbitro), en un router aparte para que las pruebas y el e2e monten las
// MISMAS rutas que producción, con el mismo manejo de errores (antes vivían en
// index.ts y las pruebas las copiaban a mano).
import { Router, type RequestHandler } from "express";
import { matchmake, submitScore, getMatch } from "./matchmaking.js";
import { arbiterAddress } from "./sign.js";
import { responderError } from "./http-errors.js";

export function matchRouter(limits: { score: RequestHandler }): Router {
  const router = Router();

  // Direccion publica del arbitro (debe coincidir con la del contrato).
  router.get("/arbiter", (_req, res) => res.json({ address: arbiterAddress() }));

  // Emparejar: el 2do en llegar se junta con el 1ro. En producción exige la firma
  // del jugador ({ signature, ts }; ver matchmakeAuthMessage en el game-sdk).
  router.post("/matchmake", async (req, res) => {
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
  router.post("/match/:id/score", limits.score, async (req, res) => {
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

  // Consultar estado/resultado de una partida.
  router.get("/match/:id", (req, res) => {
    const m = getMatch(req.params.id, req.query.address as string | undefined);
    if (!m) return res.status(404).json({ error: "match not found" });
    res.json(m);
  });

  return router;
}
