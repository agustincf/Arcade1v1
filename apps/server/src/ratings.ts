// Sistema de rating ELO por jugador y por juego (ser bueno en Tetris != Snake).
// Persistencia simple en archivo JSON (sobrevive reinicios, sin base de datos).

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = join(DIR, "ratings.json");
const START = 1000; // rating inicial
const K = 32; // factor K (cuanto pesa cada partida)

type Store = Record<string, Record<string, number>>; // address -> game -> rating
let store: Store = {};
try {
  store = JSON.parse(readFileSync(FILE, "utf8"));
} catch {
  store = {};
}

function save() {
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
    // Escritura atomica: a un temporal y luego rename, asi un corte a mitad de
    // escritura no deja el archivo de ratings corrupto.
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(store));
    renameSync(tmp, FILE);
  } catch (e) {
    console.error("ratings save:", (e as Error).message);
  }
}

export function getRating(address: string, game: string): number {
  return store[address]?.[game] ?? START;
}

function set(address: string, game: string, rating: number) {
  (store[address] ??= {})[game] = rating;
}

export interface RatingUpdate {
  before: number;
  after: number;
  delta: number;
}

/** Actualiza el ELO de ambos jugadores tras una partida resuelta. */
export function applyResult(
  game: string,
  p1: string,
  p2: string,
  outcome: "p1" | "p2" | "draw",
): { p1: RatingUpdate; p2: RatingUpdate } {
  const r1 = getRating(p1, game);
  const r2 = getRating(p2, game);
  const e1 = 1 / (1 + Math.pow(10, (r2 - r1) / 400)); // resultado esperado de p1
  const s1 = outcome === "p1" ? 1 : outcome === "draw" ? 0.5 : 0;
  const n1 = Math.round(r1 + K * (s1 - e1));
  const n2 = Math.round(r2 + K * (1 - s1 - (1 - e1)));
  set(p1, game, n1);
  set(p2, game, n2);
  save();
  return {
    p1: { before: r1, after: n1, delta: n1 - r1 },
    p2: { before: r2, after: n2, delta: n2 - r2 },
  };
}

/** Tabla de posiciones de un juego (mayor rating primero). */
export function leaderboard(
  game: string,
  limit = 20,
): { address: string; rating: number }[] {
  return Object.entries(store)
    .map(([address, games]) => ({ address, rating: games[game] }))
    .filter((x): x is { address: string; rating: number } => typeof x.rating === "number")
    .sort((a, b) => b.rating - a.rating)
    .slice(0, Math.max(1, Math.min(100, limit)));
}

/** Todos los ratings de un jugador (por juego). */
export function ratingsOf(address: string): Record<string, number> {
  return store[address] ?? {};
}
