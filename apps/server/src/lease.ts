// LA POSTA ENTRE INSTANCIAS. En todo momento hay UNA sola instancia dueña del
// estado del árbitro: la única que atiende, corre relojes y escribe en Redis.
// Un deploy de Render la pasa de la vieja a la nueva (ver handover.ts y el spec
// docs/superpowers/specs/2026-09-18-traspaso-con-timbre-design.md).
//
// POR ÉPOCAS, SIN LUA. Tomar la posta es `INCR arcade:lease:epoch`, que es
// atómico: la dueña es la instancia que sacó el valor ACTUAL, y si dos la
// toman a la vez cada una recibe un número distinto y gana el más alto. Cada
// época tiene su propio registro (`arcade:lease:e:<E>`) que solo escribe su
// dueña, así que nadie puede pisar la marca de otra. La posta del PR #33 era
// UNA clave que se leía y después se escribía: una vieja podía reescribirla
// encima de la nueva, y la nueva dejaba de guardar para siempre sin avisar.

import { randomUUID } from "node:crypto";
import { redisCommand, redisPipeline } from "./redis.js";

export const LEASE_HEARTBEAT_MS = Number(process.env.LEASE_HEARTBEAT_MS ?? 60_000);
/** Sin latir este tiempo, la dueña se da por muerta (tres latidos). */
export const LEASE_STALE_MS = Number(process.env.LEASE_STALE_MS ?? 3 * LEASE_HEARTBEAT_MS);

const EPOCH_KEY = "arcade:lease:epoch";
const recordKey = (e: number) => `arcade:lease:e:${e}`;
const HANDOVER_KEY = "arcade:lease:handover";
/** La posta de una sola clave del PR #33: solo importa en la transición. */
const LEGACY_KEY = "arcade:lease";

/** Identidad de este proceso: cada deploy o reinicio es una instancia nueva. */
export const INSTANCE_ID = randomUUID();

export interface LeaseRecord {
  id: string;
  /** RENDER_INSTANCE_ID, para cruzar con los logs de Render. */
  instance?: string;
  /** Último latido. */
  at: number;
  state: "active" | "released";
}

export interface LegacyLease {
  id: string;
  at: number;
  released: boolean;
}

/** Lo que ve una instancia al mirar la posta. */
export interface LeaseView {
  /** La época actual (null: nunca se tomó con este formato). */
  epoch: number | null;
  /** El registro de esa época (null: su dueña no llegó a escribirlo). */
  record: LeaseRecord | null;
  /** La posta del #33, si todavía no hay épocas. */
  legacy: LegacyLease | null;
}

export type LeaseStatus = "none" | "released" | "stale" | "held" | "legacy-held";

export interface HandoverRequest {
  by: string;
  forEpoch: number;
  at: number;
}

let epoch: number | null = null;
let holding = false;
const lostHandlers: (() => void)[] = [];
let hbTimer: NodeJS.Timeout | undefined;
let hbInFlight: Promise<void> | null = null;

function parse<T>(raw: unknown, ok: (v: Partial<T>) => boolean): T | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw) as Partial<T>;
    return v && typeof v === "object" && ok(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

const parseRecord = (raw: unknown) =>
  parse<LeaseRecord>(
    raw,
    (v) =>
      typeof v.id === "string" &&
      typeof v.at === "number" &&
      (v.state === "active" || v.state === "released"),
  );

const parseLegacy = (raw: unknown) =>
  parse<LegacyLease>(raw, (v) => typeof v.id === "string" && typeof v.at === "number");

/** La época actual en Redis (null si nunca se tomó). */
export async function currentEpoch(): Promise<number | null> {
  const raw = await redisCommand(["GET", EPOCH_KEY]);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function readLease(): Promise<LeaseView> {
  const e = await currentEpoch();
  if (e === null) {
    const legacy = parseLegacy(await redisCommand(["GET", LEGACY_KEY]));
    return { epoch: null, record: null, legacy };
  }
  const record = parseRecord(await redisCommand(["GET", recordKey(e)]));
  return { epoch: e, record, legacy: null };
}

/** Qué significa lo que se ve. */
export function classifyLease(v: LeaseView, now = Date.now()): LeaseStatus {
  if (v.epoch === null) {
    const l = v.legacy;
    if (!l) return "none";
    if (l.released) return "released";
    return now - l.at > LEASE_STALE_MS ? "stale" : "legacy-held";
  }
  const r = v.record;
  // Una época sin registro: su dueña sacó el número y se cayó antes de
  // escribirlo. Nadie la sostiene.
  if (!r) return "stale";
  if (r.state === "released") return "released";
  return now - r.at > LEASE_STALE_MS ? "stale" : "held";
}

function recordNow(state: LeaseRecord["state"]): string {
  const rec: LeaseRecord = {
    id: INSTANCE_ID,
    instance: process.env.RENDER_INSTANCE_ID,
    at: Date.now(),
    state,
  };
  return JSON.stringify(rec);
}

/** Tomar la posta: una época nueva. Si había una posta del #33, la marca como
 *  nuestra: una instancia con ese código deja de escribir en su próximo latido. */
export async function acquireLease(view?: LeaseView): Promise<number> {
  epoch = Number(await redisCommand(["INCR", EPOCH_KEY]));
  holding = true;
  await redisCommand(["SET", recordKey(epoch), recordNow("active")]);
  if (view?.legacy) {
    const mine: LegacyLease = { id: INSTANCE_ID, at: Date.now(), released: false };
    await redisCommand(["SET", LEGACY_KEY, JSON.stringify(mine)]);
  }
  return epoch;
}

export const isHolder = (): boolean => holding;
export const myEpoch = (): number | null => epoch;

/** Se llama cuando esta instancia descubre que perdió la posta sin soltarla. */
export function onLeaseLost(fn: () => void): void {
  lostHandlers.push(fn);
}

function markLost(why: string): void {
  if (!holding) return;
  holding = false;
  stopLeaseHeartbeat();
  console.error(`⚠️ Posta perdida (${why}): esta instancia deja de escribir y se cerca`);
  for (const fn of lostHandlers) fn();
}

/** ¿La época actual sigue siendo la mía? Si no, se da por perdida. Un error de
 *  red TIRA: no es lo mismo que "ya no soy la dueña". */
export async function confirmHolder(): Promise<boolean> {
  if (!holding || epoch === null) return false;
  const cur = await currentEpoch();
  if (cur === epoch) return true;
  markLost(`la época actual es ${cur}, la mía era ${epoch}`);
  return false;
}

/** Un latido: chequea la época y renueva el registro, en un solo pedido. */
export async function leaseHeartbeat(): Promise<void> {
  if (!holding || epoch === null) return;
  const mine = epoch;
  const [cur] = await redisPipeline([
    ["GET", EPOCH_KEY],
    ["SET", recordKey(mine), recordNow("active")],
  ]);
  if (Number(cur) !== mine) markLost(`la época actual es ${String(cur)}, la mía era ${mine}`);
}

export function startLeaseHeartbeat(): void {
  if (hbTimer) return;
  hbTimer = setInterval(() => {
    if (hbInFlight) return;
    hbInFlight = leaseHeartbeat()
      .catch((e) => console.error("posta, latido:", (e as Error).message))
      .finally(() => {
        hbInFlight = null;
      });
  }, LEASE_HEARTBEAT_MS);
  hbTimer.unref?.();
}

export function stopLeaseHeartbeat(): void {
  if (hbTimer) clearInterval(hbTimer);
  hbTimer = undefined;
}

/** Soltar la posta: la instancia nueva ya puede cargar lo guardado. Antes frena
 *  el latido y espera el que estuviera en vuelo, para que un "active" tardío no
 *  pise el "released". Si Upstash falla, TIRA y esta instancia sigue dueña. */
export async function releaseLease(): Promise<void> {
  if (!holding || epoch === null) return;
  stopLeaseHeartbeat();
  if (hbInFlight) await hbInFlight;
  await redisCommand(["SET", recordKey(epoch), recordNow("released")]);
  holding = false;
}

/** La instancia nueva pide la posta de la época `forEpoch`. */
export async function requestHandover(forEpoch: number): Promise<void> {
  const req: HandoverRequest = { by: INSTANCE_ID, forEpoch, at: Date.now() };
  await redisCommand(["SET", HANDOVER_KEY, JSON.stringify(req)]);
}

export async function readHandoverRequest(): Promise<HandoverRequest | null> {
  return parse<HandoverRequest>(
    await redisCommand(["GET", HANDOVER_KEY]),
    (v) => typeof v.by === "string" && typeof v.forEpoch === "number" && typeof v.at === "number",
  );
}

/** Tests: volver al estado de recién arrancada. */
export function resetLeaseForTests(): void {
  stopLeaseHeartbeat();
  epoch = null;
  holding = false;
  hbInFlight = null;
  lostHandlers.length = 0;
}
