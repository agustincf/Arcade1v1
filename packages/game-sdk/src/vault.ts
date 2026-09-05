// MOTOR de La Bóveda (formato multi-agente): una sala compartida de 4 a 8
// asientos con pozo único, etapas sorteadas de un mazo y una tabla de pagos al
// final. Es PURO y DETERMINÍSTICO: el estado siguiente depende solo del estado
// anterior y del evento; todo el azar sale de la semilla secreta. Así el
// árbitro opera re-simulando el registro, y cualquiera puede verificarlo.
//
// Vocabulario (constantes, acciones, forma canónica): ./vault-rules.
import { mulberry32 } from "./replay";
import {
  VAULT_RULES as R,
  VAULT_RULES_V,
  type VaultAction,
  type VaultEvent,
  type StageKind,
  type Phase,
  type SeatStatus,
} from "./vault-rules";

export * from "./vault-rules";

export interface Seat {
  address: string;
  status: SeatStatus;
  pocket: number; // lo que ya aseguró (público)
  absences: number; // ausencias SEGUIDAS en decisiones
  votesReceived: number; // votos acumulados (criterio de desempate)
}

export interface VaultMessage {
  from: string;
  to?: string; // sin `to` = público
  text: string;
  stage: number;
  phase: Phase;
}

export interface Fragment {
  pos: number;
  digit: string;
}

export interface StageState {
  index: number;
  kind: StageKind;
  phase: Phase;
  // números públicos de la etapa
  share?: number;
  shareBonus?: number;
  offerBps?: number;
  offerTotal?: number;
  codeLength?: number;
  // secretos (la vista nunca los expone)
  code?: string;
  fragments?: Record<string, Fragment>;
  decisions: Record<string, VaultAction>; // decisiones pendientes de esta fase
  ready: string[]; // quiénes mandaron `ready` en esta fase
  msgCount: Record<string, number>; // mensajes por asiento en esta fase
}

/** Lo que se REVELA al cerrar cada etapa (público). Quién votó a quién no está
 *  acá a propósito: queda en el registro de eventos, que se abre al final. */
export interface StageResult {
  index: number;
  kind: StageKind;
  kept?: string[];
  contributed?: string[];
  bonus?: number;
  offerBps?: number;
  accepted?: string[];
  eachGot?: number;
  voided?: boolean;
  votes?: Record<string, number>;
  eliminated?: string;
  code?: string;
  solvers?: string[];
  traitors?: string[];
  failed?: boolean;
  choices?: Record<string, "split" | "steal">;
  abandoned?: string[];
  decay?: number;
  potAfter: number;
  boxAfter: number;
}

export interface VaultState {
  rulesV: number;
  seed: string; // secreta hasta el final (el árbitro la filtra)
  seats: Seat[];
  pot: number;
  box: number; // la caja del demonio
  potInitial: number;
  deck: StageKind[]; // cartas que faltan (secreto)
  tiebreak: string[]; // orden oculto de desempate
  stage: StageState;
  results: StageResult[];
  messages: VaultMessage[];
  over: boolean;
  payouts?: Record<string, number>;
}

export const bps = (x: number, b: number) => Math.floor((x * b) / 10000);
export const norm = (a: string) => a.toLowerCase();
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

/** Trozo de 32 bits número `i` (0..7) de la semilla de 32 bytes. */
function chunk(seed: string, i: number): number {
  const h = seed.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error("invalid seed: expected 32 bytes hex");
  return parseInt(h.slice(i * 8, i * 8 + 8), 16) >>> 0;
}

/** RNG por PROPÓSITO (0 mazo, 1 ofertas, 2 códigos, 3 desempate) y por etapa:
 *  misma semilla + misma etapa => misma secuencia, sin contadores en el estado. */
export function rngFor(seed: string, purpose: number, stageIndex: number): () => number {
  return mulberry32((chunk(seed, purpose) ^ Math.imul(stageIndex + 1, 0x9e3779b1)) >>> 0);
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** La bolsa: 2 Ofertas, 1 Cerradura, 1 Reparto y (N − 2) Votos, barajada.
 *  Regla de sanidad: nunca dos Ofertas seguidas (la segunda se mueve a la
 *  primera posición no adyacente a la primera Oferta). */
export function buildDeck(n: number, rnd: () => number): StageKind[] {
  const bag: StageKind[] = ["offer", "offer", "lock", "share"];
  for (let i = 0; i < n - 2; i++) bag.push("vote");
  const deck = shuffle(bag, rnd);
  const first = deck.indexOf("offer");
  const second = deck.indexOf("offer", first + 1);
  if (second === first + 1) {
    const q = deck.findIndex((c, idx) => c !== "offer" && Math.abs(idx - first) > 1);
    [deck[second], deck[q]] = [deck[q], deck[second]];
  }
  return deck;
}

export function aliveSeats(s: VaultState): Seat[] {
  return s.seats.filter((x) => x.status === "alive");
}

export function seatOf(s: VaultState, address: string): Seat | undefined {
  const a = norm(address);
  return s.seats.find((x) => x.address === a);
}

/** Arranca una etapa: calcula sus números con la semilla y el índice, y abre
 *  su primera fase (charla si la etapa la tiene, si no directo a decidir). */
export function beginStage(s: VaultState, kind: StageKind): void {
  const index = s.results.length;
  const st: StageState = {
    index,
    kind,
    phase: kind === "share" || kind === "offer" ? "decide" : "talk",
    decisions: {},
    ready: [],
    msgCount: {},
  };
  if (kind === "share") {
    st.share = bps(s.pot, R.SHARE_BPS);
    st.shareBonus = bps(s.pot, R.SHARE_BONUS_BPS);
  }
  if (kind === "offer") {
    const rnd = rngFor(s.seed, 1, index);
    const steps = (R.OFFER_MAX_BPS - R.OFFER_MIN_BPS) / R.OFFER_STEP_BPS + 1;
    st.offerBps = R.OFFER_MIN_BPS + R.OFFER_STEP_BPS * Math.floor(rnd() * steps);
    st.offerTotal = bps(s.pot, st.offerBps);
  }
  if (kind === "lock") {
    const rnd = rngFor(s.seed, 2, index);
    const fragments: Record<string, Fragment> = {};
    let code = "";
    aliveSeats(s).forEach((seat, pos) => {
      const digit = String(Math.floor(rnd() * 10));
      code += digit;
      fragments[seat.address] = { pos, digit };
    });
    st.fragments = fragments;
    st.code = code;
    st.codeLength = code.length;
  }
  s.stage = st;
}

const DECK_KINDS = new Set<StageKind>(["share", "offer", "vote", "lock"]);

/** Estado inicial de una sala. `opts.deck` fuerza el mazo (solo tests). */
export function createVault(
  seed: string,
  seats: string[],
  opts: { deck?: StageKind[] } = {},
): VaultState {
  const addrs = seats.map(norm);
  const unique = new Set(addrs).size === addrs.length;
  if (
    addrs.length < R.MIN_SEATS ||
    addrs.length > R.MAX_SEATS ||
    !unique ||
    addrs.some((a) => !ADDRESS_RE.test(a))
  ) {
    throw new Error(`invalid seats: ${R.MIN_SEATS}..${R.MAX_SEATS} unique addresses`);
  }
  if (opts.deck && opts.deck.some((k) => !DECK_KINDS.has(k))) throw new Error("invalid deck");
  const potInitial = R.UNITS_PER_SEAT * addrs.length;
  const box = bps(potInitial, R.BOX_BPS);
  const s: VaultState = {
    rulesV: VAULT_RULES_V,
    seed,
    seats: addrs.map((address) => ({
      address,
      status: "alive",
      pocket: 0,
      absences: 0,
      votesReceived: 0,
    })),
    pot: potInitial - box,
    box,
    potInitial,
    deck: opts.deck ? opts.deck.slice() : buildDeck(addrs.length, rngFor(seed, 0, -1)),
    tiebreak: shuffle(addrs, rngFor(seed, 3, -1)),
    stage: { index: 0, kind: "share", phase: "decide", decisions: {}, ready: [], msgCount: {} },
    results: [],
    messages: [],
    over: false,
  };
  beginStage(s, "share");
  return s;
}
