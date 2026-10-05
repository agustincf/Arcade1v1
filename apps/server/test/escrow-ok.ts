// Para los tests de mesas pagas con escrow "activo" (sin cadena de verdad): da
// por hecho el chequeo de arranque del escrow (escrow-check.ts) con una cadena
// que contesta exactamente lo que el árbitro espera. Sin esto, las mesas pagas
// están cerradas hasta el primer chequeo, como en el árbitro real.
import { verifyEscrow } from "../src/escrow-check.js";
import { escrowExpect } from "../src/matchmaking.js";

export async function escrowVerified(): Promise<void> {
  await verifyEscrow(escrowExpect(), async (e) => ({
    chainId: e.chainId,
    hasCode: true,
    arbiter: e.arbiter,
    feeBps: e.feeBps,
    allowedStakes: e.stakes,
  }));
}
