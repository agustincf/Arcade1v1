// EN QUÉ ESTÁ ESTA INSTANCIA y qué atiende en cada caso (tabla 3.3 del spec
// docs/superpowers/specs/2026-09-18-traspaso-con-timbre-design.md):
//
//  - starting: esperando la posta. /health da 503 A PROPÓSITO: así Render le
//    sigue mandando el tráfico a la vieja, y el timbre (que va por la URL
//    pública) le llega a ella.
//  - fallback: esperando que Render apague a la vieja. /health da 200 para que
//    Render pase el tráfico y le mande el SIGTERM; lo demás, 503.
//  - ready: atiende todo.
//  - draining / released: entregando la posta, o ya entregada. /health sigue en
//    200 (si no, Render la saca antes de tiempo); lo demás, 503. Leer también
//    cambia el estado (GET /aleph/* corre settleDue), así que no se atiende nada.
//  - fenced: perdió la posta sin entregarla. /health da 503 para que Render la
//    reinicie.
//
// El índice (GET /) no toca estado y se atiende siempre. El timbre del traspaso
// también: su handler decide (ver handover.ts).

import type { RequestHandler } from "express";

export type Mode = "starting" | "fallback" | "ready" | "draining" | "released" | "fenced";

export const HANDOVER_PATH = "/internal/handover";

const HEALTHY: ReadonlySet<Mode> = new Set<Mode>(["fallback", "ready", "draining", "released"]);

let mode: Mode = "starting";
let inflight = 0;

export const getMode = (): Mode => mode;

export function setMode(m: Mode): void {
  mode = m;
}

export function readinessGate(): RequestHandler {
  return (req, res, next) => {
    if (req.path === "/health") {
      if (HEALTHY.has(mode)) return next();
      res.setHeader("Retry-After", "5");
      res.status(503).json({ ok: false, mode });
      return;
    }
    if ((req.method === "GET" && req.path === "/") || req.path === HANDOVER_PATH) return next();
    if (mode !== "ready") {
      res.setHeader("Retry-After", "5");
      res.status(503).json({ error: "arbiter restarting, retry in a few seconds" });
      return;
    }
    // Pedido en curso: la entrega de la posta espera a que termine antes del
    // guardado final (ver waitForIdle).
    inflight++;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      inflight--;
    };
    res.on("finish", end);
    res.on("close", end);
    next();
  };
}

/** Espera a que terminen los pedidos en curso, con tope. true si terminaron. */
export async function waitForIdle(capMs: number, pollMs = 25): Promise<boolean> {
  const until = Date.now() + capMs;
  while (inflight > 0 && Date.now() < until) {
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return inflight === 0;
}
