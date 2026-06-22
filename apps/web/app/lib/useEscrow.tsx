"use client";

// Hook para el pago on-chain desde la web: aprobar + depositar USDC, y cobrar
// (settle) con la firma del arbitro. Se usa cuando onchainEnabled === true.
//
// NOTA: queda listo para enchufar a la UI cuando el contrato este desplegado en
// la red (Base Sepolia). Las mismas llamadas estan probadas en cadena local
// (ver packages/contracts/check-payment-e2e.sh).

import { useWriteContract, usePublicClient } from "wagmi";
import { maxUint256 } from "viem";
import {
  ESCROW_ADDRESS,
  USDC_ADDRESS,
  escrowAbi,
  erc20Abi,
  toUsdcUnits,
} from "@/app/lib/escrow";

export function useEscrow() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  /** Solo aprueba el allowance hacia el escrow (sin depositar). Se hace ANTES de
   *  emparejar: el árbitro verifica el allowance para no crear partidas sin fondos. */
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
    if (allowance >= amount) return; // ya estaba aprobado (una sola vez alcanza)
    // Aprobamos un monto amplio UNA sola vez: así no hay que re-aprobar en cada
    // partida (solo queda el depósito por jugar).
    const hash = await writeContractAsync({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [ESCROW_ADDRESS, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  /** Deposita la apuesta (el approve ya se hizo antes). Un solo paso. */
  async function deposit(matchId: `0x${string}`) {
    if (!ESCROW_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    const hash = await writeContractAsync({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "deposit",
      args: [matchId],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  /** Aprueba (si hace falta) y deposita la apuesta en el escrow. */
  async function approveAndDeposit(
    matchId: `0x${string}`,
    owner: `0x${string}`,
    betUsdc: number,
  ) {
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

    if (allowance < amount) {
      const approveHash = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [ESCROW_ADDRESS, amount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const depositHash = await writeContractAsync({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "deposit",
      args: [matchId],
    });
    await publicClient.waitForTransactionReceipt({ hash: depositHash });
  }

  /** El ganador cobra: envía la firma del árbitro al contrato. */
  async function claim(
    matchId: `0x${string}`,
    winner: `0x${string}`,
    signature: `0x${string}`,
  ) {
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

  return { approveStake, deposit, approveAndDeposit, claim };
}
