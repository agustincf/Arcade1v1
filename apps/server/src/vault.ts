// LA BÓVEDA — salas del formato multi-agente (4 a 8 asientos, pozo único).
//
// El árbitro NO tiene lógica de juego: guarda cada sala como un REGISTRO de
// eventos (acciones firmadas + cierres de fase) y deriva el estado con el motor
// puro del game-sdk (`replayVault`). Lo que sí decide el árbitro: cuándo cierra
// cada fase (su reloj), qué firma vale, y la liquidación (pagos + ELO).
//
// Confianza: la semilla secreta se sortea al arrancar, se publica su hash
// (`commit`) y se revela al terminar; con el registro público cualquiera
// re-simula la sala y tiene que obtener la misma tabla de pagos.
//
// Persistencia vía persist.ts (Redis o archivo; opt-in). El ESTADO no se
// persiste: se re-simula del registro al restaurar (mismo camino que usa
// cualquier verificador externo — si se rompe, se nota primero acá).

import { randomBytes } from "node:crypto";
import { keccak256, recoverMessageAddress, type Hex } from "viem";
import {
  createVault,
  replayVault,
  viewFor,
  VAULT_RULES,
  VAULT_RULES_V,
  type VaultEvent,
  type VaultState,
  type VaultView,
  type SeatStatus,
} from "@arcade1v1/game-sdk/vault";
import { matchmakeAuthMessage, MATCHMAKE_AUTH_TTL_MS } from "@arcade1v1/game-sdk/auth";
import { AUTH_REQUIRED } from "./matchmaking.js";
import type { RatingUpdate } from "./ratings.js";
import { jsonStore } from "./persist.js";
import { recordMatchCreated } from "./stats.js";

/** Error esperable (pedido inválido, sala cerrada, firma mala…): las rutas lo
 *  devuelven como 400. Cualquier otro error es un bug y va como 500 + log. */
export class VaultError extends Error {}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const envNum = (key: string, def: number) => {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : def;
};

// Perillas de entorno (ver docs/CONFIGURATION.md). Los asientos se pueden
// achicar dentro de [4, 8], nunca agrandar: son reglas del motor.
export const VAULT_MIN_SEATS = clamp(
  envNum("VAULT_MIN_SEATS", VAULT_RULES.MIN_SEATS),
  VAULT_RULES.MIN_SEATS,
  VAULT_RULES.MAX_SEATS,
);
export const VAULT_MAX_SEATS = clamp(
  envNum("VAULT_MAX_SEATS", VAULT_RULES.MAX_SEATS),
  VAULT_MIN_SEATS,
  VAULT_RULES.MAX_SEATS,
);
export const VAULT_LOBBY_MS = envNum("VAULT_LOBBY_MS", 10 * 60_000);
export const VAULT_PHASE_MS = envNum("VAULT_PHASE_MS", 2 * 60_000);
export const VAULT_TICK_MS = envNum("VAULT_TICK_MS", 5_000);
export const VAULT_MAX_ROOMS = envNum("VAULT_MAX_ROOMS", 50);
export const VAULT_FINISHED_TTL_MS = envNum("VAULT_FINISHED_TTL_MS", 7 * 24 * 60 * 60_000);
// Etapa 1: SOLO la mesa gratis. Las mesas de plata llegan con el contrato de N
// depósitos (etapa 4); hasta entonces aceptar otro stake crearía salas sin escrow.
const STAKES_ALLOWED = [0];
/** Kill switch, leído por llamada. */
export const vaultEnabled = () => process.env.VAULT_ENABLED !== "false";

export type RoomStatus = "lobby" | "playing" | "settled" | "dissolved";

export interface VaultRoom {
  id: Hex;
  stake: number;
  status: RoomStatus;
  seats: string[]; // orden de llegada, minúsculas
  createdAt: number;
  startedAt?: number;
  settledAt?: number; // también para `dissolved` (fecha de cierre)
  commit?: Hex; // keccak256(secretSeed), público desde el arranque
  secretSeed?: Hex; // NUNCA sale en una vista hasta `settled`
  events: VaultEvent[]; // el registro: única fuente de verdad del juego
  phaseDeadline?: number;
  payouts?: Record<string, number>;
  eloUpdates?: Record<string, RatingUpdate>;
}

export type VaultRoomView = {
  roomId: Hex;
  stake: number;
  status: RoomStatus;
  rulesV: number;
  min: number;
  max: number;
  createdAt: number;
  closesAt?: number; // lobby: cuándo arranca o se disuelve
  startedAt?: number;
  settledAt?: number;
  commit?: Hex;
  secretSeed?: Hex; // solo `settled`
  deadline?: number; // fin de la fase actual
  rating?: RatingUpdate; // `settled`, para el asiento que consulta
  seats: { address: string; status: SeatStatus; pocket: number }[];
} & Partial<Omit<VaultView, "seats">>;

export interface VaultAuth {
  signature: string;
  ts: number;
}

export interface LobbySummary {
  roomId: Hex;
  stake: number;
  seats: number;
  min: number;
  max: number;
  closesAt: number;
}

const rooms = new Map<string, VaultRoom>();
const openLobby = new Map<number, string>(); // stake -> roomId del lobby abierto
const states = new Map<string, VaultState>(); // cache del estado derivado
const store$ = jsonStore("vault");
const normAddr = (a: string) => String(a).toLowerCase();
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const randomHex32 = () => ("0x" + randomBytes(32).toString("hex")) as Hex;

// ---- Persistencia ----------------------------------------------------------

export function serializeVault(): string {
  return JSON.stringify([...rooms.values()]);
}

export function restoreVaultFrom(raw: string): void {
  const arr = JSON.parse(raw) as VaultRoom[];
  for (const room of arr) {
    rooms.set(room.id, room);
    states.delete(room.id);
    if (room.status === "lobby") openLobby.set(room.stake, room.id);
  }
}

/** Restaura las salas guardadas. La llama index.ts ANTES de escuchar. */
export async function restoreVault(): Promise<void> {
  const raw = await store$.load();
  if (!raw) return;
  try {
    restoreVaultFrom(raw);
    console.log(`Salas de La Bóveda recuperadas: ${rooms.size}`);
  } catch (e) {
    console.error("vault restore (dato corrupto, arrancamos limpio):", (e as Error).message);
  }
}

function persist() {
  store$.save(serializeVault);
}

/** Estado del motor de una sala, derivado del registro (con cache). */
export function stateOf(room: VaultRoom): VaultState {
  let s = states.get(room.id);
  if (!s) {
    s = replayVault(room.secretSeed!, room.seats, room.events);
    states.set(room.id, s);
  }
  return s;
}

// ---- Lobby ------------------------------------------------------------------

function liveRoomOf(address: string): VaultRoom | undefined {
  for (const r of rooms.values()) {
    if ((r.status === "lobby" || r.status === "playing") && r.seats.includes(address)) return r;
  }
  return undefined;
}

function liveCount(): number {
  let n = 0;
  for (const r of rooms.values()) if (r.status === "lobby" || r.status === "playing") n++;
  return n;
}

/** Firma del asiento: mismo mensaje que cualquier emparejamiento, con game "vault". */
async function verifySeatAuth(
  stake: number,
  address: string,
  auth: VaultAuth | undefined,
  now: number,
): Promise<void> {
  if (auth?.signature) {
    const ts = Number(auth.ts);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > MATCHMAKE_AUTH_TTL_MS) {
      throw new VaultError("auth expired");
    }
    let signer: string;
    try {
      signer = await recoverMessageAddress({
        message: matchmakeAuthMessage("vault", stake, address, ts),
        signature: auth.signature as Hex,
      });
    } catch {
      throw new VaultError("bad signature");
    }
    if (signer.toLowerCase() !== address) throw new VaultError("bad signature");
  } else if (AUTH_REQUIRED) {
    throw new VaultError("signature required");
  }
}

/** Pedir asiento. Idempotente: si ya estás en una sala viva, la devuelve. */
export async function joinVault(
  stake: number,
  address: string,
  auth?: VaultAuth,
  now = Date.now(),
): Promise<VaultRoomView> {
  if (!vaultEnabled()) throw new VaultError("vault disabled");
  if (!STAKES_ALLOWED.includes(stake)) {
    throw new VaultError(`stake not allowed: ${stake} (mesas: ${STAKES_ALLOWED.join(", ")})`);
  }
  address = normAddr(address);
  if (!ADDRESS_RE.test(address)) throw new VaultError("invalid address");
  await verifySeatAuth(stake, address, auth, now);
  settleDue(now);
  const mine = liveRoomOf(address);
  if (mine) return roomView(mine, address);

  const openId = openLobby.get(stake);
  let room = openId ? rooms.get(openId) : undefined;
  if (!room || room.status !== "lobby") {
    openLobby.delete(stake);
    room = undefined;
  }
  if (!room) {
    if (liveCount() >= VAULT_MAX_ROOMS) throw new VaultError("room limit reached, try again later");
    room = { id: randomHex32(), stake, status: "lobby", seats: [], createdAt: now, events: [] };
    rooms.set(room.id, room);
    openLobby.set(stake, room.id);
  }
  room.seats.push(address);
  if (room.seats.length >= VAULT_MAX_SEATS) startRoom(room, now);
  persist();
  return roomView(room, address);
}

/** Cierra el lobby y arranca la sala: semilla secreta + compromiso público. */
function startRoom(room: VaultRoom, now: number): void {
  const secretSeed = randomHex32();
  room.secretSeed = secretSeed;
  room.commit = keccak256(secretSeed);
  room.status = "playing";
  room.startedAt = now;
  room.phaseDeadline = now + VAULT_PHASE_MS;
  states.set(room.id, createVault(secretSeed, room.seats));
  if (openLobby.get(room.stake) === room.id) openLobby.delete(room.stake);
  recordMatchCreated(now); // métrica: una sala cuenta como una partida
}

function dissolveRoom(room: VaultRoom, now: number): void {
  room.status = "dissolved";
  room.settledAt = now;
  if (openLobby.get(room.stake) === room.id) openLobby.delete(room.stake);
}

/** Vence lobbies (arranca con ≥ mínimo, disuelve si no) y purga salas viejas.
 *  Toda lectura/acción la llama primero con su reloj, así los tests no esperan. */
export function settleDue(now = Date.now()): void {
  let dirty = false;
  for (const room of rooms.values()) {
    if (room.status === "lobby" && now - room.createdAt >= VAULT_LOBBY_MS) {
      if (room.seats.length >= VAULT_MIN_SEATS) startRoom(room, now);
      else dissolveRoom(room, now);
      dirty = true;
    } else if (
      (room.status === "settled" || room.status === "dissolved") &&
      room.settledAt !== undefined &&
      now - room.settledAt > VAULT_FINISHED_TTL_MS
    ) {
      rooms.delete(room.id);
      states.delete(room.id);
      dirty = true;
    }
  }
  if (dirty) persist();
}

// ---- Vistas -------------------------------------------------------------------

export function roomView(room: VaultRoom, address?: string): VaultRoomView {
  const base = {
    roomId: room.id,
    stake: room.stake,
    status: room.status,
    rulesV: VAULT_RULES_V,
    min: VAULT_MIN_SEATS,
    max: VAULT_MAX_SEATS,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    settledAt: room.settledAt,
    commit: room.commit,
  };
  if (room.status === "lobby" || room.status === "dissolved") {
    return {
      ...base,
      closesAt: room.createdAt + VAULT_LOBBY_MS,
      seats: room.seats.map((a) => ({ address: a, status: "alive" as SeatStatus, pocket: 0 })),
    };
  }
  const v = viewFor(stateOf(room), address);
  const out: VaultRoomView = { ...base, ...v, deadline: room.phaseDeadline };
  if (room.status === "settled") {
    out.secretSeed = room.secretSeed;
    const a = address ? normAddr(address) : undefined;
    if (a && room.eloUpdates?.[a]) out.rating = room.eloUpdates[a];
  }
  return out;
}

export function getVaultRoom(
  roomId: string,
  address?: string,
  now = Date.now(),
): VaultRoomView | null {
  settleDue(now);
  const room = rooms.get(roomId);
  return room ? roomView(room, address) : null;
}

export function listVaultLobbies(now = Date.now()): LobbySummary[] {
  settleDue(now);
  const out: LobbySummary[] = [];
  for (const id of openLobby.values()) {
    const r = rooms.get(id);
    if (!r || r.status !== "lobby") continue;
    out.push({
      roomId: r.id,
      stake: r.stake,
      seats: r.seats.length,
      min: VAULT_MIN_SEATS,
      max: VAULT_MAX_SEATS,
      closesAt: r.createdAt + VAULT_LOBBY_MS,
    });
  }
  return out;
}

/** Tests: vaciar todo en memoria (no toca el store). */
export function __resetVaultForTest(): void {
  rooms.clear();
  openLobby.clear();
  states.clear();
}
