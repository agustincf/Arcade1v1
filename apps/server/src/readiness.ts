// ARRANQUE EN DOS TIEMPOS. El árbitro escucha enseguida, porque Render lo da
// por sano con /health y recién ahí le pasa el tráfico y apaga la instancia
// vieja. Pero no atiende hasta tener el estado: antes espera el traspaso (la
// vieja guarda y suelta la posta, ver persist.ts) y lo carga. Mientras tanto,
// todo pedido salvo /health y el índice de la API recibe 503 y reintenta.

import type { RequestHandler } from "express";

let ready = false;

/** El estado ya está cargado: desde acá se atiende todo. */
export function markReady(): void {
  ready = true;
}

export function readinessGate(): RequestHandler {
  return (req, res, next) => {
    if (ready || req.path === "/health" || (req.method === "GET" && req.path === "/")) {
      next();
      return;
    }
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "arbiter restarting, retry in a few seconds" });
  };
}
