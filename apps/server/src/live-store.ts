// EL REGISTRO DURABLE DE CADA INTENTO EN VIVO (Flappy, reglas v2).
//
// El intento vive en su partida (`m.live[address]`), y las partidas se guardan
// todas juntas en un blob cada 20 s (PERSIST_DEBOUNCE_MS). Para casi todo
// alcanza, pero no para el azar: si el árbitro se cae de golpe (OOM, crash)
// después de revelar valores nuevos y antes de guardar, la instancia que
// arranca restaura el intento en un tick anterior, y el jugador, que ya vio esos
// tubos, puede rehacer ese tramo de otra manera. Un deploy no pierde nada (la
// posta se entrega con todo guardado); una caída dura, sí.
//
// Por eso cada intento tiene además su propio registro chico, y live.ts no
// manda nada que el jugador no haya visto (valores nuevos, el final del intento,
// un token) hasta que el registro con el estado que lo produjo quedó guardado.
// Si guardar falla, el pedido contesta 503 sin revelar nada y el cliente
// reintenta. El blob de partidas sigue guardándose como siempre: al restaurar,
// el registro manda sobre la copia del blob (ver `restoreLiveAttempts`).
//
// Diseño: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md,
// "Por qué alcanza, y qué no cubre" (decidido el 2026-09-22 para antes de
// mainnet).

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { redisCommand, redisPipeline } from "./redis.js";
import { EPOCH_READ, epochStillMine, isHolder } from "./lease.js";
import { handoverEnabled, persistenceBackend } from "./persist.js";
import type { LiveAttempt } from "./matchmaking.js";

/** No se pudo guardar el intento: el pedido no revela nada y se reintenta. Las
 *  rutas lo contestan con 503 (un cliente lo reintenta solo). */
export class LiveUnavailableError extends Error {}

/** Dónde se guarda. Un campo por intento (`<matchId>:<address>`) de UN hash de
 *  Redis: cada escritura sube solo ese intento, y al arrancar se leen todos en
 *  un pedido. */
export interface LiveRecordStore {
  /** Guarda YA. Resuelve solo si quedó guardado; si no, rechaza. */
  save(key: string, json: string): Promise<void>;
  loadAll(): Promise<Map<string, string>>;
  remove(keys: string[]): Promise<void>;
}

const LIVE_HASH = "arcade:live";

function redisStore(): LiveRecordStore {
  return {
    async save(key, json) {
      if (!handoverEnabled) {
        await redisCommand(["HSET", LIVE_HASH, key, json]);
        return;
      }
      // Con traspaso escribe solo la dueña de la posta, como el resto del
      // estado (persist.ts). La época se lee en el MISMO pedido que escribe:
      // esto va en el camino de cada respuesta al jugador, que tiene 0,25 s de
      // margen, y no puede pagar dos idas y vueltas. Si resulta que la posta
      // era de otra, el intento no se da por guardado (nada se revela) y esta
      // instancia se cerca.
      if (!isHolder()) throw new Error("live store: sin la posta, no se guarda");
      const [cur] = await redisPipeline([[...EPOCH_READ], ["HSET", LIVE_HASH, key, json]]);
      if (!epochStillMine(cur)) throw new Error("live store: la posta es de otra instancia");
    },
    async loadAll() {
      const flat = (await redisCommand(["HGETALL", LIVE_HASH])) as string[] | null;
      const out = new Map<string, string>();
      for (let i = 0; flat && i + 1 < flat.length; i += 2) out.set(flat[i], flat[i + 1]);
      return out;
    },
    async remove(keys) {
      if (keys.length === 0 || (handoverEnabled && !isHolder())) return;
      await redisCommand(["HDEL", LIVE_HASH, ...keys]);
    },
  };
}

/** Disco local (dev, o un host con disco persistente): un JSON con todos los
 *  intentos, escrito entero y atómico (tmp + rename) en cada guardado. Son
 *  pocos y chicos. */
function fileStore(): LiveRecordStore {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
  const file = join(dir, "live.json");
  let all: Record<string, string> | null = null;
  const current = (): Record<string, string> => {
    if (all) return all;
    try {
      all = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
    } catch {
      all = {};
    }
    return all;
  };
  const write = () => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(current()));
    renameSync(tmp, file);
  };
  return {
    async save(key, json) {
      current()[key] = json;
      write();
    },
    async loadAll() {
      return new Map(Object.entries(current()));
    },
    async remove(keys) {
      if (keys.length === 0) return;
      for (const k of keys) delete current()[k];
      write();
    },
  };
}

/** Sin persistencia (tests, scripts): nada que guardar ni que restaurar. */
const offStore: LiveRecordStore = {
  async save() {},
  async loadAll() {
    return new Map();
  },
  async remove() {},
};

let impl: LiveRecordStore | undefined;
const store = (): LiveRecordStore =>
  (impl ??=
    persistenceBackend === "redis"
      ? redisStore()
      : persistenceBackend === "file"
        ? fileStore()
        : offStore);

/** Tests: inyectar un store (o `undefined` para volver al del entorno). */
export function setLiveRecordStoreForTest(s: LiveRecordStore | undefined): void {
  impl = s;
  lastSaved.clear();
}

export const liveRecordKey = (matchId: string, address: string): string =>
  `${matchId}:${address.toLowerCase()}`;

/** El JSON guardado de cada intento, tal cual: guardar lo mismo dos veces no
 *  hace falta (casi todo compromiso trae valores nuevos, pero los que no,
 *  y los reintentos, no escriben). Se poda con `forgetLiveAttempts`. */
const lastSaved = new Map<string, string>();

/** Guarda el intento si cambió desde el último guardado. Resuelve cuando quedó
 *  guardado; si no se pudo, tira `LiveUnavailableError` (y el llamador no
 *  revela nada). */
export async function saveLiveAttempt(
  matchId: string,
  address: string,
  a: LiveAttempt,
): Promise<void> {
  const key = liveRecordKey(matchId, address);
  const json = JSON.stringify(a);
  if (lastSaved.get(key) === json) return;
  try {
    await store().save(key, json);
  } catch (e) {
    console.error(`[live] no se pudo guardar el intento ${key}:`, (e as Error).message);
    throw new LiveUnavailableError("could not save your live attempt — retry in a moment", {
      cause: e,
    });
  }
  lastSaved.set(key, json);
}

export interface StoredLiveAttempt {
  matchId: string;
  address: string;
  attempt: LiveAttempt;
}

/** Todos los intentos guardados (al arrancar). Los que se leen ya están
 *  guardados: no se vuelven a escribir si no cambian. */
export async function loadLiveAttempts(): Promise<StoredLiveAttempt[]> {
  const out: StoredLiveAttempt[] = [];
  const broken: string[] = [];
  for (const [key, json] of await store().loadAll()) {
    const cut = key.lastIndexOf(":");
    let attempt: LiveAttempt | undefined;
    try {
      attempt = JSON.parse(json) as LiveAttempt;
    } catch {
      attempt = undefined;
    }
    if (cut <= 0 || !attempt || !Number.isInteger(attempt.tick) || !Array.isArray(attempt.flaps)) {
      broken.push(key);
      continue;
    }
    lastSaved.set(key, json);
    out.push({ matchId: key.slice(0, cut), address: key.slice(cut + 1), attempt });
  }
  if (broken.length) {
    console.error(`[live] registros ilegibles, se descartan: ${broken.join(", ")}`);
    await store()
      .remove(broken)
      .catch(() => {});
  }
  return out;
}

/** Borra los registros de una partida que ya no existe (se purgó o nunca se
 *  restauró). No espera: es limpieza, y si falla se reintenta la próxima vez
 *  que se purgue o se arranque. */
export function forgetLiveAttempts(matchId: string, addresses: string[]): void {
  const keys = addresses.map((a) => liveRecordKey(matchId, a));
  for (const k of keys) lastSaved.delete(k);
  if (keys.length === 0) return;
  store()
    .remove(keys)
    .catch((e) => console.error("[live] no se pudo borrar un registro:", (e as Error).message));
}

// ---- Un pedido por intento a la vez -------------------------------------------
// Guardar es asíncrono: sin este cerrojo, dos compromisos del mismo intento (un
// reintento que se cruza con el original, por ejemplo) podían avanzar el motor
// a la vez. Cada intento atiende sus pedidos de a uno; intentos distintos no se
// esperan entre sí.

const locks = new Map<string, Promise<void>>();

export async function withLiveLock<T>(
  matchId: string,
  address: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = liveRecordKey(matchId, address);
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => mine);
  locks.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    // El último de la fila se lleva la entrada: el mapa no crece.
    if (locks.get(key) === tail) locks.delete(key);
  }
}

/** Tests: olvidar lo guardado y los cerrojos (no toca el store). */
export function __resetLiveStoreForTest(): void {
  lastSaved.clear();
  locks.clear();
}
