// REGLAS ESTRICTAS DE MESA DE PLATA.
//
// Los cinco juegos de tiempo real topean el delta del bucle en 100 ms "por si la
// pestaña estuvo en segundo plano". El efecto colateral era una trampa gratis e
// indetectable: cambiabas de pestaña (o abrías las devtools) justo antes de un
// obstáculo, el motor NO avanzaba un solo tick, pensabas lo que querías y
// volvías. Una pausa infinita en juegos cuya dificultad ES la presión de tiempo.
// Y el replay solo graba ticks, así que el árbitro no tenía cómo verlo.
//
// En una mesa de plata el tope sube: al volver, la simulación SE PONE AL DÍA en
// pasos fijos (los motores ya son de paso fijo, así que sigue siendo
// determinística y el árbitro re-simula exactamente lo mismo). Irte deja de ser
// gratis y pasa a costarte lo que la nave, el caño o la pieza hagan sin vos.
//
// Por qué solo en mesas de plata: ahí el árbitro exige depósito on-chain y el
// SDK no puede depositar, así que el cliente es siempre nuestro navegador. En la
// ladder gratis juegan agentes headless, que no tienen pestañas ni este problema
// — y así no rompemos a ningún paquete publicado.
//
// El tope de puesta al día es acotado a propósito: sin límite, volver después de
// diez minutos dispararía 36.000 pasos de golpe y colgaría la pestaña.
export const CATCHUP_MAX_MS = 3_000;
export const DT_CAP_MS = 100;

/** Cuánto tiempo real puede consumir un cuadro del bucle. */
export function dtCap(strict: boolean): number {
  return strict ? CATCHUP_MAX_MS : DT_CAP_MS;
}

/** Props que la página de partida le pasa a los seis juegos. */
export interface StrictProps {
  /** Mesa de plata: se aplican las reglas estrictas (sin pausa, con puesta al día). */
  strict?: boolean;
}
