// Helpers compartidos por los tests del motor de La Bóveda.
// NOTA: Las funciones act, end, skipTalk, allDecide, assertConserved y el import
// de applyEvent vienen en la Tarea 3.

export const SEED = "0x" + "5eed".repeat(16);
export const A = (i: number) => "0x" + i.toString(16).padStart(40, "0");
export const seats = (n: number) => Array.from({ length: n }, (_, i) => A(i + 1));
/** Semillas variadas y reproducibles (64 hex). */
export const seedN = (i: number) =>
  "0x" +
  Array.from({ length: 64 }, (_, j) => ((i * 31 + j * 17 + i * j) % 16).toString(16)).join("");
