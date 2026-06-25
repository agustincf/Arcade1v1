// Registro local de las partidas de plata que el usuario ABRIÓ o a las que se
// UNIÓ on-chain. El modelo es asincrónico ("depositá y andate"), así que el
// matchId podría perderse al cerrar la pestaña. Guardarlo por wallet permite
// volver más tarde a la página /recover y reclamar el reembolso si corresponde
// (sin rival a tiempo, o partida sin resultado al vencer el plazo).
//
// Es solo un índice de conveniencia: la verdad vive on-chain. La página de
// recuperación siempre verifica el estado real del contrato antes de actuar.

export interface OpenMatch {
  matchId: `0x${string}`;
  game: string;
  bet: number;
  role: "p1" | "p2";
  /** epoch (ms) en que se registró, para ordenar de más nuevo a más viejo. */
  ts: number;
}

const KEY = "arcade.openMatches";

/** Normaliza la wallet para usarla de clave (minúsculas). */
function norm(addr: string): string {
  return addr.toLowerCase();
}

type Store = Record<string, OpenMatch[]>;

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Store;
  } catch {
    return {};
  }
}

function writeStore(s: Store) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** Registra (o actualiza) una partida que esta wallet abrió/se unió. Idempotente
 *  por matchId: si ya existe, no la duplica. */
export function rememberMatch(address: string, m: OpenMatch) {
  if (!address) return;
  const s = readStore();
  const k = norm(address);
  const list = s[k] ?? [];
  if (!list.some((x) => x.matchId.toLowerCase() === m.matchId.toLowerCase())) {
    list.unshift(m);
    s[k] = list.slice(0, 50); // tope sano: no acumular para siempre
    writeStore(s);
  }
}

/** Partidas registradas por esta wallet, de más nueva a más vieja. */
export function listMatches(address: string): OpenMatch[] {
  if (!address) return [];
  return (readStore()[norm(address)] ?? [])
    .slice()
    .sort((a, b) => b.ts - a.ts);
}

/** Olvida una partida (ya cobrada, reembolsada o resuelta): la saca del índice. */
export function forgetMatch(address: string, matchId: string) {
  if (!address) return;
  const s = readStore();
  const k = norm(address);
  const list = s[k];
  if (!list) return;
  s[k] = list.filter((x) => x.matchId.toLowerCase() !== matchId.toLowerCase());
  writeStore(s);
}
