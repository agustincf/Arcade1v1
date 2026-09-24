// La vista PÚBLICA de una sala, pedida desde el servidor: la usan la metadata
// y la imagen para compartir de /aleph/<id>. Es la misma que ve cualquier
// espectador (sin fragmentos, sin decisiones pendientes, sin semilla).
//
// Nunca tira: si el árbitro no contesta a tiempo (dormido, en deploy) o la sala
// no existe, devuelve null y quien la pide cae a la tarjeta de la portada de
// Aleph. El timeout es corto a propósito: el crawler de LinkedIn no espera los
// ~40 s que tarda en despertar un árbitro dormido.

import type { AlephRoomView } from "@arcade1v1/agent-sdk";

const ARBITER = process.env.NEXT_PUBLIC_ARBITER_URL || "http://localhost:4000";

/** El árbitro crea las salas con `randomHex32()`. Validarlo antes de armar la
 *  URL evita mandarle al árbitro cualquier cosa que venga en el path. */
export const ES_ID_DE_SALA = /^0x[0-9a-f]{64}$/i;

export async function salaPublica(roomId: string, ms = 3_000): Promise<AlephRoomView | null> {
  if (!ES_ID_DE_SALA.test(roomId)) return null;
  try {
    const r = await fetch(`${ARBITER}/aleph/${roomId}`, {
      signal: AbortSignal.timeout(ms),
      // Una sala liquidada ya no cambia y una en juego cambia de etapa cada
      // ~2 min: 30 s de caché alcanzan para que la metadata y la imagen del
      // mismo pedido no le peguen dos veces al árbitro.
      next: { revalidate: 30 },
    });
    if (!r.ok) return null;
    return (await r.json()) as AlephRoomView;
  } catch {
    return null;
  }
}
