// DE QUÉ DATO SALE CADA ESTADO. Este archivo es puro y no importa nada del SDK:
// declara la forma mínima de la vista que necesita, y `AlephRoomView` encaja
// por estructura. Así los tests arman fixtures de tres líneas y el módulo se
// lee con `node --test` sin DOM ni configuración nueva.

import type { Estado } from "./criatura";

export type EstadoDeSala = "lobby" | "funding" | "playing" | "settled" | "dissolved";
export type EstadoDeAsiento = "alive" | "left" | "voted_out" | "abandoned" | "finished";
export type EtapaKind = "share" | "offer" | "vote" | "lock" | "final";
export type Fase = "talk" | "decide";

export interface AsientoDeSala {
  address: string;
  status: EstadoDeAsiento;
  pocket: number;
  /** Ficha pública que resuelve el árbitro. La escena NO la lee: se la pasa
   *  entera a `etiquetaDe`, que la arma la página con `playerLabel`/`agentTag`. */
  name?: string;
  avatar?: string;
  agentId?: string;
  house?: boolean;
  byo?: boolean;
}

export interface ResultadoDeEtapa {
  index: number;
  kind: EtapaKind;
  accepted?: string[];
  eachGot?: number;
  voided?: boolean;
  traitors?: string[];
  choices?: Record<string, "split" | "steal">;
  /** Los cuatro que lee el friso y la ventana de votos de la liquidación. */
  eliminated?: string;
  abandoned?: string[];
  bonus?: number;
  votes?: Record<string, number>;
}

export interface MensajeDeSala {
  from: string;
  /** Sin `to` = público. En vivo el árbitro nunca lo manda. */
  to?: string;
  text: string;
  stage: number;
  phase: Fase;
}

export interface SalaDeAleph {
  status: EstadoDeSala;
  seats: AsientoDeSala[];
  /** Los del lobby. `AlephRoomView` los trae siempre; acá van opcionales para
   *  que un fixture de tres líneas siga compilando. */
  min?: number;
  max?: number;
  closesAt?: number;
  /** Fin de la fase en curso. Solo `playing`. */
  deadline?: number;
  /** La mesa. No vienen en `lobby`, `funding` ni `dissolved`. */
  pot?: number;
  box?: number;
  potInitial?: number;
  cardsLeft?: number;
  /** No viene en `lobby`, `funding` ni `dissolved`. */
  stage?: { index: number; kind: EtapaKind; phase: Fase; acted: string[] };
  results?: ResultadoDeEtapa[];
  messages?: MensajeDeSala[];
  deposited?: string[];
  payouts?: Record<string, number>;
}

/** Las direcciones se comparan SIN caja: el árbitro sirve `deposited` en
 *  minúsculas y `seats[].address` puede venir en EIP-55. Las exporta para que
 *  `escena.ts` no escriba su propia versión. */
export const igual = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const incluye = (xs: string[] | undefined, a: string) => (xs ?? []).some((x) => igual(x, a));

/** Quiénes llevan corona. Con Final: un solo `steal` la lleva él (se llevó el
 *  pozo); los dos `split`, los dos; los dos `steal`, ninguno (el pozo se
 *  quemó). SIN Final —y es el caso común: la Final solo se abre cuando quedan
 *  exactamente dos vivos— la lleva el que quedó `finished` con la sala
 *  liquidada, que es lo que la corona significa. Con cero vivos, nadie. */
function coronados(room: SalaDeAleph): string[] {
  const final = (room.results ?? []).find((r) => r.kind === "final");
  if (final) {
    const elecciones = Object.entries(final.choices ?? {});
    const ladrones = elecciones.filter(([, c]) => c === "steal").map(([a]) => a);
    if (ladrones.length === 1) return ladrones;
    if (ladrones.length === 0) return elecciones.map(([a]) => a);
    return [];
  }
  if (room.status !== "settled") return [];
  return room.seats.filter((s) => s.status === "finished").map((s) => s.address);
}

/** El estado se calcula con esta prioridad, y la primera que aplica gana. Las
 *  tres condiciones del medio piden `room.status === "playing"` a propósito:
 *  con la sala liquidada nadie está sellado ni hablando, y en `lobby` o
 *  `funding` no hay etapa que sellar — el árbitro ni siquiera manda `stage`. */
export function estadoDeAsiento(
  seat: AsientoDeSala,
  room: SalaDeAleph,
): { estado: Estado; traidor: boolean } {
  const a = seat.address;
  const resultados = room.results ?? [];
  // Es permanente una vez revelada: es dato cerrado, y hay como mucho una
  // Cerradura por mazo.
  const traidor = incluye(resultados.find((r) => r.kind === "lock")?.traitors, a);
  const estado = ((): Estado => {
    // 0) Sale del estado de la SALA, no del asiento: en `dissolved` el árbitro
    //    manda todos los asientos `alive`, así que sin esta fila una sala
    //    disuelta se dibujaría con ocho criaturas de reposo, como si jugaran.
    if (room.status === "dissolved") return "abandono";
    if (seat.status === "left") return "se_fue";
    if (seat.status === "voted_out") return "votado";
    if (seat.status === "abandoned") return "abandono";
    if (incluye(coronados(room), a)) return "ganador";
    const stage = room.stage;
    if (room.status === "playing" && stage) {
      if (incluye(stage.acted, a)) return "sellado";
      // `messages` viene filtrado por ETAPA y no por fase, y al pasar de `talk`
      // a `decide` el motor no lo toca: sin este recorte el último que habló se
      // quedaría con el chip "habla" durante toda la fase de decisión.
      const deLaFase = (room.messages ?? []).filter((m) => m.phase === stage.phase);
      const ultimo = deLaFase[deLaFase.length - 1];
      if (ultimo && igual(ultimo.from, a)) return "hablando";
      if (stage.phase === "decide" && seat.status === "alive") return "esperando";
    }
    // `base` incluye a los `finished` sin corona y a todos los asientos en
    // `lobby`, `funding` y `settled` sin corona.
    return "base";
  })();
  return { estado, traidor };
}

/** El ÚNICO lugar donde vive la tabla de chips: con esta función en un solo
 *  lado, el ternario no se repite en cada forma de tarjeta. Las filas 0 y 1 van
 *  arriba de todo porque en esos dos estados de sala el `seat.status` no dice
 *  nada: el árbitro manda `alive` para todos. */
export function chipDeAsiento(seat: AsientoDeSala, room: SalaDeAleph, previo?: Estado): string {
  if (room.status === "dissolved") return "aleph.seat.dissolved";
  if (room.status === "funding")
    return incluye(room.deposited, seat.address) ? "aleph.seat.deposited" : "aleph.seat.pending";
  // En el lobby todavía no se juega nada: el árbitro manda `alive` y eso
  // decía "en juego" en cada asiento.
  if (room.status === "lobby") return "aleph.seat.lobby";
  // `previo` es el estado que el llamador YA calculó. Sin él, cada asiento
  // vuelve a recorrer `results` y `messages` una segunda vez.
  const estado = previo ?? estadoDeAsiento(seat, room).estado;
  // La corona SIN Final (la sala liquidó antes de abrirla) es del que quedó en
  // pie, no de una Final que no existió: "ganó la Final" contradecía la carta
  // `aleph.scene.settledNoFinal` que la escena muestra al lado.
  if (estado === "ganador")
    return (room.results ?? []).some((r) => r.kind === "final")
      ? "aleph.state.ganador"
      : "aleph.state.enPie";
  if (estado === "hablando") return "aleph.state.hablando";
  if (estado === "esperando") return "aleph.state.esperando";
  if (estado === "sellado")
    // `stage.acted` es `[...decisions, ...ready]`: en `decide` son los que
    // decidieron, en `talk` los que mandaron `ready`. El dibujo es el mismo
    // sello —en las dos significa "actuó y no sabemos qué"—, cambia el chip.
    return room.stage?.phase === "decide" ? "aleph.state.decidio" : "aleph.state.listo";
  return `aleph.seat.${seat.status}`;
}
