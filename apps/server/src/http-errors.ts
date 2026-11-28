// Cómo contesta el árbitro un error de un endpoint (antes vivía en index.ts).
import type express from "express";
import { LiveUnavailableError } from "./live.js";
import { DepositUnverifiedError } from "./onchain.js";

/** Responde el error de un endpoint y DEJA RASTRO.
 *
 *  Antes todo terminaba en `res.status(400).json({ error: e.message })`, sin un
 *  solo log: daba igual que fuera un pedido mal formado del cliente (400 real)
 *  o que el árbitro se hubiera roto por dentro (500). Con los logs de Render
 *  como única ventana, un incidente de producción era literalmente invisible —
 *  no quedaba ni la línea para saber que había pasado algo.
 *
 *  Los errores esperables (validación, partida vencida, mesa no permitida, un
 *  depósito que no está en la cadena) son 400 y no se loguean: son ruido.
 *  Cualquier otro es 500 y SÍ se loguea con su stack, la ruta y el método. */
export const ERRORES_ESPERABLES =
  /not found|already|invalid|required|expired|too long|mismatch|not allowed|not open|unknown game|bad |missing |limit|forbidden|disabled|no on-chain deposit found|not a player|too many failed verifications/i;

export function responderError(req: express.Request, res: express.Response, e: unknown): void {
  const err = e as Error;
  const msg = err?.message ?? String(e);
  // La rendición de un juego en vivo guarda el intento antes de contestar; si
  // no pudo, se reintenta (no es un error del cliente ni un bug).
  if (e instanceof LiveUnavailableError) {
    res.setHeader("Retry-After", "2");
    res.status(503).json({ error: msg });
    return;
  }
  // El árbitro no pudo leer la cadena para ver el depósito: no procesó nada, y
  // el cliente puede reintentar en un momento (el del SDK lo hace solo con 503).
  if (e instanceof DepositUnverifiedError) {
    res.setHeader("Retry-After", "3");
    res.status(503).json({ error: msg });
    return;
  }
  if (ERRORES_ESPERABLES.test(msg)) {
    res.status(400).json({ error: msg });
    return;
  }
  console.error(`[error] ${req.method} ${req.path}:`, err?.stack ?? msg);
  res.status(500).json({ error: "internal error" });
}
