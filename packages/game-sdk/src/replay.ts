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

/** Agrupa los inputs de un replay por tick (t), para re-simular aplicando las
 *  acciones de cada tick en orden (puede haber más de una por tick). */
export function groupByTick<A>(inputs: { t: number; a: A }[]): Map<number, A[]> {
  const byTick = new Map<number, A[]>();
  for (const inp of inputs) {
    const arr = byTick.get(inp.t) ?? [];
    arr.push(inp.a);
    byTick.set(inp.t, arr);
  }
  return byTick;
}
