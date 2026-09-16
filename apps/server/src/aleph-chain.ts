// LA CADENA de las mesas de plata, detrás de una interfaz. Todo lo que el
// árbitro de Aleph necesita del contrato entra por acá: leer una sala mientras
// fondea, leer la comisión al liquidar, cancelar y liquidar. Los tests inyectan
// una cadena falsa (`setAlephChainForTest`) y corren sin nodo; el e2e en anvil
// (aleph-onchain-e2e.ts) prueba la implementación real.
//
// Se activa con ALEPH_ESCROW_ADDRESS (contrato aparte del 1v1: ESCROW_ADDRESS).
// Reusa los clientes viem y la COLA de escrituras de onchain.ts: todas las
// transacciones del árbitro salen de la misma wallet y comparten el nonce.
import { BaseError, ContractFunctionRevertedError, type Hex } from "viem";
import { escrowAlephAbi } from "@arcade1v1/game-sdk/aleph";
import { chain, readClient, writeClients, enCola } from "./onchain.js";

const ESCROW = (process.env.ALEPH_ESCROW_ADDRESS || "") as Hex;
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
  const n = Number(process.env.CHAIN_ID);
  return Number.isFinite(n) && n > 0 ? n : 84532;
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
  /** Presenta la tabla firmada. Devuelve el hash. */
  settle(roomId: Hex, seats: Hex[], amounts: bigint[], signature: Hex): Promise<Hex>;
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
    chain: chain(),
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
      const { wallet, pub } = writeClients();
      return sendAlephWrite(pub, wallet, functionName, args);
    });

  return {
    async readRoom(roomId) {
      const p = readClient();
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
        await readClient().readContract({
          address: ESCROW,
          abi: escrowAlephAbi,
          functionName: "feeBps",
        }),
      );
    },
    async usdcAddress() {
      usdc ??= (await readClient().readContract({
        address: ESCROW,
        abi: escrowAlephAbi,
        functionName: "usdc",
      })) as Hex;
      return usdc;
    },
    cancelRoom: (roomId) => write("cancelRoom", [roomId]),
    settle: (roomId, seats, amounts, signature) =>
      write("settle", [roomId, seats, amounts, signature]),
  };
}
