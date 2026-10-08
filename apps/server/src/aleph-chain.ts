// LA CADENA de las mesas de plata, detrás de una interfaz. Todo lo que el
// árbitro de Aleph necesita del contrato entra por acá: leer una sala mientras
// fondea, leer la comisión al liquidar, cancelar y liquidar. Los tests inyectan
// una cadena falsa (`setAlephChainForTest`) y corren sin nodo; el e2e en anvil
// (aleph-onchain-e2e.ts) prueba la implementación real.
//
// Se activa con ALEPH_ESCROW_ADDRESS (contrato aparte del 1v1: ESCROW_ADDRESS).
// Su red puede ser OTRA que la del 1v1 (ALEPH_CHAIN_ID y ALEPH_RPC_URL; si
// faltan, las del 1v1): mainnet arranca solo con el 1v1 y las mesas de plata de
// Aleph siguen en testnet (decisión 6 de docs/MAINNET.md). Misma wallet del
// árbitro en las dos redes, y la misma COLA de escrituras de onchain.ts: con
// una red sola comparten el nonce, y con dos solo se ordenan de a una.
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { escrowAlephAbi } from "@arcade1v1/game-sdk/aleph";
import { chainFor, readClient, writeClients, enCola } from "./onchain.js";
import { alephChainIdFromEnv, chainIdFromEnv, envValue } from "./env.js";

const ESCROW = envValue("ALEPH_ESCROW_ADDRESS") as Hex;

/** ¿Aleph va en su propia red? Si no, usa los clientes del 1v1 (los mismos de
 *  siempre). */
const ownNetwork = () => alephChainIdFromEnv() !== chainIdFromEnv();

let alephPub: ReturnType<typeof readClient> | null = null;
let alephWallet: ReturnType<typeof writeClients>["wallet"] | null = null;

/** El cliente de lectura de la red de Aleph. */
function alephReadClient(): ReturnType<typeof readClient> {
  if (!ownNetwork()) return readClient();
  alephPub ??= createPublicClient({
    chain: chainFor(alephChainIdFromEnv()),
    transport: http(envValue("ALEPH_RPC_URL") || envValue("RPC_URL") || "http://localhost:8545"),
  }) as ReturnType<typeof readClient>;
  return alephPub;
}

/** Los clientes de escritura de la red de Aleph (la llave del árbitro). */
function alephWriteClients(): ReturnType<typeof writeClients> {
  if (!ownNetwork()) return writeClients();
  alephWallet ??= createWalletClient({
    account: privateKeyToAccount(envValue("ARBITER_PRIVATE_KEY") as Hex),
    chain: chainFor(alephChainIdFromEnv()),
    transport: http(envValue("ALEPH_RPC_URL") || envValue("RPC_URL") || "http://localhost:8545"),
  });
  return { wallet: alephWallet!, pub: alephReadClient() };
}
const ZERO = "0x0000000000000000000000000000000000000000";

export function alephOnchainEnabled(): boolean {
  return !!ESCROW && ESCROW.toLowerCase() !== ZERO;
}
export function alephEscrowAddress(): Hex {
  return ESCROW;
}
/** La cadena de las mesas de plata. Misma convención que el resto de las
 *  perillas (`envNum`): un valor mal formado cae al DEFAULT, nunca a `NaN`.
 *  Importa porque este número SALE del árbitro — viaja en `AlephDeposit.chainId`
 *  y en `alephLog().usdc.chainId`, y el SDK del agente lo usa para elegir la red
 *  del depósito: con `NaN` ahí, el agente no sabe a qué cadena mandar la plata. */
export function alephChainId(): number {
  return alephChainIdFromEnv();
}

export interface AlephOnchainRoom {
  /** `EscrowAleph.Status` (ALEPH_ESCROW_STATUS). */
  status: number;
  paidCount: number;
  /** Asientos que ya depositaron, en minúsculas. */
  depositors: string[];
}

export interface AlephChain {
  readRoom(roomId: Hex): Promise<AlephOnchainRoom>;
  feeBps(): Promise<number>;
  usdcAddress(): Promise<Hex>;
  /** Cancela (reembolsa a los que depositaron). Devuelve el hash. */
  cancelRoom(roomId: Hex): Promise<Hex>;
  /** Presenta la tabla firmada, con su vencimiento (segundos). Devuelve el hash. */
  settle(
    roomId: Hex,
    seats: Hex[],
    amounts: bigint[],
    deadline: bigint,
    signature: Hex,
  ): Promise<Hex>;
}

let impl: AlephChain | undefined;

export function alephChain(): AlephChain {
  return (impl ??= realAlephChain());
}

/** Tests: inyectar una cadena falsa (o `undefined` para volver a la real). */
export function setAlephChainForTest(c: AlephChain | undefined): void {
  impl = c;
}

/** Una escritura del árbitro que se MINÓ revertida. Va aparte de los demás
 *  fallos porque dice algo que ellos no: la transacción salió, y lo más
 *  probable es que la sala haya cambiado mientras viajaba. Quien la reciba
 *  tiene que preguntarle a la cadena qué pasó, no deducirlo del mensaje. */
export class AlephTxRevertedError extends Error {}

/** UNA escritura del árbitro contra el escrow: se SIMULA primero (un revert
 *  seguro no quema gas), se manda y se espera el recibo. Recibe los clientes
 *  por parámetro para poder probarla sin nodo; la cola la pone quien llama. */
export async function sendAlephWrite(
  pub: Pick<ReturnType<typeof readClient>, "simulateContract" | "waitForTransactionReceipt">,
  wallet: Pick<ReturnType<typeof writeClients>["wallet"], "account" | "writeContract">,
  functionName: "cancelRoom" | "settle",
  args: readonly unknown[],
): Promise<Hex> {
  const call = {
    address: ESCROW,
    abi: escrowAlephAbi,
    functionName,
    args: args as never,
    account: wallet.account!,
    chain: chainFor(alephChainIdFromEnv()),
  };
  const { request } = await pub.simulateContract(call);
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  // Un revert MINADO no lanza: viem devuelve el recibo con status "reverted" y
  // el hash parece un éxito. Pasa cuando otra transacción cambia la sala entre
  // la simulación y el bloque (`settle` y los reembolsos son permissionless).
  // Sin este control el árbitro guardaba ese hash como pago o reembolso hecho
  // y la web lo linkeaba. Es el mismo control que ya hace el depósito del SDK.
  if (receipt.status !== "success") {
    // El recibo no trae el motivo. Re-simular la misma llamada sobre el bloque
    // donde se minó lo reproduce, porque ese bloque ya tiene aplicada la
    // transacción que se metió antes. Es solo para el registro: si la
    // re-simulación pasa (un revert por gas) o falla por otra cosa (el RPC),
    // el error sale sin motivo.
    let reason = "";
    try {
      await pub.simulateContract({ ...call, blockNumber: receipt.blockNumber });
    } catch (e) {
      const revert =
        e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
      if (revert instanceof ContractFunctionRevertedError && revert.reason) {
        reason = `: ${revert.reason}`;
      }
    }
    throw new AlephTxRevertedError(`aleph ${functionName} reverted on-chain (tx ${hash})${reason}`);
  }
  return hash;
}

function realAlephChain(): AlephChain {
  let usdc: Hex | undefined;
  // Toda escritura va por la cola (nonce compartido). El reintento con backoff
  // lo lleva aleph.ts, que sabe si vale la pena volver a intentar.
  const write = (functionName: "cancelRoom" | "settle", args: readonly unknown[]) =>
    enCola(() => {
      const { wallet, pub } = alephWriteClients();
      return sendAlephWrite(pub, wallet, functionName, args);
    });

  return {
    async readRoom(roomId) {
      const p = alephReadClient();
      const [r, dep] = await Promise.all([
        p.readContract({
          address: ESCROW,
          abi: escrowAlephAbi,
          functionName: "roomOf",
          args: [roomId],
        }),
        p.readContract({
          address: ESCROW,
          abi: escrowAlephAbi,
          functionName: "depositors",
          args: [roomId],
        }),
      ]);
      return {
        status: Number(r[5]),
        paidCount: Number(r[2]),
        depositors: (dep as readonly string[]).map((a) => a.toLowerCase()),
      };
    },
    async feeBps() {
      return Number(
        await alephReadClient().readContract({
          address: ESCROW,
          abi: escrowAlephAbi,
          functionName: "feeBps",
        }),
      );
    },
    async usdcAddress() {
      usdc ??= (await alephReadClient().readContract({
        address: ESCROW,
        abi: escrowAlephAbi,
        functionName: "usdc",
      })) as Hex;
      return usdc;
    },
    cancelRoom: (roomId) => write("cancelRoom", [roomId]),
    settle: (roomId, seats, amounts, deadline, signature) =>
      write("settle", [roomId, seats, amounts, deadline, signature]),
  };
}
