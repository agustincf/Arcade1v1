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

// ---------------------------------------------------------------------------
// EVENTOS: acciones de los asientos y cierres de fase del árbitro.
// ---------------------------------------------------------------------------

/** Aplica un evento y devuelve el estado NUEVO (el anterior no se toca). Lanza
 *  si el evento no vale en este estado: el árbitro lo traduce a un 400 y NO lo
 *  agrega al registro. Re-simular es aplicar el registro en orden. */
export function applyEvent(prev: VaultState, ev: VaultEvent): VaultState {
  if (prev.over) throw new Error("room already over");
  if (ev.stage !== prev.stage.index || ev.phase !== prev.stage.phase) {
    throw new Error(`stage or phase mismatch (now ${prev.stage.index}/${prev.stage.phase})`);
  }
  const s = structuredClone(prev);
  if (ev.type === "action") applyAction(s, norm(ev.address), ev.action);
  else endPhase(s);
  return s;
}

/** Qué etapa admite cada decisión. */
const DECIDE_KIND: Partial<Record<VaultAction["type"], StageKind>> = {
  keep: "share",
  contribute: "share",
  accept: "offer",
  decline: "offer",
  vote: "vote",
  submit: "lock",
  split: "final",
  steal: "final",
};

function applyAction(s: VaultState, address: string, a: VaultAction): void {
  const seat = seatOf(s, address);
  if (!seat) throw new Error("not a seat of this room");
  if (seat.status !== "alive") throw new Error(`seat not alive (${seat.status})`);
  const st = s.stage;

  if (a.type === "say" || a.type === "whisper") {
    const n = st.msgCount[address] ?? 0;
    if (n >= R.MAX_MSGS_PER_PHASE) throw new Error("message limit reached for this phase");
    let to: string | undefined;
    if (a.type === "whisper") {
      const target = seatOf(s, a.to);
      if (!target || target.status !== "alive" || target.address === address) {
        throw new Error("invalid whisper target");
      }
      to = target.address;
    }
    st.msgCount[address] = n + 1;
    s.messages.push({
      from: address,
      ...(to ? { to } : {}),
      text: a.text,
      stage: st.index,
      phase: st.phase,
    });
    return;
  }

  if (a.type === "ready") {
    // `ready` = "terminé de hablar" en charla, o "paso" en la Cerradura (la
    // única decisión opcional). En cualquier otra fase de decisión no vale.
    if (st.phase !== "talk" && st.kind !== "lock")
      throw new Error("ready not allowed in this phase");
    if (st.ready.includes(address) || st.decisions[address]) throw new Error("already decided");
    st.ready.push(address);
    return;
  }

  if (st.phase !== "decide" || DECIDE_KIND[a.type] !== st.kind) {
    throw new Error(`action ${a.type} not allowed now (${st.kind}/${st.phase})`);
  }
  if (st.decisions[address] || st.ready.includes(address)) throw new Error("already decided");
  let decision: VaultAction = a;
  if (a.type === "vote") {
    const target = seatOf(s, a.target);
    if (!target || target.status !== "alive" || target.address === address) {
      throw new Error("invalid vote target");
    }
    decision = { type: "vote", target: target.address };
  }
  if (a.type === "submit" && a.code.length !== st.codeLength) {
    throw new Error(`invalid code length (expected ${st.codeLength})`);
  }
  st.decisions[address] = decision;
}

/** ¿La fase actual ya puede cerrarse antes del plazo? (todos los vivos
 *  decidieron / mandaron ready). El árbitro agrega el `phase_end` con este motivo. */
export function phaseComplete(s: VaultState): "all_acted" | "all_ready" | null {
  if (s.over) return null;
  const st = s.stage;
  const alive = aliveSeats(s);
  if (st.phase === "talk") {
    return alive.every((x) => st.ready.includes(x.address)) ? "all_ready" : null;
  }
  const done = (x: Seat) =>
    !!st.decisions[x.address] || (st.kind === "lock" && st.ready.includes(x.address));
  return alive.every(done) ? "all_acted" : null;
}

// ---------------------------------------------------------------------------
// CIERRE DE FASE: charla → decidir; decidir → resolver la etapa + director.
// ---------------------------------------------------------------------------

function endPhase(s: VaultState): void {
  const st = s.stage;
  if (st.phase === "talk") {
    st.phase = "decide";
    st.ready = [];
    st.msgCount = {};
    return;
  }
  const r: StageResult = { index: st.index, kind: st.kind, potAfter: 0, boxAfter: 0 };
  switch (st.kind) {
    case "share":
      resolveShare(s, r);
      break;
    case "offer":
      resolveOffer(s, r);
      break;
    case "vote":
      resolveVote(s, r);
      break;
    case "lock":
      resolveLock(s, r);
      break;
    case "final":
      resolveFinal(s, r);
      break;
  }
  if (st.kind !== "final") {
    // ABANDONO: dos ausencias seguidas en decisiones → fuera, bolsillo al pozo.
    const abandoned: string[] = [];
    for (const seat of aliveSeats(s)) {
      if (seat.absences >= R.MAX_ABSENCES) {
        seat.status = "abandoned";
        s.pot += seat.pocket;
        seat.pocket = 0;
        abandoned.push(seat.address);
      }
    }
    if (abandoned.length) r.abandoned = abandoned;
    // DECAIMIENTO: el pozo pierde 5 % por etapa (presión para cerrar trato).
    const decay = bps(s.pot, R.DECAY_BPS);
    s.pot -= decay;
    s.box += decay;
    r.decay = decay;
  }
  r.potAfter = s.pot;
  r.boxAfter = s.box;
  s.results.push(r);
  direct(s);
}

/** Marca ausencia (o la corta) según haya decisión en esta fase. */
function trackAbsence(seat: Seat, decided: boolean): void {
  seat.absences = decided ? 0 : seat.absences + 1;
}

function resolveShare(s: VaultState, r: StageResult): void {
  const st = s.stage;
  const share = st.share!;
  const kept: string[] = [];
  const contributed: string[] = [];
  for (const seat of aliveSeats(s)) {
    const d = st.decisions[seat.address];
    trackAbsence(seat, !!d);
    if (d?.type === "keep") {
      s.pot -= share;
      seat.pocket += share;
      kept.push(seat.address);
    } else {
      contributed.push(seat.address); // ausente = aporta
    }
  }
  const bonus = Math.min(s.box, contributed.length * st.shareBonus!);
  s.box -= bonus;
  s.pot += bonus;
  r.kept = kept;
  r.contributed = contributed;
  r.bonus = bonus;
}

function resolveOffer(s: VaultState, r: StageResult): void {
  const st = s.stage;
  const alive = aliveSeats(s);
  const accepted: string[] = [];
  for (const seat of alive) {
    const d = st.decisions[seat.address];
    trackAbsence(seat, !!d);
    if (d?.type === "accept") accepted.push(seat.address);
  }
  r.offerBps = st.offerBps;
  r.accepted = accepted;
  if (accepted.length === 0) return;
  if (accepted.length === alive.length) {
    // Aceptan todos: la oferta se anula y el pozo pierde 10 %.
    const burn = bps(s.pot, R.OFFER_VOID_BURN_BPS);
    s.pot -= burn;
    s.box += burn;
    r.voided = true;
    return;
  }
  const each = Math.floor(st.offerTotal! / accepted.length);
  for (const a of accepted) {
    const seat = seatOf(s, a)!;
    seat.pocket += each;
    seat.status = "left";
  }
  s.pot -= each * accepted.length;
  r.eachGot = each;
}

function resolveVote(s: VaultState, r: StageResult): void {
  const st = s.stage;
  const alive = aliveSeats(s);
  const votes: Record<string, number> = {};
  for (const seat of alive) votes[seat.address] = 0;
  for (const seat of alive) {
    const d = st.decisions[seat.address];
    trackAbsence(seat, !!d);
    const target = d?.type === "vote" ? d.target : seat.address; // ausente: en contra propio
    votes[target] += 1;
  }
  const max = Math.max(...Object.values(votes));
  const tied = alive.filter((x) => votes[x.address] === max);
  // Desempate: bolsillo más grande → más votos acumulados ANTES de esta etapa
  // → orden oculto de la semilla. El azar es el último recurso.
  tied.sort(
    (a, b) =>
      b.pocket - a.pocket ||
      b.votesReceived - a.votesReceived ||
      s.tiebreak.indexOf(a.address) - s.tiebreak.indexOf(b.address),
  );
  const out = tied[0];
  out.status = "voted_out";
  for (const seat of alive) seat.votesReceived += votes[seat.address];
  r.votes = votes;
  r.eliminated = out.address;
}

function resolveLock(s: VaultState, r: StageResult): void {
  const st = s.stage;
  const solvers: string[] = [];
  const traitors: string[] = [];
  for (const seat of aliveSeats(s)) {
    const d = st.decisions[seat.address];
    if (d?.type === "submit" && d.code === st.code) {
      solvers.push(seat.address);
      if (d.intent === "me") traitors.push(seat.address);
    }
  }
  r.code = st.code;
  r.solvers = solvers;
  r.traitors = traitors;
  if (solvers.length === 0) {
    const burn = bps(s.pot, R.LOCK_FAIL_BURN_BPS);
    s.pot -= burn;
    s.box += burn;
    r.failed = true;
    return;
  }
  if (traitors.length === 0) {
    const bonus = Math.min(s.box, bps(s.pot, R.LOCK_BONUS_BPS));
    s.box -= bonus;
    s.pot += bonus;
    r.bonus = bonus;
    return;
  }
  const total = bps(s.pot, R.LOCK_TRAITOR_BPS);
  const each = Math.floor(total / traitors.length);
  for (const t of traitors) seatOf(s, t)!.pocket += each;
  s.pot -= each * traitors.length;
  r.eachGot = each;
}

function resolveFinal(s: VaultState, r: StageResult): void {
  const st = s.stage;
  const alive = aliveSeats(s);
  const choices: Record<string, "split" | "steal"> = {};
  for (const seat of alive) {
    choices[seat.address] = st.decisions[seat.address]?.type === "steal" ? "steal" : "split";
  }
  const thieves = alive.filter((x) => choices[x.address] === "steal");
  if (thieves.length === 0) {
    const half = Math.floor(s.pot / alive.length);
    for (const seat of alive) seat.pocket += half;
    s.box += s.pot - half * alive.length; // la unidad sobrante, si la hay
  } else if (thieves.length === 1) {
    thieves[0].pocket += s.pot;
  } else {
    s.box += s.pot; // roban los dos: el pozo se quema
  }
  s.pot = 0;
  for (const seat of alive) seat.status = "finished";
  r.choices = choices;
}

/** EL DIRECTOR: qué viene después de cada etapa. */
function direct(s: VaultState): void {
  if (s.stage.kind === "final") return finish(s);
  const alive = aliveSeats(s);
  if (alive.length === 0) {
    s.box += s.pot;
    s.pot = 0;
    return finish(s);
  }
  if (alive.length === 1) {
    alive[0].pocket += s.pot;
    s.pot = 0;
    alive[0].status = "finished";
    return finish(s);
  }
  if (alive.length === 2) return beginStage(s, "final");
  beginStage(s, s.deck.shift() ?? "vote");
}

/** Tabla de pagos: bolsillo + parte igual de la caja; el resto (menos de N
 *  unidades) al bolsillo más grande (empate: menor índice). Suma potInitial. */
function finish(s: VaultState): void {
  const n = s.seats.length;
  const each = Math.floor(s.box / n);
  const dust = s.box - each * n;
  const payouts: Record<string, number> = {};
  for (const seat of s.seats) payouts[seat.address] = seat.pocket + each;
  const richest = s.seats.reduce((best, x) => (x.pocket > best.pocket ? x : best), s.seats[0]);
  payouts[richest.address] += dust;
  s.payouts = payouts;
  s.over = true;
}

// ---------------------------------------------------------------------------
// VISTA por asiento (filtra secretos) y RE-SIMULACIÓN del registro.
// ---------------------------------------------------------------------------

export interface VaultView {
  rulesV: number;
  over: boolean;
  pot: number;
  box: number;
  potInitial: number;
  cardsLeft: number;
  seats: { address: string; status: SeatStatus; pocket: number }[];
  stage: {
    index: number;
    kind: StageKind;
    phase: Phase;
    /** Quiénes ya actuaron en esta fase (no QUÉ hicieron). */
    acted: string[];
    share?: number;
    shareBonus?: number;
    offerBps?: number;
    offerTotal?: number;
    codeLength?: number;
  };
  results: StageResult[];
  you?: {
    status: SeatStatus;
    pocket: number;
    absences: number;
    decided: boolean;
    ready: boolean;
    fragment?: Fragment;
  };
  /** Públicos de la etapa actual + privados hacia/desde este asiento. Al
   *  terminar la sala: todos, también los privados (el registro es público). */
  messages: VaultMessage[];
  payouts?: Record<string, number>;
}

/** Lo que ESTE asiento puede saber. Sin `address`: la vista pública. Nunca:
 *  fragmentos ajenos, decisiones pendientes de otros, el mazo, la semilla,
 *  privados entre terceros. */
export function viewFor(s: VaultState, address?: string): VaultView {
  const me = address ? seatOf(s, address) : undefined;
  const st = s.stage;
  const messages = s.messages.filter(
    (m) =>
      s.over || (m.stage === st.index && (!m.to || m.to === me?.address || m.from === me?.address)),
  );
  const v: VaultView = {
    rulesV: s.rulesV,
    over: s.over,
    pot: s.pot,
    box: s.box,
    potInitial: s.potInitial,
    cardsLeft: s.deck.length,
    seats: s.seats.map(({ address, status, pocket }) => ({ address, status, pocket })),
    stage: {
      index: st.index,
      kind: st.kind,
      phase: st.phase,
      acted: [...Object.keys(st.decisions), ...st.ready],
      share: st.share,
      shareBonus: st.shareBonus,
      offerBps: st.offerBps,
      offerTotal: st.offerTotal,
      codeLength: st.codeLength,
    },
    results: s.results,
    messages,
  };
  if (me) {
    v.you = {
      status: me.status,
      pocket: me.pocket,
      absences: me.absences,
      decided: !!st.decisions[me.address],
      ready: st.ready.includes(me.address),
      fragment: st.fragments?.[me.address],
    };
  }
  if (s.payouts) v.payouts = s.payouts;
  return v;
}

/** Re-simula una sala desde su registro. Es lo que corre el árbitro para
 *  operar y lo que corre cualquiera para verificar la tabla de pagos. */
export function replayVault(
  seed: string,
  seats: string[],
  events: VaultEvent[],
  opts: { deck?: StageKind[] } = {},
): VaultState {
  let s = createVault(seed, seats, opts);
  for (const ev of events) s = applyEvent(s, ev);
  return s;
}
