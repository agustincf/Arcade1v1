// Utilidades COMPARTIDAS por los motores del arcade. Interno del paquete (no es
// un subpath público en package.json): cada motor lo importa de forma relativa.

/** RNG determinístico (mulberry32): misma semilla => misma secuencia, en
 *  cualquier runtime. Es la base del juego justo y del anti-trampa: la web y
 *  el árbitro generan EXACTAMENTE el mismo azar al re-jugar un replay. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ANTI-TRAMPA: cuántas acciones puede declarar un replay dentro de UN tick.
 *
 *  Sin este tope, `ticks` no acotaba nada: una partida entera entraba en
 *  `ticks: 1` y la gravedad nunca avanzaba, así que el jugador tenía tiempo
 *  infinito por pieza (medido: un replay de Tetris con `ticks: 1` y 109
 *  acciones pasaba la verificación).
 *
 *  El valor sale de medir el techo REAL del juego, no de una intuición: colocar
 *  una pieza de Tetris necesita como mucho 3 rotaciones + ~5 desplazamientos +
 *  1 soltada = 9 acciones en el mismo tick. Sobre 540 corridas de la estrategia
 *  oficial (60 semillas × 9 combinaciones de parámetros, incluidos los extremos
 *  de cada slider) el peor caso fue exactamente 9. 16 deja 1,8× de aire sobre
 *  ese techo y sigue matando el caso degenerado. Los otros cinco juegos ni se
 *  acercan (máximo medido: 3). */
export const MAX_ACTIONS_PER_TICK = 16;

/** Agrupa los inputs de un replay por tick (t), para re-simular aplicando las
 *  acciones de cada tick en orden (puede haber más de una por tick).
 *
 *  Las acciones que pasen de `MAX_ACTIONS_PER_TICK` en un mismo tick **se
 *  descartan**: no se aplican al motor. Un replay honesto nunca llega a ese
 *  tope, así que su puntaje no cambia; uno inflado pierde las acciones de más,
 *  el puntaje re-simulado no coincide con el declarado y el árbitro lo rechaza
 *  por "score mismatch". */
export function groupByTick<A>(inputs: { t: number; a: A }[]): Map<number, A[]> {
  const byTick = new Map<number, A[]>();
  for (const inp of inputs) {
    const arr = byTick.get(inp.t) ?? [];
    if (arr.length >= MAX_ACTIONS_PER_TICK) continue;
    arr.push(inp.a);
    byTick.set(inp.t, arr);
  }
  return byTick;
}
