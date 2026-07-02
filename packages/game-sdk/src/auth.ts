// Mensaje canonico que el jugador/agente FIRMA con su wallet para probar que
// controla su direccion. Mismo formato en la web y en el servidor (sin drift).

/** Mensaje a firmar al enviar un puntaje. Ata: partida + jugador + puntaje. */
export function scoreAuthMessage(matchId: string, address: string, score: number): string {
  return [
    "Arcade1v1: confirmo mi puntaje",
    `match: ${matchId}`,
    `player: ${address.toLowerCase()}`,
    `score: ${score}`,
  ].join("\n");
}

/** Ventana de validez (ms) de la firma de emparejamiento (anti-replay). */
export const MATCHMAKE_AUTH_TTL_MS = 10 * 60 * 1000;

/** Mensaje a firmar al EMPAREJAR. Ata: juego + mesa + jugador + momento (ts).
 *  Sin esto, cualquiera podría encolar direcciones ajenas (suplantación) o
 *  llenar la cola de rivales fantasma que nunca depositan. El `ts` (epoch ms)
 *  evita reusar una firma vieja: el árbitro la acepta solo unos minutos. */
export function matchmakeAuthMessage(
  game: string,
  stake: number,
  address: string,
  ts: number,
): string {
  return [
    "Arcade1v1: quiero emparejar",
    `game: ${game}`,
    `stake: ${stake}`,
    `player: ${address.toLowerCase()}`,
    `ts: ${ts}`,
  ].join("\n");
}
