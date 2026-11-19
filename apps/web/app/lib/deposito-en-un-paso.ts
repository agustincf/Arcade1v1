// Depositar en UNA confirmación de la wallet.
//
// Entrar a una mesa de plata eran dos pedidos seguidos: aprobar el USDC y
// después abrir (o unirse a) la partida. Conectado con el QR de MetaMask, el
// segundo pedido quedaba trabado en el celular (la app vuelve a segundo plano
// después del primero) y la mesa se colgaba en "Entrando a la partida…".
//
// Las wallets que lo soportan (MetaMask con cuenta inteligente, EIP-7702, y
// otras) aceptan un LOTE ATÓMICO por EIP-5792 (`wallet_sendCalls`): las dos
// llamadas en un solo pedido, que entran juntas o no entra ninguna. Acá viven
// las dos piezas puras: si la wallet declara que sabe hacerlo, y qué llamadas
// lleva el lote. Las que no lo soportan siguen con los dos pasos de siempre.

import { encodeFunctionData } from "viem";
import { escrowAbi, erc20Abi, toUsdcUnits } from "./escrow";

/** ¿La wallet sabe ejecutar un lote atómico en `chainId`? Lee lo que devuelve
 *  `wallet_getCapabilities`, ya sea para una red (viem con `chainId`) o
 *  agrupado por red (clave decimal o hexa). Entiende la forma de EIP-5792 v2
 *  (`atomic.status`: "supported", o "ready" si la cuenta pasa a inteligente
 *  en el mismo pedido) y la vieja (`atomicBatch.supported`). Ante la duda, no:
 *  los dos pasos siempre funcionan. */
export function canBatchAtomically(capabilities: unknown, chainId: number): boolean {
  if (!capabilities || typeof capabilities !== "object") return false;
  const caps = capabilities as Record<string, unknown>;
  const byChain = caps[String(chainId)] ?? caps[`0x${chainId.toString(16)}`];
  const own = byChain && typeof byChain === "object" ? (byChain as Record<string, unknown>) : caps;
  const atomic = own.atomic as { status?: unknown } | undefined;
  if (atomic && typeof atomic === "object") {
    return atomic.status === "supported" || atomic.status === "ready";
  }
  const legacy = own.atomicBatch as { supported?: unknown } | undefined;
  return !!legacy && typeof legacy === "object" && legacy.supported === true;
}

export interface FundCallsInput {
  usdc: `0x${string}`;
  escrow: `0x${string}`;
  betUsdc: number;
  /** Falta aprobar: el allowance de la wallet hacia el escrow no alcanza. */
  needApprove: boolean;
  role: "p1" | "p2";
  matchId: `0x${string}`;
  seatSig: `0x${string}`;
  /** Los plazos que ata el asiento: los necesita el que ABRE. */
  terms?: { fundDeadline: number; playDeadline: number };
}

/** Las llamadas del lote, en orden: aprobar el monto EXACTO de la apuesta (si
 *  hace falta; nunca un approve infinito) y depositar: `open` el que abre,
 *  `join` el que se une. Mismos argumentos que los pasos sueltos de
 *  `useEscrow`. */
export function fundCalls(input: FundCallsInput): { to: `0x${string}`; data: `0x${string}` }[] {
  const amount = toUsdcUnits(input.betUsdc);
  const calls: { to: `0x${string}`; data: `0x${string}` }[] = [];
  if (input.needApprove) {
    calls.push({
      to: input.usdc,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [input.escrow, amount],
      }),
    });
  }
  if (input.role === "p2") {
    calls.push({
      to: input.escrow,
      data: encodeFunctionData({
        abi: escrowAbi,
        functionName: "join",
        args: [input.matchId, input.seatSig],
      }),
    });
  } else {
    if (!input.terms) throw new Error("faltan los plazos del asiento para abrir la partida");
    calls.push({
      to: input.escrow,
      data: encodeFunctionData({
        abi: escrowAbi,
        functionName: "open",
        args: [
          input.matchId,
          amount,
          BigInt(input.terms.fundDeadline),
          BigInt(input.terms.playDeadline),
          input.seatSig,
        ],
      }),
    });
  }
  return calls;
}
