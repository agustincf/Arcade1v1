// packages/game-sdk/test/aleph-helpers.ts
// Helpers compartidos por los tests del motor de Aleph.
import {
  applyEvent,
  type AlephAction,
  type AlephState,
  type PhaseEndReason,
} from "@arcade1v1/game-sdk/aleph";

export const SEED = "0x" + "5eed".repeat(16);
export const A = (i: number) => "0x" + i.toString(16).padStart(40, "0");
export const seats = (n: number) => Array.from({ length: n }, (_, i) => A(i + 1));
/** Semillas variadas y reproducibles (64 hex). */
export const seedN = (i: number) =>
  "0x" +
  Array.from({ length: 64 }, (_, j) => ((i * 31 + j * 17 + i * j) % 16).toString(16)).join("");

/** Aplica una acción de `address` en la etapa/fase ACTUAL del estado. */
export function act(s: AlephState, address: string, action: AlephAction): AlephState {
  return applyEvent(s, {
    type: "action",
    address,
    stage: s.stage.index,
    phase: s.stage.phase,
    action,
    ts: 0,
  });
}

/** Cierra la fase actual (por defecto, por vencimiento del plazo). */
export function end(s: AlephState, reason: PhaseEndReason = "deadline"): AlephState {
  return applyEvent(s, {
    type: "phase_end",
    stage: s.stage.index,
    phase: s.stage.phase,
    at: 0,
    reason,
  });
}

/** Si la etapa está en charla, la cierra; devuelve el estado en `decide`. */
export function skipTalk(s: AlephState): AlephState {
  return s.stage.phase === "talk" ? end(s) : s;
}

/** Todos los vivos deciden lo mismo y se cierra la fase. */
export function allDecide(s: AlephState, action: AlephAction): AlephState {
  let cur = skipTalk(s);
  for (const seat of cur.seats) if (seat.status === "alive") cur = act(cur, seat.address, action);
  return end(cur, "all_acted");
}

/** Conservación: en todo momento pot + box + Σ pocket === potInitial, sin negativos. */
export function assertConserved(s: AlephState): void {
  const pockets = s.seats.reduce((acc, x) => acc + x.pocket, 0);
  if (s.pot + s.box + pockets !== s.potInitial) {
    throw new Error(
      `conservación rota: pot ${s.pot} + box ${s.box} + pockets ${pockets} != ${s.potInitial}`,
    );
  }
  if (s.pot < 0 || s.box < 0 || s.seats.some((x) => x.pocket < 0)) {
    throw new Error("valor negativo");
  }
}
