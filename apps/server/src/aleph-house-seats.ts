// REGISTRO de los asientos de la casa en Aleph: sus wallets, su nombre visible
// y su temperamento. Vive en un módulo propio, sin importar `aleph.ts`, porque
// `profiles.ts` necesita saber si un address es de la casa para poner el chip
// CASA — y si el registro viviera junto al runner, ese import cerraría un ciclo
// (profiles → aleph-house → aleph → matchmaking → …).
//
// POR QUÉ EXISTE: una mesa de Aleph necesita 4 asientos dentro de la misma
// ventana de 10 minutos o el lobby se disuelve. Sin nadie que complete, el
// primer agente curioso que llega espera solo, no ve nada y se va. Estos
// asientos son el relleno que hace que la mesa arranque.
//
// NO son agentes hosteados: `createHostedAgent` exige un juego del registro de
// cartuchos y el `agent-runner` empareja a los hosteados en la ladder 1v1.
// Aleph no es un cartucho, así que sus asientos son propios.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { jsonStore } from "./persist.js";

/** Cómo juega cada asiento. Un temperamento fijo por asiento, en vez de azar
 *  en cada decisión: así la mesa tiene personajes reconocibles y un agente de
 *  verdad puede leerlos y aprovecharlos, que es de lo que trata el formato. */
export type Temperament = "cooperative" | "greedy" | "erratic";

export interface HouseSeat {
  address: string; // minúsculas, como todo lo que guarda el árbitro
  privateKey: Hex;
  name: string;
  avatar: string;
  temperament: Temperament;
}

/** Nombres de "El Aleph" de Borges, de donde sale el nombre del formato. El
 *  chip CASA es lo que marca que son nuestros; el nombre es solo sabor. */
const ROSTER: { name: string; avatar: string; temperament: Temperament }[] = [
  { name: "Asterión", avatar: "🤖", temperament: "cooperative" },
  { name: "Funes", avatar: "👾", temperament: "greedy" },
  { name: "Tlön", avatar: "🛸", temperament: "erratic" },
  { name: "Zahir", avatar: "🐍", temperament: "cooperative" },
  { name: "Ireneo", avatar: "🤖", temperament: "greedy" },
  { name: "Uqbar", avatar: "👾", temperament: "erratic" },
];

/** Cuántos asientos tiene la casa. Cada asiento solo puede estar en UNA sala
 *  viva a la vez (lo exige el motor), así que este número decide cuántas mesas
 *  puede sostener la casa en paralelo: con 6 y un mínimo de 4, dos mesas. */
const POOL_SIZE = Math.max(0, Math.min(ROSTER.length, Number(process.env.ALEPH_HOUSE_SEATS ?? 6)));

const store$ = jsonStore("aleph-house");

let seats: HouseSeat[] = [];
let index = new Set<string>();

function reindex(): void {
  index = new Set(seats.map((s) => s.address));
}

/** Genera los asientos que falten para llegar al tamaño del pool. Las claves se
 *  generan una sola vez y se guardan: los addresses tienen que ser estables
 *  entre reinicios o la casa perdería su ELO y su historial en cada deploy.
 *
 *  Son claves de juguete a propósito: la mesa es GRATIS y estos asientos nunca
 *  tocan un contrato. La etapa 4 (mesas de plata) NO puede reusarlas tal cual —
 *  ahí una clave del servidor custodia dinero y eso pide otra conversación. */
function ensurePool(): boolean {
  if (seats.length >= POOL_SIZE) return false;
  for (let i = seats.length; i < POOL_SIZE; i++) {
    const privateKey = generatePrivateKey();
    seats.push({
      address: privateKeyToAccount(privateKey).address.toLowerCase(),
      privateKey,
      ...ROSTER[i],
    });
  }
  reindex();
  return true;
}

/** Los asientos de la casa, creándolos la primera vez. */
export function houseSeats(): HouseSeat[] {
  if (ensurePool()) store$.save(() => JSON.stringify(seats));
  return seats;
}

/** ¿Este address es un asiento de la casa? Lo consulta `resolveDisplay` para
 *  poner el chip CASA, igual que con los agentes hosteados de la casa. */
export function isAlephHouseAddress(address: string): boolean {
  if (index.size === 0) houseSeats();
  return index.has(String(address).toLowerCase());
}

/** Ficha pública de un asiento de la casa (sin la clave, obviamente). */
export function houseSeatDisplay(
  address: string,
): { name: string; avatar: string; house: true } | undefined {
  if (index.size === 0) houseSeats();
  const s = seats.find((x) => x.address === String(address).toLowerCase());
  return s ? { name: s.name, avatar: s.avatar, house: true } : undefined;
}

/** Restaura los asientos guardados. La llama index.ts ANTES de escuchar. */
export async function restoreAlephHouse(): Promise<void> {
  const raw = await store$.load();
  if (raw) {
    try {
      const arr = JSON.parse(raw) as HouseSeat[];
      if (Array.isArray(arr)) {
        seats = arr.filter((s) => s?.address && s?.privateKey);
        reindex();
      }
    } catch (e) {
      console.error("[aleph-house] registro corrupto, se regenera:", (e as Error).message);
    }
  }
  houseSeats(); // completa el pool si falta alguno (o si subieron la perilla)
}

/** Tests: vaciar el registro en memoria (no toca el store). */
export function __resetHouseSeatsForTest(): void {
  seats = [];
  index = new Set();
}
