// Mensaje canonico que el jugador/agente FIRMA con su wallet para probar que
// controla su direccion. Mismo formato en la web y en el servidor (sin drift).

/** Mensaje a firmar al enviar un puntaje. Ata: partida + jugador + puntaje. */
export function scoreAuthMessage(
  matchId: string,
  address: string,
  score: number,
): string {
  return [
    "Arcade1v1: confirmo mi puntaje",
    `match: ${matchId}`,
    `player: ${address.toLowerCase()}`,
    `score: ${score}`,
  ].join("\n");
}
