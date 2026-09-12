// LA CADENA de las mesas de plata, detrás de una interfaz. Todo lo que el
// árbitro de Aleph necesita del contrato entra por acá: leer una sala mientras
// fondea, leer la comisión al liquidar, cancelar y liquidar. Los tests inyectan
// una cadena falsa (`setAlephChainForTest`) y corren sin nodo; el e2e en anvil
// (aleph-onchain-e2e.ts) prueba la implementación real.
//
// Se activa con ALEPH_ESCROW_ADDRESS (contrato aparte del 1v1: ESCROW_ADDRESS).
// Reusa los clientes viem y la COLA de escrituras de onchain.ts: todas las
// transacciones del árbitro salen de la misma wallet y comparten el nonce.
import type { Hex } from "viem";
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
export function alephChainId(): number {
  return Number(process.env.CHAIN_ID ?? 84532);
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

function realAlephChain(): AlephChain {
  let usdc: Hex | undefined;
  // Toda escritura se SIMULA primero (un revert seguro no quema gas) y va por
  // la cola (nonce compartido). El reintento con backoff lo lleva aleph.ts, que
  // sabe si vale la pena volver a intentar.
  const write = (functionName: "cancelRoom" | "settle", args: readonly unknown[]) =>
    enCola(async () => {
      const { wallet: w, pub: p } = writeClients();
      const { request } = await p.simulateContract({
        address: ESCROW,
        abi: escrowAlephAbi,
        functionName,
        args: args as never,
        account: w.account!,
        chain: chain(),
      });
      const hash = await w.writeContract(request);
      await p.waitForTransactionReceipt({ hash });
      return hash;
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
