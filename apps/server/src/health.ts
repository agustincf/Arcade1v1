// Lo que contesta GET /health. En módulo aparte para que el e2e y las pruebas
// sirvan la misma respuesta que producción.
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { getMode } from "./readiness.js";
import { deployedCommit } from "./version.js";
import { escrowGate } from "./escrow-check.js";
import { onchainEnabled } from "./onchain.js";
import { networkSwitchPending } from "./network-switch.js";
import { openPaidMatches } from "./matchmaking.js";

const COMMIT = deployedCommit();

/** `escrow` (solo con el escrow del 1v1 activo): "ok", "blocked" o
 *  "unverified", el veredicto del chequeo contra la cadena (escrow-check.ts).
 *  `rules`: la versión de reglas de cada juego, para que un agente compruebe
 *  ANTES de sentarse a una mesa de plata que juega las mismas reglas.
 *  `paidOpen` (con el escrow activo): las mesas de plata que todavía no
 *  cerraron en la cadena; tiene que estar en 0 antes de cambiar de red.
 *  `networkSwitch`: el árbitro arrancó con otra red y quedan partidas de plata
 *  de la anterior; mientras tanto `escrow` dice "blocked" (network-switch.ts). */
export function healthBody(): {
  ok: true;
  commit: string | null;
  mode: string;
  escrow?: string;
  paidOpen?: number;
  networkSwitch?: { from: string; to: string; open: number };
  rules: Record<string, number>;
} {
  const sw = networkSwitchPending();
  return {
    ok: true,
    commit: COMMIT,
    mode: getMode(),
    ...(onchainEnabled()
      ? {
          escrow: sw ? "blocked" : escrowGate().status,
          paidOpen: openPaidMatches().length,
          ...(sw ? { networkSwitch: sw } : {}),
        }
      : {}),
    rules: RULES_V,
  };
}
