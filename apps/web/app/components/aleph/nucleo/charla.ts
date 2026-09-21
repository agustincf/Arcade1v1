// LA CHARLA, COMO TERMINAL. Es el dato más vivo que publica el árbitro y hasta
// hoy llegaba al navegador en cada sondeo sin que nadie lo dibujara.
//
// Mientras la sala juega, `viewFor` manda únicamente los mensajes PÚBLICOS de
// la etapa en curso. Al liquidar deja de filtrar y manda todo, también los
// privados: por eso la terminal tiene que saber marcarlos desde el día uno.

import type { EtapaKind, SalaDeAleph } from "./estados";

export type LineaDeCharla =
  | { tipo: "etapa"; n: number; kind?: EtapaKind }
  | { tipo: "mensaje"; from: string; to?: string; texto: string; susurro: boolean };

export interface ModeloDeCharla {
  /** La sala liquidó y el canal privado se abrió. */
  desclasificada: boolean;
  lineas: LineaDeCharla[];
}

/** `null` cuando el árbitro no manda `messages`: en `lobby`, `funding` y
 *  `dissolved` la rama de la vista devuelve los asientos, las cuentas
 *  regresivas y el reembolso, y nada más. Ahí no hay etapa en curso, así que
 *  el vacío y la nota de "solo esta etapa" nombrarían una etapa que todavía no
 *  existe. `Charla.tsx` con `null` no renderiza nada. */
export function lineasDeCharla(room: SalaDeAleph): ModeloDeCharla | null {
  if (room.messages === undefined) return null;
  const desclasificada = room.status === "settled";
  // `AlephEvent` y los mensajes traen el número de etapa, no su nombre: el
  // `kind` para el separador sale de `results`.
  const kinds = new Map((room.results ?? []).map((r) => [r.index, r.kind]));
  const lineas: LineaDeCharla[] = [];
  let etapaActual: number | null = null;

  for (const m of room.messages) {
    // En vivo, un mensaje con `to` no se muestra ni se cuenta. Hoy es
    // imposible; mañana el árbitro puede cambiar.
    if (!desclasificada && m.to) continue;
    if (desclasificada && m.stage !== etapaActual) {
      etapaActual = m.stage;
      lineas.push({ tipo: "etapa", n: m.stage + 1, kind: kinds.get(m.stage) });
    }
    lineas.push({
      tipo: "mensaje",
      from: m.from,
      to: m.to,
      texto: m.text,
      susurro: Boolean(m.to),
    });
  }
  // No se reordena: el orden en que vienen ES el orden cronológico de inserción
  // del motor.
  return { desclasificada, lineas };
}
