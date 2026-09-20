// Ayudas de los tests de Aleph. El azar es DECORATIVO y con semilla fija: los
// números no bailan entre corridas. Nada de esto toca al azar del juego, que
// sale de SHA-256 del secreto (reglas v2) y vive en el game-sdk.

/** PRNG barato con semilla explícita. Solo para fabricar fixtures. */
export function azarDePrueba(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` direcciones hex válidas, siempre las mismas para la misma semilla. */
export function direcciones(n: number, semilla: number): string[] {
  const azar = azarDePrueba(semilla);
  const salida: string[] = [];
  for (let i = 0; i < n; i++) {
    let hex = "0x";
    for (let j = 0; j < 40; j++) hex += "0123456789abcdef"[Math.floor(azar() * 16)];
    salida.push(hex);
  }
  return salida;
}
