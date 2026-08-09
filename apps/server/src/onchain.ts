// Acciones on-chain del arbitro. En el modelo asincronico (open/join), cada
// jugador abre/se une depositando su propia apuesta, asi que el arbitro NO crea
// la partida ni paga gas: SOLO cancela en empate (reembolso). Se activa si
// ESCROW_ADDRESS esta configurado; si no, es no-op (dev).

import { createWalletClient, createPublicClient, http, type Hex, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, base, baseSepolia } from "viem/chains";
import { escrowAbi } from "./abi.js";

const RPC = process.env.RPC_URL || "http://localhost:8545";
const ESCROW = (process.env.ESCROW_ADDRESS || "") as Hex;
const ZERO = "0x0000000000000000000000000000000000000000";

export function onchainEnabled(): boolean {
  return !!ESCROW && ESCROW.toLowerCase() !== ZERO;
}

/** Red segun CHAIN_ID: 31337 anvil, 8453 Base mainnet, si no Base Sepolia. */
function chain(): Chain {
  const id = Number(process.env.CHAIN_ID ?? 84532);
  if (id === 31337) return foundry;
  if (id === 8453) return base;
  return baseSepolia;
}

let wallet: ReturnType<typeof createWalletClient> | null = null;
let pub: ReturnType<typeof createPublicClient> | null = null;

/** Cliente de solo LECTURA. Va aparte del de escritura a propósito: leer el
 *  estado de una partida no necesita la llave del árbitro, y acoplarlas hacía
 *  que un despliegue sin `ARBITER_PRIVATE_KEY` reventara también las lecturas. */
function readClient() {
  if (!pub) pub = createPublicClient({ chain: chain(), transport: http(RPC) });
  return pub;
}

function clients() {
  if (!wallet) {
    const account = privateKeyToAccount(process.env.ARBITER_PRIVATE_KEY as Hex);
    wallet = createWalletClient({ account, chain: chain(), transport: http(RPC) });
  }
  return { wallet: wallet!, pub: readClient() };
}

/** Estado on-chain de una partida, tal como lo devuelve el getter `matches`. */
export interface OnchainMatch {
  p1: string;
  p2: string;
  stake: bigint;
  /** 0 None · 1 Open · 2 Funded · 3 Settled · 4 Refunded */
  status: number;
}

export const ONCHAIN_STATUS = {
  None: 0,
  Open: 1,
  Funded: 2,
  Settled: 3,
  Refunded: 4,
} as const;

/** Lee el estado REAL de una partida en el escrow.
 *
 *  Hasta acá el árbitro NUNCA miraba la cadena: emparejaba, aceptaba puntajes y
 *  firmaba resultados sin saber si alguien había depositado. Un atacante podía
 *  encolar wallets recién generadas en las mesas de plata —solo cuesta una
 *  firma— y no depositar jamás, dejando trabada la plata de cada humano que sí
 *  depositó hasta que venciera el plazo. */
export async function readMatchOnchain(matchId: Hex): Promise<OnchainMatch | null> {
  if (!onchainEnabled()) return null;
  const p = readClient();
  const r = (await p.readContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "matches",
    args: [matchId],
  })) as readonly [string, string, bigint, boolean, boolean, bigint, bigint, number];
  return { p1: r[0], p2: r[1], stake: r[2], status: Number(r[7]) };
}

/** En empate/disputa: el arbitro cancela y el contrato reembolsa a ambos.
 *  Se SIMULA primero: si la partida no existe on-chain o no es cancelable
 *  (nadie depositó, ya liquidada/reembolsada), no se manda la transacción y no
 *  se quema gas del árbitro en un revert seguro. */
export async function cancelMatchOnchain(matchId: Hex) {
  if (!onchainEnabled()) return;
  const { wallet: w, pub: p } = clients();
  const { request } = await p.simulateContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "cancelMatch",
    args: [matchId],
    account: w.account!,
    chain: chain(),
  });
  const hash = await w.writeContract(request);
  await p.waitForTransactionReceipt({ hash });
}

/** ¿Esta dirección puede enviar puntaje en esta partida, según la cadena?
 *
 *  Función pura (recibe el estado ya leído) para poder testear la REGLA sin
 *  levantar un nodo. Devuelve el motivo del rechazo, o `null` si está todo bien.
 *
 *  La regla: figurar como p1 o p2 en el contrato equivale a haber depositado —
 *  solo se llega a serlo llamando `open`/`join`, y las dos transfieren la
 *  apuesta. NO se exige status `Funded` porque el modelo es asincrónico: el
 *  primero juega y envía su puntaje cuando todavía no hay rival y la partida
 *  está en `Open`. */
export function razonRechazoDeposito(
  enCadena: OnchainMatch | null,
  address: string,
): string | null {
  if (!enCadena || enCadena.status === ONCHAIN_STATUS.None) {
    return "no on-chain deposit found for this address in this match";
  }
  // La dirección cero NO cuenta: es el valor de un slot vacío (nadie se unió
  // todavía), no un depositante. Sin este filtro, alguien que enviara puntaje
  // como 0x000… pasaba la guarda mientras la partida estuviera a medio fondear.
  const depositantes = [enCadena.p1, enCadena.p2]
    .map((a) => (a ?? "").toLowerCase())
    .filter((a) => a && a !== ZERO);
  if (!depositantes.includes(address.toLowerCase())) {
    return "no on-chain deposit found for this address in this match";
  }
  if (enCadena.status === ONCHAIN_STATUS.Settled || enCadena.status === ONCHAIN_STATUS.Refunded) {
    return "this match is already settled or refunded on-chain";
  }
  return null;
}
