// EL REGISTRO DURABLE DE CADA INTENTO EN VIVO (Flappy y Carrera).
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
// QUÉ SE GUARDA: cada intento son varios campos del hash `arcade:live`.
//   - `<matchId>:<address>`, la CABECERA: el intento sin sus jugadas (token,
//     tick, revelados, final), más `wire` (si sus jugadas son `flaps` o
//     `inputs`) y `moves` (cuántas hay hasta su tick).
//   - `<matchId>:<address>#<from>`, un TRAMO: las jugadas en `[from, to)` y el
//     avance al llegar a `to` (revelados, final).
// Cada compromiso escribe UN campo: su tramo, desde donde había quedado lo
// guardado. La cabecera se reescribe solo si cambia algo que no es avance (el
// token, al retomar el intento) o si el avance cambia sin que el tick avance (un
// cierre en el mismo tick). Cuando van las dos, van en el MISMO comando (un HSET
// con varios campos): o quedan las dos o ninguna.
//
// Para rearmar el intento se recorren los tramos desde el 0, de `to` en `to`,
// pasando por el tick de la cabecera, hasta que no hay más: el último dice el
// avance. Un reintento (una respuesta que se perdió) vuelve a subir el tramo
// desde el mismo `from`: pisa el mismo campo y no duplica jugadas. Un intento que
// se reescribe entero (un registro viejo, o uno que no sigue a lo guardado)
// estrena una generación (`g`), y los tramos que quedaran de antes no se leen.
//
// Antes cada compromiso reescribía el intento entero: una partida típica de
// Space Invaders (~750 jugadas, ~90 compromisos) subía ~790 KB por jugador; así,
// ~37 KB. Los registros con ese formato (el intento entero en la cabecera, sin
// `wire`) se siguen leyendo, y el primer cambio los pasa a tramos.
//
// Diseño: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md,
// "Por qué alcanza, y qué no cubre" (decidido el 2026-09-22 para antes de
// mainnet; los tramos, el 2026-11-18, antes de Space Invaders en vivo).

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { redisCommand, redisPipeline } from "./redis.js";
import { EPOCH_READ, epochStillMine, isHolder } from "./lease.js";
import { handoverEnabled, persistenceBackend } from "./persist.js";
import type { LiveInput } from "@arcade1v1/game-sdk/live";
import type { LiveAttempt } from "./matchmaking.js";

/** No se pudo guardar el intento: el pedido no revela nada y se reintenta. Las
 *  rutas lo contestan con 503 (un cliente lo reintenta solo). */
export class LiveUnavailableError extends Error {}

/** Dónde se guarda: campos de UN hash de Redis (la cabecera y los tramos de
 *  cada intento, ver arriba). Al arrancar se leen todos en un pedido. */
export interface LiveRecordStore {
  /** Escribe estos campos (de un mismo intento) YA y juntos, en un solo
   *  comando: o quedan todos o ninguno. Resuelve solo si quedó guardado; si no,
   *  rechaza. */
  save(fields: [string, string][]): Promise<void>;
  loadAll(): Promise<Map<string, string>>;
  remove(fields: string[]): Promise<void>;
}

const LIVE_HASH = "arcade:live";

function redisStore(): LiveRecordStore {
  return {
    async save(fields) {
      const hset = ["HSET", LIVE_HASH, ...fields.flat()];
      if (!handoverEnabled) {
        await redisCommand(hset);
        return;
      }
      // Con traspaso escribe solo la dueña de la posta, como el resto del
      // estado (persist.ts). La época se lee en el MISMO pedido que escribe:
      // esto va en el camino de cada respuesta al jugador, que tiene 0,25 s de
      // margen, y no puede pagar dos idas y vueltas. Si resulta que la posta
      // era de otra, el intento no se da por guardado (nada se revela) y esta
      // instancia se cerca.
      if (!isHolder()) throw new Error("live store: sin la posta, no se guarda");
      const [cur] = await redisPipeline([[...EPOCH_READ], hset]);
      if (!epochStillMine(cur)) throw new Error("live store: la posta es de otra instancia");
    },
    async loadAll() {
      const flat = (await redisCommand(["HGETALL", LIVE_HASH])) as string[] | null;
      const out = new Map<string, string>();
      for (let i = 0; flat && i + 1 < flat.length; i += 2) out.set(flat[i], flat[i + 1]);
      return out;
    },
    async remove(fields) {
      if (fields.length === 0 || (handoverEnabled && !isHolder())) return;
      await redisCommand(["HDEL", LIVE_HASH, ...fields]);
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
    async save(fields) {
      for (const [field, value] of fields) current()[field] = value;
      write();
    },
    async loadAll() {
      return new Map(Object.entries(current()));
    },
    async remove(fields) {
      if (fields.length === 0) return;
      for (const f of fields) delete current()[f];
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
  saved.clear();
}

export const liveRecordKey = (matchId: string, address: string): string =>
  `${matchId}:${address.toLowerCase()}`;

/** El campo del tramo de `key` que empieza en el tick `from`. */
const partField = (key: string, from: number): string => `${key}#${from}`;

/** Cómo viajan las jugadas de un intento: Flappy guarda los ticks de sus
 *  aleteos (`flaps`); los demás, `{ t, a }` (`inputs`). */
type Wire = "flaps" | "inputs";
type Move = number | LiveInput;
const wireOf = (a: LiveAttempt): Wire => (a.flaps ? "flaps" : "inputs");
const movesOf = (a: LiveAttempt): readonly Move[] => a.flaps ?? a.inputs ?? [];
const tickOf = (m: Move): number => (typeof m === "number" ? m : m.t);
/** Una jugada como se guarda: el tick (Flappy) o solo `{ t, a }`. */
const plain = (m: Move): Move => (typeof m === "number" ? m : { t: m.t, a: m.a });

/** Lo que avanza en cada compromiso: viaja en el tramo que lo produjo. */
const PROGRESS = ["tick", "revealed", "over", "score"] as const;

/** Lo fijo del intento (el token, cuándo empezó): todo menos las jugadas y el
 *  avance. Si cambia, se reescribe la cabecera. */
function metaOf(a: LiveAttempt): string {
  const rest: Partial<LiveAttempt> = { ...a };
  delete rest.flaps;
  delete rest.inputs;
  for (const k of PROGRESS) delete rest[k];
  return JSON.stringify(rest);
}

/** El avance sin el tick: revelados y final. */
const progressOf = (a: LiveAttempt): string =>
  JSON.stringify({ revealed: a.revealed, over: a.over, score: a.score });

/** La cabecera: el intento sin sus jugadas, cómo viajan, cuántas hay y su
 *  generación (si no es la primera). */
function headOf(a: LiveAttempt, moves: number, gen: number): string {
  const rest: Partial<LiveAttempt> = { ...a };
  delete rest.flaps;
  delete rest.inputs;
  return JSON.stringify({ ...rest, wire: wireOf(a), moves, ...(gen ? { g: gen } : {}) });
}

/** Un tramo: hasta dónde llega, el avance ahí, y sus jugadas. */
function trancheOf(a: LiveAttempt, moves: readonly Move[], gen: number): string {
  return JSON.stringify({
    to: a.tick,
    revealed: a.revealed,
    over: a.over,
    score: a.score,
    ...(gen ? { g: gen } : {}),
    [wireOf(a)]: moves.map(plain),
  });
}

/** Lo que este proceso sabe que hay guardado de cada intento. Se poda con
 *  `forgetLiveAttempts`. */
interface Saved {
  /** Formato por tramos: lo fijo y el avance que quedaron guardados... */
  meta?: string;
  progress?: string;
  /** ...o el JSON entero de un registro viejo, tal como se leyó. */
  legacy?: string;
  wire: Wire;
  /** Las jugadas están guardadas hasta este tick, y son estas tantas. */
  tick: number;
  moves: number;
  /** La generación de los tramos vigentes. */
  gen: number;
  /** Dónde empiezan los tramos que puede haber en el store, para borrarlos
   *  con el intento. */
  parts: Set<number>;
}
const saved = new Map<string, Saved>();

/** ¿El intento en memoria sigue a lo guardado? Las jugadas solo se agregan y
 *  el tick solo avanza, así que sí: lo nuevo son las jugadas desde la número
 *  `prev.moves`, todas en `[prev.tick, a.tick)`. Si no (no debería pasar), se
 *  reescribe entero. */
function follows(prev: Saved, a: LiveAttempt, all: readonly Move[]): boolean {
  if (prev.meta === undefined || prev.wire !== wireOf(a)) return false;
  if (a.tick < prev.tick || all.length < prev.moves) return false;
  for (let i = prev.moves; i < all.length; i++) {
    const t = tickOf(all[i]);
    if (t < prev.tick || t >= a.tick) return false;
  }
  return true;
}

/** Guarda lo que cambió del intento desde el último guardado: si avanzó, su
 *  tramo nuevo (las jugadas desde donde había quedado lo guardado, y el
 *  avance); la cabecera, si hace falta (ver arriba). Resuelve cuando quedó
 *  guardado; si no se pudo, tira `LiveUnavailableError` (y el llamador no
 *  revela nada). */
export async function saveLiveAttempt(
  matchId: string,
  address: string,
  a: LiveAttempt,
): Promise<void> {
  const key = liveRecordKey(matchId, address);
  const prev = saved.get(key);
  if (prev?.legacy !== undefined && prev.legacy === JSON.stringify(a)) return;
  const all = movesOf(a);
  const meta = metaOf(a);
  const progress = progressOf(a);
  // Desde dónde se sube: lo que sigue a lo guardado, o todo desde el tick 0
  // (nada guardado todavía, un registro viejo, o un intento que no sigue), con
  // una generación nueva.
  const base = prev && follows(prev, a, all) ? prev : undefined;
  if (base && a.tick === base.tick && meta === base.meta && progress === base.progress) return;
  const gen = base ? base.gen : prev ? prev.gen + 1 : 0;
  const from = base ? base.tick : 0;
  const fields: [string, string][] = [];
  if (!base || meta !== base.meta || a.tick === base.tick) {
    fields.push([key, headOf(a, all.length, gen)]);
  }
  // Un tramo sin jugadas también se escribe: su `to` es el eslabón al tramo
  // siguiente, y lleva el avance.
  if (a.tick > from) {
    fields.push([partField(key, from), trancheOf(a, all.slice(base ? base.moves : 0), gen)]);
  }
  // El tramo se anota aunque falle: la escritura puede haber llegado y perderse
  // la respuesta, y entonces hay que borrarlo con el intento.
  const parts = new Set(prev?.parts ?? []);
  if (a.tick > from) parts.add(from);
  try {
    await store().save(fields);
  } catch (e) {
    // No se sabe si quedó: lo que sigue se vuelve a subir desde lo último
    // seguro, y si había quedado se pisa el mismo campo.
    const before = prev ?? { wire: wireOf(a), tick: 0, moves: 0, gen };
    saved.set(key, { ...before, gen: Math.max(before.gen, gen), parts });
    console.error(`[live] no se pudo guardar el intento ${key}:`, (e as Error).message);
    throw new LiveUnavailableError("could not save your live attempt — retry in a moment", {
      cause: e,
    });
  }
  saved.set(key, { meta, progress, wire: wireOf(a), tick: a.tick, moves: all.length, gen, parts });
}

/** Las jugadas de un registro viejo: `flaps` (Flappy) o `inputs` (los
 *  demás), y lo que haya tiene que ser una lista. */
const movesOk = (a: LiveAttempt) =>
  (a.flaps === undefined || Array.isArray(a.flaps)) &&
  (a.inputs === undefined || Array.isArray(a.inputs)) &&
  (Array.isArray(a.flaps) || Array.isArray(a.inputs));

export interface StoredLiveAttempt {
  matchId: string;
  address: string;
  attempt: LiveAttempt;
}

const isTick = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

/** Arma UN intento con su cabecera y sus tramos (los campos `#<from>` de su
 *  clave), o `undefined` si no se puede: JSON roto, un hueco antes del tick de
 *  la cabecera, una jugada fuera de su tramo o una cuenta de jugadas que no
 *  da. */
function decodeOne(
  json: string,
  parts: ReadonlyMap<number, string>,
): { attempt: LiveAttempt; saved: Omit<Saved, "parts"> } | undefined {
  let rec: any;
  try {
    rec = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!rec || typeof rec !== "object" || !isTick(rec.tick)) return undefined;
  if (rec.wire === undefined) {
    // Formato viejo: el intento entero, con sus jugadas.
    if (!movesOk(rec)) return undefined;
    const attempt = rec as LiveAttempt;
    const moves = movesOf(attempt).length;
    return {
      attempt,
      saved: { legacy: json, wire: wireOf(attempt), tick: rec.tick, moves, gen: 0 },
    };
  }
  const wire = rec.wire as Wire;
  const gen = rec.g ?? 0;
  if ((wire !== "flaps" && wire !== "inputs") || !isTick(rec.moves) || !isTick(gen)) {
    return undefined;
  }
  const moves: Move[] = [];
  let last: any;
  let cur = 0;
  for (;;) {
    if (cur === rec.tick && moves.length !== rec.moves) return undefined;
    const raw = parts.get(cur);
    if (raw === undefined) break;
    let tr: any;
    try {
      tr = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (!tr || typeof tr !== "object") return undefined;
    // De otra generación: es de antes de una reescritura, y ahí termina.
    if ((tr.g ?? 0) !== gen) break;
    if (!isTick(tr.to) || tr.to <= cur || !isTick(tr.revealed) || !Array.isArray(tr[wire])) {
      return undefined;
    }
    // La cabecera cae justo en el borde de un tramo.
    if (cur < rec.tick && tr.to > rec.tick) return undefined;
    for (const m of tr[wire] as unknown[]) {
      const t = wire === "flaps" ? m : (m as LiveInput | null)?.t;
      if (!Number.isInteger(t) || (t as number) < cur || (t as number) >= tr.to) return undefined;
      if (wire === "inputs" && typeof (m as LiveInput).a !== "string") return undefined;
      moves.push(plain(m as Move));
    }
    last = tr;
    cur = tr.to;
  }
  if (cur < rec.tick) return undefined;
  const attempt = { ...rec, [wire]: moves } as LiveAttempt & {
    wire?: Wire;
    moves?: number;
    g?: number;
  };
  delete attempt.wire;
  delete attempt.moves;
  delete attempt.g;
  if (cur > rec.tick) {
    // Los tramos siguieron después de la cabecera: el último dice el avance.
    if (rec.over) return undefined; // un intento cerrado no avanza
    attempt.tick = cur;
    attempt.revealed = last.revealed;
    if (last.over) Object.assign(attempt, { over: true, score: last.score });
  } else if (last) {
    // La cabecera se escribió en el mismo tick que el último tramo, o después.
    attempt.revealed = Math.max(attempt.revealed, last.revealed);
    if (!attempt.over && last.over) Object.assign(attempt, { over: true, score: last.score });
  }
  return {
    attempt,
    saved: {
      meta: metaOf(attempt),
      progress: progressOf(attempt),
      wire,
      tick: attempt.tick,
      moves: moves.length,
      gen,
    },
  };
}

/** Todos los registros de un hash leído entero: los que se arman y, aparte,
 *  los campos ilegibles (`junk`: de registros que no se arman, o tramos sin
 *  cabecera) y de qué intentos son (`broken`, para el log). */
function decodeAll(all: ReadonlyMap<string, string>) {
  const heads = new Map<string, string>();
  const tranches = new Map<string, Map<number, string>>();
  const junk: string[] = [];
  const broken: string[] = [];
  for (const [field, value] of all) {
    const hash = field.indexOf("#");
    if (hash < 0) {
      heads.set(field, value);
      continue;
    }
    const key = field.slice(0, hash);
    const from = field.slice(hash + 1);
    if (!/^\d+$/.test(from)) {
      junk.push(field);
      broken.push(field);
      continue;
    }
    let mine = tranches.get(key);
    if (!mine) tranches.set(key, (mine = new Map()));
    mine.set(Number(from), value);
  }
  const ok: (StoredLiveAttempt & { key: string; saved: Saved })[] = [];
  for (const [key, json] of heads) {
    const parts = tranches.get(key) ?? new Map<number, string>();
    tranches.delete(key);
    const cut = key.lastIndexOf(":");
    const d = cut > 0 ? decodeOne(json, parts) : undefined;
    if (!d) {
      junk.push(key, ...[...parts.keys()].map((p) => partField(key, p)));
      broken.push(key);
      continue;
    }
    ok.push({
      matchId: key.slice(0, cut),
      address: key.slice(cut + 1),
      attempt: d.attempt,
      key,
      // Todos sus tramos, en el camino o no: se borran con el intento.
      saved: { ...d.saved, parts: new Set(parts.keys()) },
    });
  }
  // Tramos sin cabecera: de un intento que se borró a medias.
  for (const [key, parts] of tranches) {
    junk.push(...[...parts.keys()].map((p) => partField(key, p)));
    broken.push(`${key} (${parts.size} tramos sin cabecera)`);
  }
  return { ok, junk, broken };
}

/** Los intentos de un hash leído entero (sin tocar nada): para mirar lo
 *  guardado (tests, diagnóstico). */
export function decodeLiveRecords(all: ReadonlyMap<string, string>): StoredLiveAttempt[] {
  return decodeAll(all).ok.map(({ matchId, address, attempt }) => ({ matchId, address, attempt }));
}

/** Todos los intentos guardados (al arrancar). Los que se leen ya están
 *  guardados: no se vuelven a escribir si no cambian. */
export async function loadLiveAttempts(): Promise<StoredLiveAttempt[]> {
  const { ok, junk, broken } = decodeAll(await store().loadAll());
  for (const r of ok) saved.set(r.key, r.saved);
  if (junk.length) {
    console.error(`[live] registros ilegibles, se descartan: ${broken.join(", ")}`);
    await store()
      .remove(junk)
      .catch(() => {});
  }
  return ok.map(({ matchId, address, attempt }) => ({ matchId, address, attempt }));
}

/** Borra los registros de una partida que ya no existe (se purgó o nunca se
 *  restauró): la cabecera y todos los tramos de cada intento. No espera: es
 *  limpieza, y si falla se reintenta la próxima vez que se purgue o se
 *  arranque. */
export function forgetLiveAttempts(matchId: string, addresses: string[]): void {
  const fields: string[] = [];
  for (const address of addresses) {
    const key = liveRecordKey(matchId, address);
    fields.push(key, ...[...(saved.get(key)?.parts ?? [])].map((p) => partField(key, p)));
    saved.delete(key);
  }
  if (fields.length === 0) return;
  store()
    .remove(fields)
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
  saved.clear();
  locks.clear();
}
