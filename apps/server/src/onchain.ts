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
export function chain(): Chain {
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
export function readClient() {
  if (!pub) pub = createPublicClient({ chain: chain(), transport: http(RPC) });
  return pub;
}

export function writeClients() {
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
  return readMatch(readClient(), matchId);
}

/** El getter `matches`, decodificado. Recibe el cliente para que la
 *  cancelación lea con el mismo nodo que le inyectan (ver `cancelMatchWithRetries`),
 *  y un bloque opcional: sin él, lee en `latest`. */
async function readMatch(
  p: Pick<ReturnType<typeof readClient>, "readContract">,
  matchId: Hex,
  blockNumber?: bigint,
): Promise<OnchainMatch> {
  const r = (await p.readContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "matches",
    args: [matchId],
    blockNumber,
  })) as readonly [string, string, bigint, boolean, boolean, bigint, bigint, number];
  return { p1: r[0], p2: r[1], stake: r[2], status: Number(r[7]) };
}

// COLA DE ESCRITURAS ON-CHAIN. Todas las transacciones del árbitro salen de
// esta misma wallet, así que comparten el nonce. El barrendero disparaba N
// `cancelMatchOnchain` EN PARALELO, en el mismo tick sincrónico: las N pedían el
// nonce pendiente antes de que se minara ninguna, así que TODAS salían con el
// mismo. Entraba una sola; el resto revertía en el RPC ("already known" /
// "replacement underpriced"), el error iba a un console.error que nadie mira y
// nadie reintentaba. Resultado concreto: cuando vencían varias mesas juntas, se
// reembolsaba una y los demás jugadores tenían que descubrir /recover por su
// cuenta para sacar su plata del contrato.
//
// Encadenar las escrituras (mismo patrón que usa persist.ts para las
// escrituras a disco) hace que cada una lea el nonce recién cuando la anterior
// ya se minó.
let colaEscrituras: Promise<unknown> = Promise.resolve();

export function enCola<T>(tarea: () => Promise<T>): Promise<T> {
  const siguiente = colaEscrituras.then(tarea, tarea);
  // La cola nunca se corta por un fallo: se absorbe acá para que la próxima
  // tarea igual arranque (el error se propaga al llamador por `siguiente`).
  colaEscrituras = siguiente.catch(() => {});
  return siguiente;
}

const REINTENTOS = 3;
const ESPERA_REINTENTO_MS = 2_000;

/** Lo que usa una cancelación de los clientes de viem. */
export interface CancelClients {
  pub: Pick<
    ReturnType<typeof readClient>,
    "simulateContract" | "waitForTransactionReceipt" | "readContract"
  >;
  wallet: Pick<ReturnType<typeof writeClients>["wallet"], "account" | "writeContract">;
}

/** Un cancelMatch que se MINÓ revertido. Va aparte de los demás fallos porque
 *  la transacción salió (y pagó gas): lo que haya pasado lo dice la cadena, no
 *  el mensaje. Lleva el bloque donde se minó, que es donde hay que mirar. */
class CancelMatchRevertedError extends Error {
  constructor(
    message: string,
    readonly blockNumber: bigint,
  ) {
    super(message);
  }
}

/** En empate/disputa: el arbitro cancela y el contrato reembolsa a ambos.
 *  Se SIMULA primero: si la partida no existe on-chain o no es cancelable
 *  (nadie depositó, ya liquidada/reembolsada), no se manda la transacción y no
 *  se quema gas del árbitro en un revert seguro.
 *
 *  Va por la cola y con reintento: es plata de jugadores que, si esta llamada
 *  se pierde en silencio, queda trabada en el contrato hasta que alguien
 *  descubra /recover. */
export async function cancelMatchOnchain(matchId: Hex) {
  if (!onchainEnabled()) return;
  return enCola(() => cancelMatchWithRetries(writeClients, matchId));
}

/** El cancel con su reintento. Recibe los clientes y la espera por parámetro
 *  para poder probarlo sin nodo (como `sendAlephWrite`); la cola la pone
 *  `cancelMatchOnchain`. */
export async function cancelMatchWithRetries(
  clients: () => CancelClients,
  matchId: Hex,
  esperaMs = ESPERA_REINTENTO_MS,
): Promise<void> {
  let ultimo: unknown;
  for (let intento = 1; intento <= REINTENTOS; intento++) {
    try {
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
      const receipt = await p.waitForTransactionReceipt({ hash });
      // Un revert MINADO no lanza: viem devuelve el recibo con status
      // "reverted". Sin este control, un cancel que pasó la simulación y
      // revirtió en el bloque (otra transacción cambió la partida mientras
      // viajaba) pasaba por reembolso hecho: sin log, sin reintento, y
      // `m.refundPromise` resolvía como si la plata hubiera vuelto. Es el
      // mismo control que `sendAlephWrite` y el depósito del SDK.
      if (receipt.status !== "success") {
        throw new CancelMatchRevertedError(
          `cancelMatch reverted on-chain (tx ${hash})`,
          receipt.blockNumber,
        );
      }
      return;
    } catch (e) {
      ultimo = e;
      const msg = (e as Error)?.message ?? "";
      if (e instanceof CancelMatchRevertedError) {
        // Tras un revert minado decide la CADENA: el mensaje dice "reverted"
        // y la regex de abajo cortaría siempre. Qué puede haber pasado
        // mientras viajaba, según Escrow1v1:
        //  - Otro CERRÓ la partida: un jugador con `refundUnfunded` o
        //    `refundExpired` desde /recover, el dueño con su `cancelMatch`, o
        //    un `settle`. Queda Refunded o Settled y no hay nada que cancelar:
        //    se corta, con el hash en el error para que quede en el log.
        //  - Sigue Open o Funded: revirtió por algo que no la cerró. Por
        //    ejemplo, el `join` del rival la pasó de Open a Funded y el cancel,
        //    con el gas estimado para devolver UN depósito, se quedó sin gas al
        //    devolver dos. La plata sigue adentro: se reintenta, y el intento
        //    siguiente vuelve a estimar.
        // Se lee en el BLOQUE donde se minó, no en `latest`: si el RPC reparte
        // los pedidos entre nodos, uno atrasado todavía la vería Funded y se
        // reintentaba de más. Lo que diga ese bloque es firme, porque Refunded y
        // Settled no tienen vuelta atrás. Si la lectura falla también se
        // reintenta: la simulación del intento siguiente dice si todavía se
        // puede cancelar.
        const status = await readMatch(clients().pub, matchId, e.blockNumber).then(
          (m) => m.status,
          () => undefined,
        );
        if (status === ONCHAIN_STATUS.Refunded || status === ONCHAIN_STATUS.Settled) {
          const closed = status === ONCHAIN_STATUS.Refunded ? "Refunded" : "Settled";
          throw new CancelMatchRevertedError(`${msg}: match already ${closed}`, e.blockNumber);
        }
      } else if (/not cancelable|already|not found|reverted/i.test(msg)) {
        // Si el contrato dice que ya no se puede cancelar (ya liquidada,
        // reembolsada o inexistente), reintentar no cambia nada.
        throw e;
      }
      if (intento < REINTENTOS) {
        await new Promise((r) => setTimeout(r, esperaMs * intento));
      }
    }
  }
  throw ultimo;
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
