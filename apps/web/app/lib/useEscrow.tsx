"use client";

// Hook para el pago on-chain desde la web: aprobar + depositar USDC, y cobrar
// (settle) con la firma del arbitro. Se usa cuando onchainEnabled === true.
//
// NOTA: queda listo para enchufar a la UI cuando el contrato este desplegado en
// la red (Base Sepolia). Las mismas llamadas estan probadas en cadena local
// (ver packages/contracts/check-payment-e2e.sh).

import { useWriteContract, usePublicClient } from "wagmi";
import {
  ESCROW_ADDRESS,
  USDC_ADDRESS,
  escrowAbi,
  erc20Abi,
  toUsdcUnits,
  MatchStatus,
} from "@/app/lib/escrow";

export function useEscrow() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  /** Aprueba el allowance hacia el escrow (sin depositar), por el monto EXACTO
   *  de la apuesta. Nada de approve infinito: si el contrato tuviera un bug,
   *  lo máximo expuesto es la apuesta de esta partida, nunca toda la wallet. */
  async function approveStake(owner: `0x${string}`, betUsdc: number) {
    if (!ESCROW_ADDRESS || !USDC_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    const amount = toUsdcUnits(betUsdc);
    const allowance = (await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, ESCROW_ADDRESS],
    })) as bigint;
    if (allowance >= amount) return; // ya alcanza para esta apuesta
    const hash = await writeContractAsync({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [ESCROW_ADDRESS, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  /** Acuña USDC de PRUEBA para la wallet (faucet integrado, solo testnet). El
   *  TestUSDC.sol tiene mint abierto: no cuesta nada salvo el gas. La página
   *  /faucet se bloquea en mainnet, así que esto nunca corre con dinero real. */
  async function mintTestUsdc(to: `0x${string}`, amountUsdc: number) {
    if (!USDC_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    const hash = await writeContractAsync({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "mint",
      args: [to, toUsdcUnits(amountUsdc)],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  /** Lee el saldo de USDC de una wallet (en unidades del token, 6 decimales).
   *  Se divide por 1_000_000 para mostrarlo como monto legible. */
  async function readUsdcBalance(owner: `0x${string}`): Promise<bigint> {
    if (!USDC_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    return (await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    })) as bigint;
  }

  /** P1 ABRE la partida depositando su apuesta (modelo asincronico: el 1ro abre,
   *  el 2do se une; nadie espera colgado). El approve ya se hizo antes. */
  async function open(matchId: `0x${string}`, betUsdc: number) {
    if (!ESCROW_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    const now = BigInt(Math.floor(Date.now() / 1000));
    const hash = await writeContractAsync({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "open",
      args: [matchId, toUsdcUnits(betUsdc), now + 3600n, now + 7200n],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  /** P2 se UNE depositando su apuesta (la partida ya fue abierta por P1).
   *  ANTES de depositar verifica la partida REAL on-chain: que esté abierta,
   *  que el monto sea el esperado y que los plazos sean los normales. Sin este
   *  chequeo, un rival malicioso podía abrirla por su cuenta con un plazo de
   *  juego lejano (años) y dejar el depósito de P2 atrapado hasta entonces. */
  async function join(matchId: `0x${string}`, betUsdc: number) {
    if (!ESCROW_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    const m = await readMatch(matchId);
    const nowSec = Math.floor(Date.now() / 1000);
    if (m.status !== MatchStatus.Open) throw new Error("la partida no está abierta");
    if (m.stake !== toUsdcUnits(betUsdc)) throw new Error("el monto no coincide con la mesa");
    // La web abre con fundDeadline = +1h y playDeadline = +2h; toleramos un
    // margen chico. Cualquier plazo mayor es sospechoso: no depositamos.
    if (m.fundDeadline > nowSec + 3900 || m.playDeadline > nowSec + 7500) {
      throw new Error("plazos anormales: no es seguro unirse");
    }
    const hash = await writeContractAsync({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "join",
      args: [matchId],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  /** El ganador cobra: envía la firma del árbitro al contrato. */
  async function claim(matchId: `0x${string}`, winner: `0x${string}`, signature: `0x${string}`) {
    if (!ESCROW_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    const hash = await writeContractAsync({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "settle",
      args: [matchId, winner, signature],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  /** Reembolso: partida abierta que nadie llenó a tiempo (recupera lo depositado). */
  async function refundUnfunded(matchId: `0x${string}`) {
    if (!ESCROW_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    const hash = await writeContractAsync({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "refundUnfunded",
      args: [matchId],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  /** Reembolso: partida llena pero sin resultado al vencer el plazo de juego. */
  async function refundExpired(matchId: `0x${string}`) {
    if (!ESCROW_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    const hash = await writeContractAsync({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "refundExpired",
      args: [matchId],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  /** Lee el estado on-chain de una partida (status + plazos) para la recuperación. */
  async function readMatch(matchId: `0x${string}`) {
    if (!ESCROW_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    const m = (await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "matches",
      args: [matchId],
    })) as readonly [
      `0x${string}`,
      `0x${string}`,
      bigint,
      boolean,
      boolean,
      bigint,
      bigint,
      number,
    ];
    return {
      p1: m[0],
      p2: m[1],
      stake: m[2],
      p1Paid: m[3],
      p2Paid: m[4],
      fundDeadline: Number(m[5]),
      playDeadline: Number(m[6]),
      status: m[7],
    };
  }

  return {
    approveStake,
    mintTestUsdc,
    readUsdcBalance,
    open,
    join,
    claim,
    refundUnfunded,
    refundExpired,
    readMatch,
  };
}
