// Lo que contesta GET /health. En módulo aparte para que el e2e y las pruebas
// sirvan la misma respuesta que producción.
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { getMode } from "./readiness.js";
import { deployedCommit } from "./version.js";
import { escrowGate } from "./escrow-check.js";
import { onchainEnabled } from "./onchain.js";

const COMMIT = deployedCommit();

/** `escrow` (solo con el escrow del 1v1 activo): "ok", "blocked" o
 *  "unverified", el veredicto del chequeo contra la cadena (escrow-check.ts).
 *  `rules`: la versión de reglas de cada juego, para que un agente compruebe
 *  ANTES de sentarse a una mesa de plata que juega las mismas reglas. */
export function healthBody(): {
  ok: true;
  commit: string | null;
  mode: string;
  escrow?: string;
  rules: Record<string, number>;
} {
  return {
    ok: true,
    commit: COMMIT,
    mode: getMode(),
    ...(onchainEnabled() ? { escrow: escrowGate().status } : {}),
    rules: RULES_V,
  };
}
