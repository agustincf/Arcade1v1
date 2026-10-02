// Lo que una PERSONA lee del resultado de una herramienta: una línea de
// resumen y el link a la página de la web que lo muestra (la repetición de una
// partida 1v1, la escena de una sala de Aleph). El JSON sigue saliendo entero
// para el modelo; esto va al lado, nunca en su lugar. Funciones puras: todo lo
// que dependa del reloj o de la red llega por argumento.
import type { MatchView, AlephRoomView } from "@arcade1v1/agent-sdk";

/** La web pública que acompaña al árbitro publicado. */
export const DEFAULT_WEB_URL = "https://arcade1v1.com";
export const DEFAULT_ARBITER_URL = "https://arcade1v1.onrender.com";

/** A qué web apuntan los links. ARCADE_WEB_URL le gana a todo; sin ella, solo
 *  el árbitro publicado tiene web conocida: con un ARBITER_URL propio (local,
 *  un fork) un link a arcade1v1.com mostraría OTRA partida o un 404, así que
 *  no se arma ningún link. */
export function webUrlFor(arbiterUrl: string, envWebUrl?: string): string | undefined {
  const explicit = envWebUrl?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return arbiterUrl.replace(/\/+$/, "") === DEFAULT_ARBITER_URL ? DEFAULT_WEB_URL : undefined;
}

export const watchUrl = (web: string | undefined, matchId: string) =>
  web ? `${web}/watch/${encodeURIComponent(matchId)}` : undefined;

export const roomUrl = (web: string | undefined, roomId: string) =>
  web ? `${web}/aleph/${encodeURIComponent(roomId)}` : undefined;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Una partida 1v1 en una o dos frases, desde el lado de quien consulta. */
export function summarizeMatch(v: MatchView, web: string | undefined): string {
  const head = `${v.game} match ${v.matchId}`;
  const decided = v.status === "settled" || v.status === "draw";
  const parts: string[] = [];

  if (decided && v.yourScore !== undefined && v.rivalScore !== undefined) {
    const draw = v.status === "draw" || v.outcome === "draw" || v.yourScore === v.rivalScore;
    const verdict = draw ? "Draw" : v.yourScore > v.rivalScore ? "You won" : "You lost";
    parts.push(`${verdict} the ${head}: ${v.yourScore} to ${v.rivalScore}.`);
    if (v.rating !== undefined) {
      parts.push(
        `Rating now ${v.rating}` +
          (v.ratingDelta !== undefined ? ` (${signed(v.ratingDelta)}).` : "."),
      );
    }
    if (v.stake > 0 && v.netPnl !== undefined) parts.push(`Net: ${signed(v.netPnl)} USDC.`);
  } else if (decided) {
    // Consultada sin `address`: no hay "vos", solo los dos puntajes.
    const scores = Object.entries(v.scores)
      .map(([a, s]) => `${a.slice(0, 6)}…${a.slice(-4)} ${s}`)
      .join(" vs ");
    parts.push(`The ${head} is decided${scores ? `: ${scores}` : ""}.`);
  } else if (v.yourScore !== undefined) {
    parts.push(
      `Your score in the ${head}: ${v.yourScore}. ` +
        (v.rivalSubmitted
          ? "The rival already played; the result is being settled."
          : "Waiting for a rival to play — the result comes when they do (no need to stay online)."),
    );
  } else {
    parts.push(
      `The ${head} is open: ${v.status === "waiting" ? "waiting for a rival" : "ready to play"}.`,
    );
  }

  const link = watchUrl(web, v.matchId);
  if (link) {
    parts.push(
      decided
        ? `Watch both runs side by side: ${link}`
        : `Once it is decided, both runs can be watched at ${link}`,
    );
  }
  return parts.join(" ");
}

/** Una sala de Aleph en una o dos frases: dónde está y dónde mirarla. */
export function summarizeAleph(
  v: AlephRoomView,
  web: string | undefined,
  me: string,
  msLeft?: number,
): string {
  const parts: string[] = [];
  const head = `Aleph room ${v.roomId}`;
  if (v.status === "lobby") {
    parts.push(`${head}: lobby, ${v.seats.length}/${v.max} seats (starts at ${v.min}).`);
  } else if (v.status === "funding") {
    parts.push(`${head}: waiting for deposits (${(v.deposited ?? []).length}/${v.seats.length}).`);
  } else if (v.status === "playing" && v.stage) {
    const alive = v.seats.filter((s) => s.status === "alive").length;
    const secs = msLeft === undefined ? "" : `, ${Math.ceil(msLeft / 1000)} s left`;
    parts.push(
      `${head}: stage ${v.stage.index + 1} (${v.stage.kind}, ${v.stage.phase}${secs}), ` +
        `${alive} seats alive, pot ${v.pot}.`,
    );
  } else if (v.status === "settled") {
    const mine = v.payouts?.[me];
    parts.push(
      `${head} is over.` +
        (mine !== undefined ? ` Your payout: ${mine} units (every seat put in 1000).` : "") +
        (v.rating ? ` Rating now ${v.rating.after} (${signed(v.rating.delta)}).` : ""),
    );
  } else {
    parts.push(`${head}: ${v.status}.`);
  }
  const link = roomUrl(web, v.roomId);
  if (link) parts.push(`Watch the table (public view, whispers revealed when it ends): ${link}`);
  return parts.join(" ");
}
