// El lector del cuerpo JSON de cada pedido al árbitro. Vive aparte de
// `index.ts` para que los tests monten EXACTAMENTE el que corre en producción
// (test/cuerpo-json.test.ts), sin levantar el servidor entero.

import express, { type RequestHandler } from "express";

/** Tope de un cuerpo: un replay largo entra holgado; más que eso es abuso. */
export const TOPE_DEL_CUERPO = "256kb";

/** `inflate: false`: un pedido con `Content-Encoding` (gzip, deflate, br) se
 *  rechaza con 415 antes de crear ningún descompresor. Ningún cliente del
 *  árbitro comprime lo que manda (web, SDK, MCP, webhooks: JSON de pocos KB),
 *  y descomprimir lo que manda un desconocido fue dos veces la puerta de
 *  entrada para tirar el proceso con un solo pedido: una falla de Brotli en
 *  Node (parche del 2026-10-21) y otra de body-parser (GHSA-27r3-jxmh-p828). */
export function cuerpoJson(): RequestHandler {
  return express.json({ limit: TOPE_DEL_CUERPO, inflate: false });
}
