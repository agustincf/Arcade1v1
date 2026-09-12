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
  ALEPH_ESCROW_STATUS,
  usdcPayoutTable,
  stakeToUnits,
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
import { signAlephSeat, signAlephPayout, alephSeatsHash, alephTableHash } from "./sign.js";
import {
  alephChain,
  alephOnchainEnabled,
  alephEscrowAddress,
  alephChainId,
} from "./aleph-chain.js";

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
/** Plazo para que los N asientos depositen, una vez cerrado el lobby. */
export const ALEPH_FUNDING_MS = envNum("ALEPH_FUNDING_MS", 10 * 60_000);
/** Margen DESPUÉS del plazo de fondeo tras el cual el árbitro disuelve la sala
 *  aunque no haya podido leer la cadena ni una vez (ver `settleRoomDue`). Con
 *  el tick cada 5 s son ~24 intentos: alcanza de sobra para que el camino
 *  normal cierre primero y no se disuelva una sala fondeada sobre la hora. */
export const ALEPH_FUNDING_GRACE_MS = envNum("ALEPH_FUNDING_GRACE_MS", 2 * 60_000);
/** Ventana de juego que lleva el pase (playDeadline on-chain). El mazo tiene a
 *  lo sumo N+2 etapas, ~22 fases de 2 min: 3 h sobra, y pasada esa ventana más
 *  la gracia del contrato cualquiera puede pedir el reembolso. */
export const ALEPH_PLAY_WINDOW_MS = envNum("ALEPH_PLAY_WINDOW_MS", 3 * 60 * 60_000);
/** Mesas permitidas, en USDC enteros. `ALEPH_STAKES` (default "0"); la gratis
 *  está SIEMPRE. Una mesa de plata solo se acepta con ALEPH_ESCROW_ADDRESS
 *  (se chequea por llamada en joinAleph, y config-guard lo exige en producción). */
export const ALEPH_STAKES: number[] = [
  ...new Set(
    ["0", ...(process.env.ALEPH_STAKES ?? "0").split(",")]
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0),
  ),
].sort((a, b) => a - b);
/** Kill switch, leído por llamada. */
export const alephEnabled = () => process.env.ALEPH_ENABLED !== "false";

export type RoomStatus = "lobby" | "funding" | "playing" | "settled" | "dissolved";

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
  // ---- Mesa de plata (stake > 0) ----
  fundingDeadline?: number; // ms: cuándo vence el fondeo
  playDeadline?: number; // ms: lo que lleva el pase como playDeadline (en segundos)
  deposited?: string[]; // quién depositó, según la última lectura de la cadena
  passes?: Record<string, Hex>; // pase firmado por asiento (determinístico; se cachea)
  chain?: AlephChainRecord; // liquidación / reembolso on-chain
  stages?: number; // etapas jugadas, guardadas al liquidar (listar no re-simula)
  payouts?: Record<string, number>;
  eloUpdates?: Record<string, RatingUpdate>;
}

/** Lo que un asiento necesita para depositar: lo lee de su vista privada
 *  mientras la sala está en `funding`. Deadlines en SEGUNDOS (como el contrato). */
export interface AlephDeposit {
  chainId: number;
  escrow: Hex;
  usdc: Hex;
  stake: string; // micro-USDC, como string (JSON no lleva bigint)
  seats: string[]; // la lista congelada, en orden
  seatsHash: Hex;
  fundDeadline: number;
  playDeadline: number;
  seatSig: Hex;
}

/** Por qué una liquidación quedó CERRADA sin transacción del árbitro:
 *  `external` = otro presentó la tabla (la firma es pública, cualquiera puede);
 *  `refunded` = la sala terminó reembolsada y ya no hay nada que pagar. */
export type AlephSettleOutcome = "external" | "refunded";

/** Por qué un reembolso quedó CERRADO sin transacción del árbitro:
 *  `none` = nadie llegó a depositar (la sala ni existe on-chain);
 *  `external` = alguien pidió el reembolso permissionless antes;
 *  `settled` = la sala ya estaba liquidada (no debería pasar, queda anotado). */
export type AlephRefundOutcome = "none" | "external" | "settled";

/** Rastro de la cadena en una sala de plata. Todo string: va al store.
 *
 *  Los dos `*Tx` llevan SOLO hashes de transacción de verdad: la web los
 *  publica como link al explorador, así que un centinela ahí sería un link
 *  roto. El "por qué no hay hash" vive aparte, en los dos `*Outcome`. Una
 *  liquidación (o un reembolso) está cerrada cuando tiene UNO de los dos. */
export interface AlephChainRecord {
  attempts: number;
  nextAttemptAt?: number;
  lastError?: string;
  feeBps?: number;
  payoutsUsdc?: Record<string, string>; // micro-USDC por asiento
  payoutSig?: Hex;
  settleTx?: Hex; // hash de `settle`, solo si lo mandó el árbitro
  settleOutcome?: AlephSettleOutcome; // cerrada sin hash propio
  refundTx?: Hex; // hash de `cancelRoom`, solo si lo mandó el árbitro
  refundOutcome?: AlephRefundOutcome; // cerrado sin hash propio
}

/** ¿La liquidación on-chain ya está cerrada? Con hash propio, o con un motivo
 *  por el que nunca va a haberlo. Mientras no lo esté, el tick reintenta. */
const settleClosed = (c: AlephChainRecord) => !!(c.settleTx || c.settleOutcome);
const refundClosed = (c: AlephChainRecord) => !!(c.refundTx || c.refundOutcome);

/** ¿Esta sala todavía le debe algo a la cadena? Una mesa de plata terminada
 *  arrastra una liquidación o un reembolso hasta que quede CERRADO (hash propio
 *  o motivo). Mientras tanto no se puede borrar del store: borrarla es olvidar
 *  la obligación en silencio, y el tick de cadena ya no la vuelve a intentar.
 *  La mesa gratis nunca tiene `chain`, así que para ella esto es siempre false. */
const chainPending = (room: AlephRoom) =>
  !!room.chain && !(settleClosed(room.chain) || refundClosed(room.chain));

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
  // ---- Mesa de plata ----
  fundingDeadline?: number; // `funding`: cuándo vence el fondeo (ms)
  deposited?: string[]; // `funding`: quién ya depositó
  deposit?: AlephDeposit; // `funding`, SOLO en la vista privada del asiento
  escrow?: Hex; // stake > 0: el contrato
  payoutsUsdc?: Record<string, string>; // `settled`, stake > 0
  payoutSig?: Hex; // `settled`, stake > 0: cualquiera puede presentar la tabla
  settleTx?: Hex; // `settled`, stake > 0: el hash, cuando lo mandó el árbitro
  settleOutcome?: AlephSettleOutcome; // `settled`, stake > 0: cerrada sin hash propio
  refundTx?: Hex; // `dissolved`, stake > 0: el hash del `cancelRoom` del árbitro
  refundOutcome?: AlephRefundOutcome; // `dissolved`, stake > 0: cerrado sin hash propio
  seats: { address: string; status: SeatStatus; pocket: number }[];
} & Partial<Omit<AlephView, "seats">>;

export interface AlephAuth {
  signature: string;
  ts: number;
}

export interface LobbySummary {
  roomId: Hex;
  stake: number;
  status: "lobby" | "funding";
  seats: number;
  deposited?: number; // funding: cuántos ya depositaron
  min: number;
  max: number;
  closesAt: number; // lobby: cuándo arranca o se disuelve; funding: cuándo vence el fondeo
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

/** Guarda YA, sin esperar el debounce de 20 s de persist.ts. Es para lo que no
 *  se puede perder ni en una caída dura (OOM/crash): hoy, la tabla de pagos
 *  firmada de una mesa de plata. Va `persist()` primero a propósito — `flush()`
 *  escribe lo que haya PENDIENTE, y si otra sala ya lo consumió en este mismo
 *  tick no quedaría nada por escribir. */
async function persistNow(): Promise<void> {
  persist();
  await store$.flush();
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

/** La sala que OCUPA a esa address. Un lobby la ocupa siempre, y una sala en
 *  fondeo también (la lista ya está congelada y su pase emitido); una sala en
 *  juego, solo mientras el asiento siga vivo: el que se fue con una Oferta, el
 *  votado y el que abandonó pueden sentarse en otro lobby sin esperar a que su
 *  sala termine. */
function liveRoomOf(address: string): AlephRoom | undefined {
  for (const r of rooms.values()) {
    if (!r.seats.includes(address)) continue;
    if (r.status === "lobby" || r.status === "funding") return r;
    if (r.status === "playing" && seatAlive(r, address)) return r;
  }
  return undefined;
}

function liveCount(): number {
  let n = 0;
  for (const r of rooms.values()) {
    if (r.status === "lobby" || r.status === "funding" || r.status === "playing") n++;
  }
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
  if (!ALEPH_STAKES.includes(stake)) {
    throw new AlephError(`stake not allowed: ${stake} (mesas: ${ALEPH_STAKES.join(", ")})`);
  }
  if (stake > 0 && !alephOnchainEnabled()) {
    throw new AlephError("money tables are not enabled on this arbiter (ALEPH_ESCROW_ADDRESS)");
  }
  address = normAddr(address);
  if (!ADDRESS_RE.test(address)) throw new AlephError("invalid address");
  await verifySeatAuth(stake, address, auth, now);
  settleDue(now);
  const mine = liveRoomOf(address);
  if (mine) return withDeposit(mine, roomView(mine, address), address);

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
  if (room.seats.length >= ALEPH_MAX_SEATS) closeLobby(room, now);
  persist();
  return withDeposit(room, roomView(room, address), address);
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

/** El lobby cierra: la gratis arranca; la de plata entra en FONDEO. */
function closeLobby(room: AlephRoom, now: number): void {
  if (room.stake === 0) startRoom(room, now);
  else enterFunding(room, now);
}

/** Congela la lista y abre el plazo de fondeo. La semilla NO se sortea acá:
 *  recién con los N depósitos (alephChainTick → startRoom). */
function enterFunding(room: AlephRoom, now: number): void {
  room.status = "funding";
  room.fundingDeadline = now + ALEPH_FUNDING_MS;
  room.playDeadline = room.fundingDeadline + ALEPH_PLAY_WINDOW_MS;
  room.deposited = [];
  room.passes = {};
  if (openLobby.get(room.stake) === room.id) openLobby.delete(room.stake);
}

/** El pase de UN asiento, firmado una vez y cacheado (la firma es
 *  determinística: RFC 6979). Solo mientras la sala fondea. */
async function seatDeposit(room: AlephRoom, address: string): Promise<AlephDeposit> {
  const seats = room.seats as Hex[];
  const seatsHash = alephSeatsHash(seats);
  const stake = stakeToUnits(room.stake);
  const fundDeadline = Math.floor(room.fundingDeadline! / 1000);
  const playDeadline = Math.floor(room.playDeadline! / 1000);
  room.passes ??= {};
  let seatSig = room.passes[address];
  if (!seatSig) {
    seatSig = await signAlephSeat({
      roomId: room.id,
      seatsHash,
      stake,
      fundDeadline: BigInt(fundDeadline),
      playDeadline: BigInt(playDeadline),
      player: address as Hex,
    });
    room.passes[address] = seatSig;
    persist();
  }
  return {
    chainId: alephChainId(),
    escrow: alephEscrowAddress(),
    usdc: await alephChain().usdcAddress(),
    stake: stake.toString(),
    seats: room.seats,
    seatsHash,
    fundDeadline,
    playDeadline,
    seatSig,
  };
}

/** Adjunta el bloque de depósito a la vista PRIVADA de un asiento en fondeo. */
async function withDeposit(
  room: AlephRoom,
  v: AlephRoomView,
  address: string,
): Promise<AlephRoomView> {
  if (room.status !== "funding" || !room.seats.includes(address)) return v;
  return { ...v, deposit: await seatDeposit(room, address) };
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
    if (room.seats.length >= ALEPH_MIN_SEATS && alephEnabled()) closeLobby(room, now);
    else dissolveRoom(room, now);
    return true;
  }
  if (
    room.status === "funding" &&
    room.fundingDeadline !== undefined &&
    now >= room.fundingDeadline + ALEPH_FUNDING_GRACE_MS
  ) {
    // SALIDA LOCAL del fondeo, que NO depende de poder leer la cadena. El
    // camino normal lo cierra `syncFunding` justo al vencer el plazo; esto es
    // para cuando el tick de cadena no puede: RPC caído, escrow mal
    // configurado, o ALEPH_ESCROW_ADDRESS sacada con salas vivas en el store
    // (ahí `alephChainTick` ni siquiera entra). Sin esta salida la sala se
    // queda en `funding` para siempre: deja a sus asientos sin poder sentarse
    // en NINGUNA mesa y ocupa un lugar del tope de salas vivas, que es
    // compartido con la gratis — una caída de la cadena se llevaría puesto
    // también el producto gratis. Se disuelve y queda pedido el reembolso:
    // `refundOnchain` lee el estado real y decide (si nadie depositó, no manda
    // nada). La gracia le da al tick de cadena ~24 intentos para ganar de mano
    // y no disolver una sala que se fondeó sobre la hora.
    dissolveRoom(room, now);
    room.chain = { attempts: 0, nextAttemptAt: now };
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
    now - room.settledAt > ALEPH_FINISHED_TTL_MS &&
    // Ni siquiera vencida se borra una sala que todavía le debe plata a la
    // cadena: el registro es lo único que sabe qué transacción falta mandar.
    // Una sala así se queda más allá del TTL, reintentando con backoff, hasta
    // que la liquidación o el reembolso cierren.
    !chainPending(room)
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
 *  por `settledAt`, SALTEANDO las que todavía le deben plata a la cadena: este
 *  barrido corre en cada request, así que sin el salteo cincuenta salas gratis
 *  nuevas podían desalojar una mesa de plata cuya liquidación estaba en backoff
 *  (hasta ~43 min) y el árbitro se olvidaba del pago sin una línea de log. Si
 *  las candidatas más viejas están todas pendientes, se desaloja a la siguiente
 *  en edad; si ninguna se puede desalojar, no se borra nada. */
function purgeExcessFinished(): boolean {
  const finished = [...rooms.values()].filter(
    (r) => r.status === "settled" || r.status === "dissolved",
  );
  let excess = finished.length - ALEPH_MAX_SETTLED_KEPT;
  if (excess <= 0) return false;
  finished.sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0));
  let purged = false;
  for (const r of finished) {
    if (excess <= 0) break;
    if (chainPending(r)) continue;
    rooms.delete(r.id);
    states.delete(r.id);
    excess--;
    purged = true;
  }
  return purged;
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
      // Con plata de por medio, disolver no alcanza: hay que devolverla.
      if (room.stake > 0) room.chain = { attempts: 0, nextAttemptAt: now };
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

/** Liquidación: tabla de pagos del motor + ELO multi-jugador + métrica. En una
 *  mesa de plata, además, deja pedida la liquidación on-chain. */
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
  // Mesa de plata: la tabla en USDC, su firma y la transacción las arma el tick
  // de cadena (async, con reintento). Acá solo queda anotado que falta.
  if (room.stake > 0) room.chain = { attempts: 0, nextAttemptAt: now };
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
    // Mesa de plata: la tabla en USDC y su firma van en el registro PÚBLICO, así
    // cualquiera puede presentar el `settle` si la transacción del árbitro falló.
    usdc:
      room.stake > 0
        ? {
            escrow: alephEscrowAddress(),
            chainId: alephChainId(),
            feeBps: room.chain?.feeBps,
            table: room.chain?.payoutsUsdc,
            signature: room.chain?.payoutSig,
            settleTx: room.chain?.settleTx,
            settleOutcome: room.chain?.settleOutcome,
          }
        : undefined,
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
  settleTx?: Hex; // stake > 0: el hash de la transacción que pagó la tabla
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
      settleTx: r.chain?.settleTx,
    }));
}

// ---- La cadena (mesas de plata) ----------------------------------------------
// Todo lo que toca el contrato pasa por acá, en un tick ASÍNCRONO aparte del
// reloj sincrónico (`settleDue`): leer depósitos, arrancar la sala fondeada,
// disolver y cancelar al vencer el fondeo, liquidar y reembolsar. Con backoff:
// un RPC caído no puede dejar una sala liquidada sin pagar, pero tampoco tiene
// sentido martillarlo cada 5 s.

let chainTicking = false;

function backoffMs(attempts: number): number {
  return Math.min(60 * 60_000, 10_000 * 2 ** Math.min(attempts, 8));
}

/** Exportado para los tests (reloj inyectado). El ticker lo llama cada tick. */
export async function alephChainTick(now = Date.now()): Promise<void> {
  if (chainTicking || !alephOnchainEnabled()) return;
  chainTicking = true;
  let dirty = false;
  try {
    for (const room of [...rooms.values()]) {
      if (room.stake === 0) continue;
      try {
        if (room.status === "funding") {
          if (await syncFunding(room, now)) dirty = true;
        } else if (room.status === "settled" && room.chain && !settleClosed(room.chain)) {
          if (await settleOnchain(room, now)) dirty = true;
        } else if (room.status === "dissolved" && room.chain && !refundClosed(room.chain)) {
          if (await refundOnchain(room, now)) dirty = true;
        }
      } catch (e) {
        console.error("[aleph-chain]", room.id, (e as Error).message);
      }
    }
  } finally {
    chainTicking = false;
  }
  if (dirty) persist();
}

/** Lee la cadena para una sala en fondeo. Arranca si está Funded; disuelve (y
 *  deja pendiente el reembolso) si venció el plazo. Devuelve si cambió algo. */
async function syncFunding(room: AlephRoom, now: number): Promise<boolean> {
  const c = await alephChain().readRoom(room.id);
  // Mientras la lectura viajaba, el reloj de cualquier request pudo disolver
  // esta sala por la salida local del fondeo (`settleRoomDue`). Esa decisión
  // es la última palabra: revivirla acá dejaría a un asiento ya liberado
  // jugando en dos salas a la vez. La plata vuelve por el reembolso que quedó
  // pedido, que lee el estado real (una sala fondeada se cancela igual).
  if (room.status !== "funding") return false;
  let changed = false;
  const dep = c.depositors.map(normAddr);
  if (JSON.stringify(dep) !== JSON.stringify(room.deposited ?? [])) {
    room.deposited = dep;
    changed = true;
  }
  if (c.status === ALEPH_ESCROW_STATUS.Funded) {
    startRoom(room, now);
    return true;
  }
  if (c.status === ALEPH_ESCROW_STATUS.Refunded) {
    // Alguien llamó refundUnfunded por su cuenta: nada que cancelar.
    dissolveRoom(room, now);
    room.chain = { attempts: 0, refundOutcome: "external" };
    return true;
  }
  if (now >= room.fundingDeadline!) {
    dissolveRoom(room, now);
    room.chain = { attempts: 0, nextAttemptAt: now };
    return true;
  }
  return changed;
}

/** Tabla en USDC + firma (una vez) y `settle` (con reintento). */
async function settleOnchain(room: AlephRoom, now: number): Promise<boolean> {
  const rec = room.chain!;
  if (rec.nextAttemptAt !== undefined && now < rec.nextAttemptAt) return false;
  rec.attempts += 1;
  const seats = room.seats as Hex[];
  try {
    const chain = alephChain();
    if (!rec.payoutSig) {
      // La comisión se lee del CONTRATO: si difiriera del env, la suma no
      // cerraría y el settle revertiría.
      const feeBps = await chain.feeBps();
      const { amounts } = usdcPayoutTable(seats, room.payouts!, stakeToUnits(room.stake), feeBps);
      rec.feeBps = feeBps;
      rec.payoutsUsdc = Object.fromEntries(seats.map((a, i) => [a, amounts[i].toString()]));
      rec.payoutSig = await signAlephPayout(room.id, alephTableHash(seats, amounts));
      // LA TABLA FIRMADA SE GUARDA ANTES DE PUBLICARSE. Una sala firma UNA sola
      // tabla en su vida: la firma no lleva nonce y `settle` es permissionless,
      // así que dos tablas firmadas de la misma sala son dos órdenes de pago
      // válidas y cobra la que alguien presente primero. Lo único que puede
      // romper esa garantía es perder ESTA en una caída dura (OOM/crash; un
      // redeploy manda SIGTERM y flushea): si la ventana perdida se lleva
      // también las últimas acciones, la sala restaurada re-simula a OTRA tabla
      // y la firma. Con el debounce de 20 s esa ventana dura 20 s; con este
      // flush queda en UN viaje al store, no en cero: el event loop sigue
      // atendiendo requests mientras se espera, y `roomView` ya devuelve la
      // firma desde memoria. Cuesta una escritura por mesa de plata liquidada.
      await persistNow();
    }
    const amounts = seats.map((a) => BigInt(rec.payoutsUsdc![a]));
    rec.settleTx = await chain.settle(room.id, seats, amounts, rec.payoutSig);
    rec.lastError = undefined;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    let closed = false;
    if (/not funded/i.test(msg)) {
      // Ya no está Funded: o alguien presentó la tabla antes, o se reembolsó.
      // Averiguar CUÁL es otra lectura, y esa lectura también puede fallar: si
      // falla, esto sigue siendo un intento fallido y tiene que irse al backoff
      // como cualquier otro. Sin este try la excepción se escapaba al catch por
      // sala del tick con `attempts` ya incrementado pero SIN `nextAttemptAt`,
      // y el tick siguiente reintentaba en el acto contra un RPC ya caído.
      try {
        const c = await alephChain().readRoom(room.id);
        rec.settleOutcome = c.status === ALEPH_ESCROW_STATUS.Settled ? "external" : "refunded";
        rec.lastError = undefined;
        closed = true;
      } catch (e2) {
        rec.lastError = `${msg} | ${(e2 as Error).message}`;
      }
    } else {
      rec.lastError = msg;
    }
    if (!closed) rec.nextAttemptAt = now + backoffMs(rec.attempts);
  }
  return true;
}

/** `cancelRoom` para una sala disuelta con plata adentro (con reintento). */
async function refundOnchain(room: AlephRoom, now: number): Promise<boolean> {
  const rec = room.chain!;
  if (rec.nextAttemptAt !== undefined && now < rec.nextAttemptAt) return false;
  rec.attempts += 1;
  try {
    const chain = alephChain();
    const c = await chain.readRoom(room.id);
    if (c.status === ALEPH_ESCROW_STATUS.None) {
      rec.refundOutcome = "none"; // nadie depositó: cancelar revertiría
    } else if (c.status === ALEPH_ESCROW_STATUS.Refunded) {
      rec.refundOutcome = "external";
    } else if (c.status === ALEPH_ESCROW_STATUS.Settled) {
      rec.refundOutcome = "settled"; // no debería pasar: queda anotado, no se insiste
    } else {
      rec.refundTx = await chain.cancelRoom(room.id);
    }
    rec.lastError = undefined;
  } catch (e) {
    rec.lastError = (e as Error).message;
    rec.nextAttemptAt = now + backoffMs(rec.attempts);
  }
  return true;
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
    alephChainTick().catch((e) => console.error("[aleph-chain] tick:", (e as Error).message));
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
    escrow: room.stake > 0 ? alephEscrowAddress() : undefined,
  };
  if (room.status === "lobby" || room.status === "funding" || room.status === "dissolved") {
    const funding =
      room.status === "funding" ||
      (room.status === "dissolved" && room.fundingDeadline !== undefined);
    return {
      ...base,
      closesAt: funding ? room.fundingDeadline : room.createdAt + ALEPH_LOBBY_MS,
      fundingDeadline: funding ? room.fundingDeadline : undefined,
      deposited: funding ? (room.deposited ?? []) : undefined,
      // EL REEMBOLSO SE PUBLICA, simétrico a `settleTx`/`settleOutcome` en la
      // rama `settled`. Un fondeo incompleto es el final MÁS común de una mesa
      // de plata (la casa no las completa), y sin esto el asiento que depositó
      // veía su sala "dissolved" y ni una palabra sobre su plata: ni el hash de
      // la cancelación, ni el motivo por el que no hay hash (`none` = nadie
      // depositó, `external` = lo pidió otro antes, `settled` = ya estaba
      // liquidada). Mientras siga vacío, el reembolso todavía está en camino.
      refundTx: room.chain?.refundTx,
      refundOutcome: room.chain?.refundOutcome,
      seats: room.seats.map((a) => ({ address: a, status: "alive" as SeatStatus, pocket: 0 })),
    };
  }
  const v = viewFor(stateOf(room), address);
  const out: AlephRoomView = { ...base, ...v, deadline: room.phaseDeadline };
  if (room.status === "settled") {
    out.secretSeed = room.secretSeed;
    const a = address ? normAddr(address) : undefined;
    if (a && room.eloUpdates?.[a]) out.rating = room.eloUpdates[a];
    if (room.chain) {
      out.payoutsUsdc = room.chain.payoutsUsdc;
      out.payoutSig = room.chain.payoutSig;
      out.settleTx = room.chain.settleTx;
      out.settleOutcome = room.chain.settleOutcome;
    }
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
  if (!auth?.signature) {
    if (AUTH_REQUIRED) return roomView(room, undefined);
    return withDeposit(room, roomView(room, seat), seat);
  }
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
  return withDeposit(room, roomView(room, seat), seat);
}

/** Salas vivas (lobby + en juego), para el relleno de la casa
 *  (`aleph-house.ts`). Es un accesor de solo lectura DE SERVIDOR: devuelve las
 *  salas con su semilla adentro, así que nunca se sirve tal cual por HTTP —
 *  para eso están `roomView` y `viewFor`, que filtran los secretos. */
export function liveAlephRooms(now = Date.now()): AlephRoom[] {
  settleDue(now);
  return [...rooms.values()].filter((r) => r.status === "lobby" || r.status === "playing");
}

/** Lo que hay para sentarse o mirar: el lobby abierto de cada mesa y las salas
 *  que están FONDEANDO (ya cerradas, pero todavía sin arrancar). */
export function listAlephLobbies(now = Date.now()): LobbySummary[] {
  settleDue(now);
  const out: LobbySummary[] = [];
  for (const r of rooms.values()) {
    if (r.status === "lobby" && openLobby.get(r.stake) === r.id) {
      out.push({
        roomId: r.id,
        stake: r.stake,
        status: "lobby",
        seats: r.seats.length,
        min: ALEPH_MIN_SEATS,
        max: ALEPH_MAX_SEATS,
        closesAt: r.createdAt + ALEPH_LOBBY_MS,
      });
    } else if (r.status === "funding") {
      out.push({
        roomId: r.id,
        stake: r.stake,
        status: "funding",
        seats: r.seats.length,
        deposited: r.deposited?.length ?? 0,
        min: ALEPH_MIN_SEATS,
        max: ALEPH_MAX_SEATS,
        closesAt: r.fundingDeadline!,
      });
    }
  }
  return out.sort((a, b) => a.stake - b.stake || a.closesAt - b.closesAt);
}

/** Tests: vaciar todo en memoria (no toca el store). */
export function __resetAlephForTest(): void {
  rooms.clear();
  openLobby.clear();
  states.clear();
}
