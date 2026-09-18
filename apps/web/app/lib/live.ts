// Piezas puras del modo EN VIVO de la web (sin React ni navegador, para poder
// testearlas): la rendición, retomar un intento al recargar y la fuente de azar
// con que se re-juega un replay de Flappy.
// Diseño: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md

import { SecretSource, checkLiveReveals, type RandomSource } from "@arcade1v1/game-sdk/live";

/** Replay VACÍO de la rendición (puntaje 0 verificable). Espejo de
 *  `emptyReplay` del runner (apps/server/src/agent-runner.ts). Declara `v` desde
 *  las reglas v2. Sin semilla es la de un juego EN VIVO: el árbitro no la
 *  reveló, y la rendición va sin ella. */
export function forfeitReplay(
  game: string,
  seed: number | null | undefined,
  rulesV: number,
): Record<string, unknown> {
  const v = rulesV > 1 ? { v: rulesV } : {};
  const s = seed === null || seed === undefined ? {} : { seed };
  if (game === "2048") return { ...s, moves: [], ...v };
  if (game === "flappy") return { ...s, ticks: 0, flaps: [], ...v };
  return { ...s, ticks: 0, inputs: [], ...v };
}

// RETOMAR: emparejar solo es idempotente mientras se espera rival, así que sin
// guardar el `matchId` una recarga empezaría otra partida y el intento abierto
// quedaría huérfano hasta vencer. Se guarda por juego, mesa y jugador, junto
// con el hash del secreto que el árbitro comprometió al emparejar: al retomar
// se comprueba contra ese, no contra el que muestre la vista de ese momento.
const MATCH_ID_RE = /^0x[0-9a-fA-F]{64}$/;
const SECRET_HASH_RE = /^[0-9a-f]{64}$/;
const resumeKey = (game: string, bet: number, player: string) =>
  `arcade1v1:live:${game}:${bet}:${player.toLowerCase()}`;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Un intento en vivo abierto: la partida y el compromiso del árbitro. */
export interface RememberedLiveMatch {
  matchId: string;
  secretHash: string;
}

/** Recordar el intento en vivo abierto (lo lee la página al recargar). */
export function rememberLiveMatch(
  storage: Pick<Store, "setItem">,
  game: string,
  bet: number,
  player: string,
  match: RememberedLiveMatch,
): void {
  try {
    storage.setItem(
      resumeKey(game, bet, player),
      JSON.stringify({ matchId: match.matchId, secretHash: match.secretHash }),
    );
  } catch {
    /* almacenamiento bloqueado (modo privado): no se podrá retomar, nada más */
  }
}

/** El intento en vivo recordado, o `null` si no hay (o lo guardado no sirve). */
export function readLiveMatch(
  storage: Pick<Store, "getItem">,
  game: string,
  bet: number,
  player: string,
): RememberedLiveMatch | null {
  try {
    const raw = storage.getItem(resumeKey(game, bet, player));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<RememberedLiveMatch> | null;
    const { matchId, secretHash } = v ?? {};
    if (typeof matchId !== "string" || !MATCH_ID_RE.test(matchId)) return null;
    if (typeof secretHash !== "string" || !SECRET_HASH_RE.test(secretHash)) return null;
    return { matchId, secretHash };
  } catch {
    return null;
  }
}

/** Olvidar el intento (cerró, se rindió o la partida ya no está). */
export function forgetLiveMatch(
  storage: Pick<Store, "removeItem">,
  game: string,
  bet: number,
  player: string,
): void {
  try {
    storage.removeItem(resumeKey(game, bet, player));
  } catch {
    /* ídem rememberLiveMatch */
  }
}

/** La fuente de azar para re-jugar un replay de Flappy: el secreto publicado en
 *  una partida en vivo; si no, la semilla del replay. Un replay en vivo sin su
 *  secreto no se puede re-jugar: se avisa en vez de inventar una partida. */
export function flappyReplaySource(
  replay: { seed?: number; ticks: number; flaps: number[] },
  secret?: string,
): number | RandomSource {
  if (secret) return new SecretSource(secret);
  if (replay.seed === undefined) throw new Error("live replay without its secret");
  return replay.seed;
}

/** ¿Cumplió el árbitro lo que comprometió en una partida en vivo ya decidida?
 *  El secreto publicado tiene que ser el del hash que prometió al emparejar y
 *  explicar todo lo que reveló. Falla cerrado: una partida decidida sin secreto,
 *  o sin el hash del compromiso, NO cumple (es una alarma, no un "no se sabe").
 *  Sin lo revelado (se retomó un intento ya cerrado) se comprueba solo el hash. */
export function liveSecretHolds(
  secret: string | undefined,
  secretHash: string | null,
  reveals: readonly number[] | null,
): boolean {
  return checkLiveReveals(secret ?? "", secretHash ?? "", reveals ?? []);
}
