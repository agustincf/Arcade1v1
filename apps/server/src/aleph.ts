// ALEPH — salas del formato multi-agente (4 a 8 asientos, pozo único).
//
// El árbitro NO tiene lógica de juego: guarda cada sala como un REGISTRO de
// eventos (acciones firmadas + cierres de fase) y deriva el estado con el motor
// puro del game-sdk (`replayAleph`). Lo que sí decide el árbitro: cuándo cierra
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
  createAleph,
  replayAleph,
  viewFor,
  applyEvent,
  phaseComplete,
  validateAction,
  actionLine,
  ALEPH_RULES,
  ALEPH_RULES_V,
  type AlephAction,
  type AlephEvent,
  type AlephState,
  type AlephView,
  type SeatStatus,
  type PhaseEndReason,
} from "@arcade1v1/game-sdk/aleph";
import {
  matchmakeAuthMessage,
  alephActionAuthMessage,
  alephViewAuthMessage,
  MATCHMAKE_AUTH_TTL_MS,
} from "@arcade1v1/game-sdk/auth";
import { AUTH_REQUIRED } from "./matchmaking.js";
import { applyMultiResult, type RatingUpdate } from "./ratings.js";
import { jsonStore } from "./persist.js";
import { recordMatchCreated, recordMatchSettled } from "./stats.js";

/** Error esperable (pedido inválido, sala cerrada, firma mala…): las rutas lo
 *  devuelven como 400. Cualquier otro error es un bug y va como 500 + log. */
export class AlephError extends Error {}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const envNum = (key: string, def: number) => {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : def;
};

// Perillas de entorno (ver docs/CONFIGURATION.md). Los asientos se pueden
// achicar dentro de [4, 8], nunca agrandar: son reglas del motor.
export const ALEPH_MIN_SEATS = clamp(
  envNum("ALEPH_MIN_SEATS", ALEPH_RULES.MIN_SEATS),
  ALEPH_RULES.MIN_SEATS,
  ALEPH_RULES.MAX_SEATS,
);
export const ALEPH_MAX_SEATS = clamp(
  envNum("ALEPH_MAX_SEATS", ALEPH_RULES.MAX_SEATS),
  ALEPH_MIN_SEATS,
  ALEPH_RULES.MAX_SEATS,
);
export const ALEPH_LOBBY_MS = envNum("ALEPH_LOBBY_MS", 10 * 60_000);
export const ALEPH_PHASE_MS = envNum("ALEPH_PHASE_MS", 2 * 60_000);
export const ALEPH_TICK_MS = envNum("ALEPH_TICK_MS", 5_000);
export const ALEPH_MAX_ROOMS = envNum("ALEPH_MAX_ROOMS", 50);
export const ALEPH_FINISHED_TTL_MS = envNum("ALEPH_FINISHED_TTL_MS", 7 * 24 * 60 * 60_000);
export const ALEPH_MAX_SETTLED_KEPT = envNum("ALEPH_MAX_SETTLED_KEPT", 50);
// Etapa 1: SOLO la mesa gratis. Las mesas de plata llegan con el contrato de N
// depósitos (etapa 4); hasta entonces aceptar otro stake crearía salas sin escrow.
const STAKES_ALLOWED = [0];
/** Kill switch, leído por llamada. */
export const alephEnabled = () => process.env.ALEPH_ENABLED !== "false";

export type RoomStatus = "lobby" | "playing" | "settled" | "dissolved";

export interface AlephRoom {
  id: Hex;
  stake: number;
  status: RoomStatus;
  seats: string[]; // orden de llegada, minúsculas
  createdAt: number;
  startedAt?: number;
  settledAt?: number; // también para `dissolved` (fecha de cierre)
  commit?: Hex; // keccak256(secretSeed), público desde el arranque
  secretSeed?: Hex; // NUNCA sale en una vista hasta `settled`
  events: AlephEvent[]; // el registro: única fuente de verdad del juego
  phaseDeadline?: number;
  stages?: number; // etapas jugadas, guardadas al liquidar (listar no re-simula)
  payouts?: Record<string, number>;
  eloUpdates?: Record<string, RatingUpdate>;
}

export type AlephRoomView = {
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
} & Partial<Omit<AlephView, "seats">>;

export interface AlephAuth {
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

const rooms = new Map<string, AlephRoom>();
const openLobby = new Map<number, string>(); // stake -> roomId del lobby abierto
const states = new Map<string, AlephState>(); // cache del estado derivado
const store$ = jsonStore("aleph");
const normAddr = (a: string) => String(a).toLowerCase();
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const randomHex32 = () => ("0x" + randomBytes(32).toString("hex")) as Hex;

// ---- Persistencia ----------------------------------------------------------

export function serializeAleph(): string {
  return JSON.stringify([...rooms.values()]);
}

export function restoreAlephFrom(raw: string): void {
  const arr = JSON.parse(raw) as AlephRoom[];
  for (const room of arr) {
    rooms.set(room.id, room);
    states.delete(room.id);
    if (room.status === "lobby") openLobby.set(room.stake, room.id);
  }
}

/** Restaura las salas guardadas. La llama index.ts ANTES de escuchar. */
export async function restoreAleph(): Promise<void> {
  const raw = await store$.load();
  if (!raw) return;
  try {
    restoreAlephFrom(raw);
    console.log(`Salas de Aleph recuperadas: ${rooms.size}`);
  } catch (e) {
    console.error("aleph restore (dato corrupto, arrancamos limpio):", (e as Error).message);
  }
}

function persist() {
  store$.save(serializeAleph);
}

/** Estado del motor de una sala, derivado del registro (con cache). */
export function stateOf(room: AlephRoom): AlephState {
  let s = states.get(room.id);
  if (!s) {
    s = replayAleph(room.secretSeed!, room.seats, room.events);
    states.set(room.id, s);
  }
  return s;
}

// ---- Lobby ------------------------------------------------------------------

/** ¿Ese asiento sigue vivo en esa sala? Una sala que no re-simula cuenta como
 *  "no lo tiene" (se disolverá en su próximo plazo; mientras tanto no puede
 *  dejar a nadie encerrado). */
function seatAlive(room: AlephRoom, address: string): boolean {
  try {
    return stateOf(room).seats.some((x) => x.address === address && x.status === "alive");
  } catch {
    return false;
  }
}

/** La sala que OCUPA a esa address. Un lobby la ocupa siempre; una sala en
 *  juego, solo mientras el asiento siga vivo: el que se fue con una Oferta, el
 *  votado y el que abandonó pueden sentarse en otro lobby sin esperar a que su
 *  sala termine. */
function liveRoomOf(address: string): AlephRoom | undefined {
  for (const r of rooms.values()) {
    if (!r.seats.includes(address)) continue;
    if (r.status === "lobby") return r;
    if (r.status === "playing" && seatAlive(r, address)) return r;
  }
  return undefined;
}

function liveCount(): number {
  let n = 0;
  for (const r of rooms.values()) if (r.status === "lobby" || r.status === "playing") n++;
  return n;
}

/** El patrón de TODA firma de Aleph, en un solo lugar: `ts` fresco, la
 *  firma recupera a la propia address, y sin firma solo se pasa fuera de
 *  producción. El `message` lo arma quien llama (con ese mismo `ts`). */
async function verifySigned(
  message: string,
  signature: string | undefined,
  ts: unknown,
  address: string,
  now: number,
): Promise<void> {
  if (!signature) {
    if (AUTH_REQUIRED) throw new AlephError("signature required");
    return;
  }
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(now - t) > MATCHMAKE_AUTH_TTL_MS) {
    throw new AlephError("auth expired");
  }
  let signer: string;
  try {
    signer = await recoverMessageAddress({ message, signature: signature as Hex });
  } catch {
    throw new AlephError("bad signature");
  }
  if (signer.toLowerCase() !== address) throw new AlephError("bad signature");
}

/** Firma del asiento: mismo mensaje que cualquier emparejamiento, con game "aleph". */
async function verifySeatAuth(
  stake: number,
  address: string,
  auth: AlephAuth | undefined,
  now: number,
): Promise<void> {
  await verifySigned(
    matchmakeAuthMessage("aleph", stake, address, Number(auth?.ts)),
    auth?.signature,
    auth?.ts,
    address,
    now,
  );
}

/** Pedir asiento. Idempotente: si ya estás en una sala viva, la devuelve. */
export async function joinAleph(
  stake: number,
  address: string,
  auth?: AlephAuth,
  now = Date.now(),
): Promise<AlephRoomView> {
  if (!alephEnabled()) throw new AlephError("aleph disabled");
  if (!STAKES_ALLOWED.includes(stake)) {
    throw new AlephError(`stake not allowed: ${stake} (mesas: ${STAKES_ALLOWED.join(", ")})`);
  }
  address = normAddr(address);
  if (!ADDRESS_RE.test(address)) throw new AlephError("invalid address");
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
    if (liveCount() >= ALEPH_MAX_ROOMS) throw new AlephError("room limit reached, try again later");
    room = { id: randomHex32(), stake, status: "lobby", seats: [], createdAt: now, events: [] };
    rooms.set(room.id, room);
    openLobby.set(stake, room.id);
  }
  room.seats.push(address);
  if (room.seats.length >= ALEPH_MAX_SEATS) startRoom(room, now);
  persist();
  return roomView(room, address);
}

/** Cierra el lobby y arranca la sala: semilla secreta + compromiso público. */
/** Tests: fija la semilla de la PRÓXIMA sala que arranque, y se consume ahí
 *  mismo. La semilla es lo único que decide el mazo, así que es la única forma
 *  de llevar una sala a una etapa concreta (la Cerradura, por ejemplo) sin
 *  correr el test veinte veces a ver si sale. A diferencia de forzar el mazo,
 *  el registro sigue re-simulando igual: `stateOf` deriva TODO de la semilla. */
let forcedSeed: Hex | undefined;
export function __forceAlephSeedForTest(seed?: Hex): void {
  forcedSeed = seed;
}

function startRoom(room: AlephRoom, now: number): void {
  const secretSeed = forcedSeed ?? randomHex32();
  forcedSeed = undefined;
  room.secretSeed = secretSeed;
  room.commit = keccak256(secretSeed);
  room.status = "playing";
  room.startedAt = now;
  room.phaseDeadline = now + ALEPH_PHASE_MS;
  states.set(room.id, createAleph(secretSeed, room.seats));
  if (openLobby.get(room.stake) === room.id) openLobby.delete(room.stake);
  recordMatchCreated(now); // métrica: una sala cuenta como una partida
}

function dissolveRoom(room: AlephRoom, now: number): void {
  room.status = "dissolved";
  room.settledAt = now;
  if (openLobby.get(room.stake) === room.id) openLobby.delete(room.stake);
}

/** Lo que le toca a UNA sala cuando pasa el reloj. Devuelve si cambió algo. */
function settleRoomDue(room: AlephRoom, now: number): boolean {
  if (room.status === "lobby" && now - room.createdAt >= ALEPH_LOBBY_MS) {
    // Con el kill switch apagado NUNCA arranca una sala nueva, tenga los
    // asientos que tenga: el lobby que vence se disuelve. Las salas ya en
    // curso siguen cerrando fases por plazo hasta liquidarse.
    if (room.seats.length >= ALEPH_MIN_SEATS && alephEnabled()) startRoom(room, now);
    else dissolveRoom(room, now);
    return true;
  }
  if (room.status === "playing" && room.phaseDeadline !== undefined && now >= room.phaseDeadline) {
    // Pueden vencer varias fases si el proceso estuvo dormido: cada cierre
    // lleva la hora de SU plazo (no `now`), así el registro es fiel.
    while (
      room.status === "playing" &&
      room.phaseDeadline !== undefined &&
      now >= room.phaseDeadline
    ) {
      closePhase(room, "deadline", room.phaseDeadline);
    }
    return true;
  }
  if (
    (room.status === "settled" || room.status === "dissolved") &&
    room.settledAt !== undefined &&
    now - room.settledAt > ALEPH_FINISHED_TTL_MS
  ) {
    rooms.delete(room.id);
    states.delete(room.id);
    return true;
  }
  return false;
}

/** Además del TTL, un TOPE de salas terminadas conservadas. El store es un
 *  blob único: 200 registros completos (~200 kB cada uno) no entran en una
 *  escritura de Upstash, y cuando el SET falla solo se loguea — la persistencia
 *  se corta EN SILENCIO, también para las salas vivas. Se van las más viejas
 *  por `settledAt`. */
function purgeExcessFinished(): boolean {
  const finished = [...rooms.values()].filter(
    (r) => r.status === "settled" || r.status === "dissolved",
  );
  if (finished.length <= ALEPH_MAX_SETTLED_KEPT) return false;
  finished.sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0));
  for (const r of finished.slice(0, finished.length - ALEPH_MAX_SETTLED_KEPT)) {
    rooms.delete(r.id);
    states.delete(r.id);
  }
  return true;
}

/** Vence lobbies (arranca con ≥ mínimo, disuelve si no), vence FASES con el
 *  reloj del árbitro y purga salas viejas. Toda lectura/acción la llama
 *  primero con su reloj, así los tests no esperan y el ticker es solo un
 *  respaldo para salas que nadie consulta.
 *
 *  Cada sala va AISLADA: un registro que ya no re-simula (dato corrupto del
 *  store, caso borde del motor) rompería si no TODAS las rutas de /aleph y el
 *  ticker la loguearía cada 5 s. La sala rota se disuelve y seguimos con las
 *  demás; en la mesa gratis disolver no toca dinero (la etapa 4, con plata de
 *  verdad, tendrá que revisar esta política). */
export function settleDue(now = Date.now()): void {
  let dirty = false;
  for (const room of rooms.values()) {
    try {
      if (settleRoomDue(room, now)) dirty = true;
    } catch (e) {
      console.error("[aleph] sala rota, se disuelve:", room.id, (e as Error).message);
      dissolveRoom(room, now);
      states.delete(room.id);
      dirty = true;
    }
  }
  if (purgeExcessFinished()) dirty = true;
  if (dirty) persist();
}

// ---- Juego --------------------------------------------------------------------

export interface ActBody {
  stage: number;
  phase: string;
  action: unknown;
  signature?: string;
  ts?: number;
}

/** Cierra la fase actual con el motivo dado; si la sala terminó, la liquida. */
function closePhase(room: AlephRoom, reason: PhaseEndReason, at: number): void {
  const s = stateOf(room);
  const ev: AlephEvent = {
    type: "phase_end",
    stage: s.stage.index,
    phase: s.stage.phase,
    at,
    reason,
  };
  const next = applyEvent(s, ev);
  room.events.push(ev);
  states.set(room.id, next);
  if (next.over) settleRoom(room, next, at);
  else room.phaseDeadline = at + ALEPH_PHASE_MS;
}

/** Liquidación: tabla de pagos del motor + ELO multi-jugador + métrica. En la
 *  etapa 4 acá se firma la tabla para el contrato. */
function settleRoom(room: AlephRoom, s: AlephState, now: number): void {
  room.status = "settled";
  room.settledAt = now;
  room.phaseDeadline = undefined;
  room.stages = s.results.length;
  room.payouts = s.payouts;
  room.eloUpdates = applyMultiResult(
    "aleph",
    room.seats.map((a) => ({ address: a, score: s.payouts![a] })),
  );
  recordMatchSettled(0, now);
  // La sala ya no cambia: soltamos su estado derivado. Si alguien la mira, se
  // re-simula bajo demanda y vuelve a cachearse; lo que NO puede pasar es que
  // listar las últimas 100 re-simule 100 registros de golpe tras un reinicio.
  states.delete(room.id);
}

/** Una acción firmada de un asiento. La firma cubre sala + etapa + fase +
 *  línea canónica + ts; el motor valida el resto y la rechaza si no vale. */
export async function actAleph(
  roomId: string,
  address: string,
  body: ActBody,
  now = Date.now(),
): Promise<AlephRoomView> {
  settleDue(now);
  const room = rooms.get(roomId);
  if (!room) throw new AlephError("room not found");
  address = normAddr(address);
  if (!room.seats.includes(address)) throw new AlephError("not a seat of this room");
  if (room.status !== "playing") throw new AlephError(`room not open (${room.status})`);
  if (body.phase !== "talk" && body.phase !== "decide") throw new AlephError("invalid phase");
  const stage = Number(body.stage);
  if (!Number.isInteger(stage)) throw new AlephError("invalid stage");
  let action: AlephAction;
  try {
    action = validateAction(body.action);
  } catch (e) {
    throw new AlephError((e as Error).message);
  }
  const line = actionLine(action);
  await verifySigned(
    alephActionAuthMessage(room.id, stage, body.phase, line, Number(body.ts)),
    body.signature,
    body.ts,
    address,
    now,
  );
  // Después del await el estado pudo cambiar (otra acción cerró la fase): se
  // aplica sobre el estado ACTUAL. Si la etapa/fase ya no coinciden, el motor
  // lo rechaza con "stage or phase mismatch" y el agente refresca su vista.
  const fresh = rooms.get(roomId);
  if (!fresh || fresh.status !== "playing") throw new AlephError("room not open");
  // Anti-replay: el mismo cuerpo firmado no entra dos veces (reenviarlo
  // publicaba el mismo `say` dos veces). La firma ata sala + etapa + fase +
  // línea + ts, así que repetirla es siempre un reenvío.
  if (
    body.signature &&
    fresh.events.some((e) => e.type === "action" && e.signature === body.signature)
  ) {
    throw new AlephError("duplicate action");
  }
  const s = stateOf(fresh);
  const ev: AlephEvent = {
    type: "action",
    address,
    stage,
    phase: body.phase,
    action,
    ts: Number(body.ts ?? now),
    signature: body.signature,
  };
  let next: AlephState;
  try {
    next = applyEvent(s, ev);
  } catch (e) {
    throw new AlephError((e as Error).message);
  }
  fresh.events.push(ev);
  states.set(fresh.id, next);
  const done = phaseComplete(next);
  if (done) closePhase(fresh, done, now);
  persist();
  return roomView(fresh, address);
}

/** Registro completo de una sala TERMINADA: semilla, compromiso, eventos
 *  firmados y tabla de pagos. Es lo que re-simula cualquier verificador. */
export function alephLog(roomId: string, now = Date.now()) {
  settleDue(now);
  const room = rooms.get(roomId);
  if (!room) throw new AlephError("room not found");
  if (room.status !== "settled") throw new AlephError("room not settled yet");
  return {
    roomId: room.id,
    stake: room.stake,
    rulesV: ALEPH_RULES_V,
    seats: room.seats,
    commit: room.commit,
    secretSeed: room.secretSeed,
    startedAt: room.startedAt,
    settledAt: room.settledAt,
    events: room.events,
    payouts: room.payouts,
  };
}

export interface RecentRoom {
  roomId: Hex;
  stake: number;
  seats: string[];
  startedAt?: number;
  settledAt?: number;
  stages: number;
  payouts?: Record<string, number>;
}

/** Salas terminadas recientes (para la web y los agentes curiosos). */
export function recentAlephRooms(limit = 20, now = Date.now()): RecentRoom[] {
  settleDue(now);
  const lim = Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 20;
  return [...rooms.values()]
    .filter((r) => r.status === "settled")
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))
    .slice(0, lim)
    .map((r) => ({
      roomId: r.id,
      stake: r.stake,
      seats: r.seats,
      startedAt: r.startedAt,
      settledAt: r.settledAt,
      stages: r.stages ?? 0,
      payouts: r.payouts,
    }));
}

// ---- Ticker -------------------------------------------------------------------

let ticker: NodeJS.Timeout | undefined;

/** Respaldo: vence lobbies y fases aunque nadie consulte la sala. Lo arranca
 *  index.ts (nunca al importar: los tests usan su propio reloj). Arranca SIEMPRE:
 *  el kill switch gobierna las entradas nuevas, no el reloj — sin ticker, una
 *  sala en curso que nadie consulta no se liquidaría nunca. */
export function startAlephTicker(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    try {
      settleDue();
    } catch (e) {
      console.error("[aleph] tick:", (e as Error).message);
    }
  }, ALEPH_TICK_MS);
  ticker.unref?.();
}

// ---- Vistas -------------------------------------------------------------------

export function roomView(room: AlephRoom, address?: string): AlephRoomView {
  const base = {
    roomId: room.id,
    stake: room.stake,
    status: room.status,
    rulesV: ALEPH_RULES_V,
    min: ALEPH_MIN_SEATS,
    max: ALEPH_MAX_SEATS,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    settledAt: room.settledAt,
    commit: room.commit,
  };
  if (room.status === "lobby" || room.status === "dissolved") {
    return {
      ...base,
      closesAt: room.createdAt + ALEPH_LOBBY_MS,
      seats: room.seats.map((a) => ({ address: a, status: "alive" as SeatStatus, pocket: 0 })),
    };
  }
  const v = viewFor(stateOf(room), address);
  const out: AlephRoomView = { ...base, ...v, deadline: room.phaseDeadline };
  if (room.status === "settled") {
    out.secretSeed = room.secretSeed;
    const a = address ? normAddr(address) : undefined;
    if (a && room.eloUpdates?.[a]) out.rating = room.eloUpdates[a];
  }
  return out;
}

/** Vista de una sala. La vista PRIVADA de un asiento (su fragmento de la
 *  Cerradura, sus susurros, si ya decidió) exige un PASE DE VISTA: la firma de
 *  `alephViewAuthMessage(roomId, address, ts)` por esa misma address, fresca
 *  por MATCHMAKE_AUTH_TTL_MS. Sin pase válido se devuelve la vista PÚBLICA, sin
 *  lanzar: pedir de más no es un error del cliente, es simplemente no ver lo
 *  privado. Excepción para dev/tests: con AUTH_REQUIRED en false y SIN firma se
 *  devuelve la privada (los tests in-process leen así). Una firma presente pero
 *  inválida da la pública SIEMPRE, también en dev. */
export async function getAlephRoom(
  roomId: string,
  address?: string,
  now = Date.now(),
  auth?: { signature?: string; ts?: number },
): Promise<AlephRoomView | null> {
  settleDue(now);
  const room = rooms.get(roomId);
  if (!room) return null;
  if (!address) return roomView(room);
  const seat = normAddr(address);
  if (!auth?.signature) return roomView(room, AUTH_REQUIRED ? undefined : seat);
  try {
    await verifySigned(
      alephViewAuthMessage(room.id, seat, Number(auth.ts)),
      auth.signature,
      auth.ts,
      seat,
      now,
    );
  } catch {
    return roomView(room, undefined);
  }
  return roomView(room, seat);
}

/** Salas vivas (lobby + en juego), para el relleno de la casa
 *  (`aleph-house.ts`). Es un accesor de solo lectura DE SERVIDOR: devuelve las
 *  salas con su semilla adentro, así que nunca se sirve tal cual por HTTP —
 *  para eso están `roomView` y `viewFor`, que filtran los secretos. */
export function liveAlephRooms(now = Date.now()): AlephRoom[] {
  settleDue(now);
  return [...rooms.values()].filter((r) => r.status === "lobby" || r.status === "playing");
}

export function listAlephLobbies(now = Date.now()): LobbySummary[] {
  settleDue(now);
  const out: LobbySummary[] = [];
  for (const id of openLobby.values()) {
    const r = rooms.get(id);
    if (!r || r.status !== "lobby") continue;
    out.push({
      roomId: r.id,
      stake: r.stake,
      seats: r.seats.length,
      min: ALEPH_MIN_SEATS,
      max: ALEPH_MAX_SEATS,
      closesAt: r.createdAt + ALEPH_LOBBY_MS,
    });
  }
  return out;
}

/** Tests: vaciar todo en memoria (no toca el store). */
export function __resetAlephForTest(): void {
  rooms.clear();
  openLobby.clear();
  states.clear();
}
