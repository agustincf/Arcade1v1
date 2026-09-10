// RELLENO DE LA CASA en Aleph: lo que hace que una mesa arranque.
//
// El problema que resuelve: una sala necesita 4 asientos dentro de la misma
// ventana de 10 minutos o el lobby se disuelve. El agente curioso que llega
// primero espera solo, no ve nada y se va — y como no vuelve, nunca hay cuatro.
// Es el arranque en frío clásico, y ninguna etapa del formato lo resolvía.
//
// Qué hace: cuando a un lobby le quedan pocos minutos, YA HAY alguien de verdad
// sentado y no llega al mínimo, la casa completa los asientos que faltan y
// después juega esos asientos con una política guionada.
//
// Tres límites que no se negocian:
//  1. NUNCA arma una mesa de puros asientos de la casa. Si no hay al menos un
//     agente de verdad esperando, el lobby se disuelve como siempre.
//  2. NUNCA entra a una mesa con plata (stake > 0). Hoy solo existe la gratis;
//     cuando la etapa 4 traiga las de plata, esta guarda ya está puesta.
//  3. Entra TARDE a propósito: mientras quede tiempo real para que llegue gente
//     de verdad, la casa no toca nada.
//
// Va por las mismas funciones in-process que usa cualquier agente externo
// (`joinAleph`, `actAleph`), con acciones FIRMADAS por la wallet del asiento:
// un solo code path, las mismas reglas, la misma verificación del registro.
import { privateKeyToAccount } from "viem/accounts";
import {
  actionLine,
  viewFor,
  type AlephAction,
  type AlephView,
  type Fragment,
} from "@arcade1v1/game-sdk/aleph";
import { matchmakeAuthMessage, alephActionAuthMessage } from "@arcade1v1/game-sdk/auth";
import {
  ALEPH_LOBBY_MS,
  ALEPH_MIN_SEATS,
  alephEnabled,
  actAleph,
  joinAleph,
  liveAlephRooms,
  stateOf,
} from "./aleph.js";
import { houseSeats, isAlephHouseAddress, type HouseSeat } from "./aleph-house-seats.js";

/** Kill switch propio: apagar el relleno NO apaga Aleph. Encendido por defecto,
 *  porque sin relleno el formato no arranca ninguna mesa. */
export const alephHouseEnabled = () => process.env.ALEPH_HOUSE_ENABLED !== "false";

/** Cuánto antes del cierre del lobby entra la casa. Por defecto, los últimos
 *  2 minutos de los 10: entrar antes le robaría la silla a alguien de verdad. */
const FILL_LEAD_MS = Number(process.env.ALEPH_HOUSE_FILL_LEAD_MS ?? 2 * 60_000);

/** Cada cuánto revisa. Igual que el ticker del formato: no hay apuro, las fases
 *  duran minutos. */
const TICK_MS = Number(process.env.ALEPH_HOUSE_TICK_MS ?? 5_000);

const FRAGMENT_RE = /#(\d+)=(\d)/g;

let ticker: NodeJS.Timeout | undefined;

// ---- Firmar y actuar ----------------------------------------------------------

async function seatJoin(seat: HouseSeat, stake: number, now: number): Promise<void> {
  const account = privateKeyToAccount(seat.privateKey);
  const ts = now;
  const signature = await account.signMessage({
    message: matchmakeAuthMessage("aleph", stake, seat.address, ts),
  });
  await joinAleph(stake, seat.address, { signature, ts }, now);
}

async function seatAct(
  seat: HouseSeat,
  roomId: string,
  stage: number,
  phase: "talk" | "decide",
  action: AlephAction,
  now: number,
): Promise<void> {
  const account = privateKeyToAccount(seat.privateKey);
  const ts = now;
  const signature = await account.signMessage({
    message: alephActionAuthMessage(roomId, stage, phase, actionLine(action), ts),
  });
  await actAleph(roomId, seat.address, { stage, phase, action, signature, ts }, now);
}

// ---- Política -----------------------------------------------------------------

/** Azar reproducible por (asiento, sala, etapa): la misma sala re-simulada da
 *  las mismas decisiones, así un registro raro se puede depurar. */
function roll(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const c of parts.join("|")) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Los fragmentos que este asiento puede ver: el suyo más los que otros
 *  anunciaron en público con el formato `#pos=digito`. */
function knownFragments(v: AlephView, mine: Fragment | undefined): Map<number, string> {
  const out = new Map<number, string>();
  if (mine) out.set(mine.pos, mine.digit);
  for (const m of v.messages) {
    if (m.stage !== v.stage.index) continue;
    for (const [, pos, digit] of m.text.matchAll(FRAGMENT_RE)) {
      const p = Number(pos);
      if (Number.isInteger(p) && p >= 0 && !out.has(p)) out.set(p, digit);
    }
  }
  return out;
}

/** Qué hace este asiento AHORA, o undefined si le toca esperar. `offerTaken`
 *  dice si otro asiento de la casa ya aceptó la oferta en esta etapa. */
export function houseAction(
  seat: HouseSeat,
  v: AlephView,
  roomId: string,
  offerTaken: boolean,
): AlephAction | undefined {
  const st = v.stage;
  const me = seat.address;
  const r = roll(me, roomId, st.index, st.phase);
  const alive = v.seats.filter((s) => s.status === "alive");

  if (st.phase === "talk") {
    // Cerradura: el que coopera CANTA su fragmento. Sin eso la etapa es
    // imposible — cada asiento tiene una sola posición del código, y un
    // guionado no sabe negociar. El avaro se lo calla.
    const mine = v.you?.fragment;
    const alreadySaid = v.messages.some((m) => m.from === me && m.stage === st.index);
    if (st.kind === "lock" && mine && !alreadySaid && seat.temperament !== "greedy") {
      return { type: "say", text: `#${mine.pos}=${mine.digit}` };
    }
    return { type: "ready" };
  }

  switch (st.kind) {
    case "share":
      // Guardarse la parte engorda el bolsillo pero adelgaza el pozo (y la
      // caja premia al que aporta).
      if (seat.temperament === "cooperative") return { type: "contribute" };
      if (seat.temperament === "greedy") return { type: "keep" };
      return { type: r < 0.5 ? "keep" : "contribute" };

    case "offer": {
      // Si aceptan TODOS los vivos, la oferta se anula y el pozo se quema 10 %.
      // La casa nunca puede provocar eso sola: como mucho acepta uno por etapa.
      if (offerTaken) return { type: "decline" };
      const bps = st.offerBps ?? 0;
      if (seat.temperament === "greedy" && bps >= 1500) return { type: "accept" };
      if (seat.temperament === "erratic" && r < 0.25) return { type: "accept" };
      return { type: "decline" };
    }

    case "vote": {
      const others = alive.filter((s) => s.address !== me);
      if (others.length === 0) return { type: "ready" };
      // El que más guardó es el que más amenaza: criterio legible, que un
      // agente de verdad puede leer y usar en su favor. El errático tira.
      const target =
        seat.temperament === "erratic"
          ? others[Math.floor(r * others.length)]
          : [...others].sort(
              (a, b) => b.pocket - a.pocket || a.address.localeCompare(b.address),
            )[0];
      return { type: "vote", target: target.address };
    }

    case "lock": {
      const need = st.codeLength ?? alive.length;
      const known = knownFragments(v, v.you?.fragment);
      if (known.size < need) return { type: "ready" }; // sin el código, nada que enviar
      let code = "";
      for (let i = 0; i < need; i++) code += known.get(i) ?? "";
      if (code.length !== need) return { type: "ready" };
      // Abrirla "para mí" reparte el 10 % del pozo entre los traidores; abrirla
      // "para todos" hace que la caja premie al pozo con un 20 %.
      const intent: "all" | "me" =
        seat.temperament === "cooperative"
          ? "all"
          : seat.temperament === "greedy"
            ? "me"
            : r < 0.5
              ? "me"
              : "all";
      return { type: "submit", code, intent };
    }

    case "final":
      if (seat.temperament === "cooperative") return { type: "split" };
      if (seat.temperament === "greedy") return { type: "steal" };
      return { type: r < 0.5 ? "split" : "steal" };
  }
}

// ---- El barrido ---------------------------------------------------------------

/** Asientos de la casa que no están en ninguna sala viva. El motor solo deja un
 *  asiento por address, así que un asiento ocupado no puede completar otra mesa. */
function freeSeats(now: number): HouseSeat[] {
  const busy = new Set(liveAlephRooms(now).flatMap((r) => r.seats));
  return houseSeats().filter((s) => !busy.has(s.address));
}

/** Completa los lobbies que están por vencerse con alguien de verdad adentro. */
async function fillLobbies(now: number): Promise<void> {
  for (const room of liveAlephRooms(now)) {
    if (room.status !== "lobby") continue;
    if (room.stake !== 0) continue; // la casa no pone plata (límite 2)
    if (now < room.createdAt + ALEPH_LOBBY_MS - FILL_LEAD_MS) continue; // todavía hay tiempo (3)
    if (room.seats.length >= ALEPH_MIN_SEATS) continue; // ya arranca sola
    // Al menos un asiento tiene que ser de un agente de verdad (límite 1).
    if (!room.seats.some((a) => !isAlephHouseAddress(a))) continue;

    const need = ALEPH_MIN_SEATS - room.seats.length;
    for (const seat of freeSeats(now).slice(0, need)) {
      await seatJoin(seat, room.stake, now);
    }
  }
}

/** Juega los asientos de la casa que tienen algo pendiente en la fase actual. */
async function playSeats(now: number): Promise<void> {
  for (const room of liveAlephRooms(now)) {
    if (room.status !== "playing") continue;
    const mine = houseSeats().filter((s) => room.seats.includes(s.address));
    if (mine.length === 0) continue;

    let offerTaken = false;
    for (const seat of mine) {
      // El estado se relee en cada vuelta: la acción anterior pudo cerrar la
      // fase (todos decidieron) y hasta la sala entera.
      if (room.status !== "playing") break;
      const v = viewFor(stateOf(room), seat.address);
      const you = v.you;
      if (!you || you.status !== "alive") continue;
      const st = v.stage;
      const phase = st.phase;
      if (phase === "talk" ? you.ready : you.decided) continue;

      const action = houseAction(seat, v, room.id, offerTaken);
      if (!action) continue;
      if (action.type === "accept") offerTaken = true;
      try {
        await seatAct(seat, room.id, st.index, phase, action, now);
      } catch (e) {
        // Una acción rechazada (la fase cerró mientras firmábamos, por ejemplo)
        // no puede frenar al resto de la mesa: se loguea y se sigue.
        console.error("[aleph-house]", seat.name, (e as Error).message);
      }
    }
  }
}

/** Un barrido completo. Exportado para que los tests lo corran con su reloj,
 *  sin esperar al intervalo. */
export async function alephHouseTick(now = Date.now()): Promise<void> {
  if (!alephHouseEnabled() || !alephEnabled()) return;
  await fillLobbies(now);
  await playSeats(now);
}

export function startAlephHouse(): void {
  if (ticker || !alephHouseEnabled()) return;
  ticker = setInterval(() => {
    alephHouseTick().catch((e) => console.error("[aleph-house] tick:", (e as Error).message));
  }, TICK_MS);
  ticker.unref?.();
}

/** Tests: frenar el barrido. */
export function stopAlephHouse(): void {
  if (ticker) clearInterval(ticker);
  ticker = undefined;
}
