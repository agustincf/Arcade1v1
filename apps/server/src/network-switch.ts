// EL CAMBIO DE RED DEL 1v1 (testnet → mainnet) SIN PARTIDAS DE PLATA COLGADAS.
//
// Las partidas no guardan en qué red se jugaron, y el árbitro de mainnet usa el
// mismo Redis que el de testnet. Si se cambia `CHAIN_ID`/`ESCROW_ADDRESS` con
// mesas de plata todavía abiertas, esas partidas quedan en manos del árbitro
// nuevo: no existen en el contrato nuevo, así que no hay plata real en juego
// (no se puede emparejar con ellas ni liquidarlas ahí), pero el árbitro las
// reintenta con errores hasta que vencen (hasta ~3 h) y las cierra como "nadie
// depositó", y los depósitos de prueba quedan en el contrato viejo hasta que
// alguien pida el reembolso ahí.
//
// Lo que corresponde es vaciar la red vieja ANTES de cambiar (DEPLOY.md, "Pasar
// a DINERO REAL"): `/health` dice cuántas quedan abiertas (`paidOpen`). Esto es
// la red de seguridad por si ese paso se olvida: el árbitro anota en Redis la
// red con la que trabaja (cadena + contrato). Si arranca con otra y quedan
// partidas de plata sin cerrar, las mesas de plata siguen cerradas en la red
// nueva hasta que esas partidas terminen solas, `/health` lo dice
// (`escrow: "blocked"`, `networkSwitch`) y el log lista cuáles reembolsar a mano
// en la red vieja. Cuando no queda ninguna, anota la red nueva y abre.

export const NETWORK_KEY = "arcade:network1v1";

/** La red de trabajo como texto estable: cadena y contrato (minúsculas). */
export const networkTag = (chainId: number, escrow: string) => `${chainId}:${escrow.toLowerCase()}`;

export interface NetworkSwitchDeps {
  /** La red con la que arrancó este árbitro (`networkTag`). */
  current: string;
  read: (key: string) => Promise<string | null>;
  write: (key: string, value: string) => Promise<void>;
  /** Las partidas de plata que todavía no cerraron en la cadena. */
  openPaid: () => string[];
  log?: (msg: string) => void;
}

let pending: { from: string; to: string; open: number } | null = null;

/** El cambio de red en curso, si lo hay: mientras exista, las mesas de plata
 *  están cerradas (ver `paidTableClosed`, escrow-check.ts). */
export const networkSwitchPending = () => pending;

/** Compara la red anotada con la actual y decide. Se llama al arrancar (después
 *  de restaurar las partidas) y después en cada vuelta, hasta que el cambio se
 *  complete. Un error de Redis se propaga: al arrancar, aborta como cualquier
 *  otra restauración; en una vuelta, se reintenta en la siguiente. */
export async function reviewNetworkSwitch(d: NetworkSwitchDeps): Promise<void> {
  const log = d.log ?? console.log;
  const stored = await d.read(NETWORK_KEY);
  if (stored === d.current) {
    pending = null;
    return;
  }
  const open = d.openPaid();
  if (stored === null || open.length === 0) {
    await d.write(NETWORK_KEY, d.current);
    if (stored !== null)
      log(`[cambio-de-red] completo: de ${stored} a ${d.current}; las mesas de plata abren`);
    pending = null;
    return;
  }
  const first = !pending || pending.from !== stored || pending.open !== open.length;
  pending = { from: stored, to: d.current, open: open.length };
  if (first)
    log(
      `[cambio-de-red] el árbitro pasó de ${stored} a ${d.current} con ${open.length} ` +
        `partida(s) de plata de la red anterior sin cerrar: las mesas de plata siguen ` +
        `cerradas hasta que terminen solas (hasta ~3 h). Sus depósitos quedan en el ` +
        `contrato viejo: reembolsarlos ahí (refundUnfunded/refundExpired). ` +
        `Partidas: ${open.join(", ")}`,
    );
}

/** Para las pruebas: vuelve al estado inicial. */
export function resetNetworkSwitchForTest(): void {
  pending = null;
}
