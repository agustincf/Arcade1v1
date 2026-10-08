// Lectura de un resultado desde el lado de quien lo mira.

/** Quién no presentó su intento a tiempo (W2): `noShow` es esa dirección y
 *  `opponent`, la del rival de quien mira. Si no presentó el rival, ganaste;
 *  si no presentaste vos, ganó él. */
export function noShowSide(v: { opponent?: string; noShow?: string }): "rival" | "you" | null {
  if (!v.noShow) return null;
  return v.opponent && v.noShow.toLowerCase() === v.opponent.toLowerCase() ? "rival" : "you";
}

/** ¿`address` ya depositó en esta partida, según la cadena? Se mira la
 *  DIRECCIÓN, no el rol (pre-auditoría F4/F-07): desde W3 el p2 de una partida
 *  puede cambiar (el que no se unió a tiempo pierde el lugar), y `p2Paid`
 *  diría "pagado" por el depósito de otro. */
export function depositedBy(
  onchain: { p1: string; p2: string; p1Paid: boolean; p2Paid: boolean },
  address: string,
): boolean {
  const a = address.toLowerCase();
  return (
    (onchain.p1.toLowerCase() === a && onchain.p1Paid) ||
    (onchain.p2.toLowerCase() === a && onchain.p2Paid)
  );
}
