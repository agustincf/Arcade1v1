// Los juegos que se pueden jugar EN VIVO, por id. Que un juego figure acá no
// lo prende: lo prende su versión de reglas (LIVE_SINCE_RULES_V en live.ts y
// RULES_V en rules.ts). El árbitro, el SDK y los agentes de la casa buscan acá
// la definición del juego de cada partida en vivo.

import type { LiveGame } from "./live";
import { flappyLive } from "./flappy-live";
import { racingLive } from "./racing-live";

const LIVE_GAMES = new Map<string, LiveGame<unknown>>([
  ["flappy", flappyLive],
  ["racing", racingLive],
]);

/** La definición en vivo de `game`, o `undefined` si no se juega en vivo. */
export function liveGameFor(game: string): LiveGame<unknown> | undefined {
  return LIVE_GAMES.get(game);
}
