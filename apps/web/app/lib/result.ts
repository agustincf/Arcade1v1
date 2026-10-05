// Lectura de un resultado desde el lado de quien lo mira.

/** Quién no presentó su intento a tiempo (W2): `noShow` es esa dirección y
 *  `opponent`, la del rival de quien mira. Si no presentó el rival, ganaste;
 *  si no presentaste vos, ganó él. */
export function noShowSide(v: { opponent?: string; noShow?: string }): "rival" | "you" | null {
  if (!v.noShow) return null;
  return v.opponent && v.noShow.toLowerCase() === v.opponent.toLowerCase() ? "rival" : "you";
}
