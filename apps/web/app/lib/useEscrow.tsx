"use client";

// Hook para el pago on-chain desde la web: aprobar + depositar USDC, cobrar
// (settle) con la firma del arbitro si el árbitro no lo hizo todavía, y retirar
// lo acreditado. Se usa cuando onchainEnabled === true.
//
// NOTA: queda listo para enchufar a la UI cuando el contrato este desplegado en
// la red (Base Sepolia). Las mismas llamadas estan probadas en cadena local
// (ver packages/contracts/check-payment-e2e.sh).

import { useWriteContract, usePublicClient } from "wagmi";
import { parseEventLogs } from "viem";
import {
  ESCROW_ADDRESS,
  USDC_ADDRESS,
  escrowAbi,
  erc20Abi,
  toUsdcUnits,
  MatchStatus,
} from "@/app/lib/escrow";
// Cada transacción se da por hecha recién con su bloque sellado, no con el
// recibo preconfirmado de Base (ver confirm-tx.ts).
import { confirmTx } from "@/app/lib/confirm-tx";

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
    await confirmTx(publicClient, hash);
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
    await confirmTx(publicClient, hash);
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
   *  el 2do se une; nadie espera colgado). El approve ya se hizo antes.
   *  `seatSig` es la firma del árbitro que autoriza a esta wallet en esta
   *  partida, y `terms` los plazos que esa firma ata (los dos vienen en la
   *  respuesta de matchmake). Desde la v2 los plazos los fija el árbitro: con
   *  otros, el contrato rechaza el asiento ("bad seat"). */
  async function open(
    matchId: `0x${string}`,
    betUsdc: number,
    seatSig: `0x${string}`,
    terms: { fundDeadline: number; playDeadline: number },
  ) {
    if (!ESCROW_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    const hash = await writeContractAsync({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "open",
      args: [
        matchId,
        toUsdcUnits(betUsdc),
        BigInt(terms.fundDeadline),
        BigInt(terms.playDeadline),
        seatSig,
      ],
    });
    await confirmTx(publicClient, hash);
  }

  /** P2 se UNE depositando su apuesta (la partida ya fue abierta por P1).
   *  ANTES de depositar verifica la partida REAL on-chain: que esté abierta,
   *  con el monto esperado y todavía dentro del plazo para unirse. Los plazos
   *  ya no se revisan a mano: antes un rival podía abrir con un plazo de juego
   *  lejano (años) y dejar el depósito de P2 atrapado, y la web lo frenaba con
   *  una heurística. Desde la v2 el contrato verifica el asiento de P2 contra
   *  los plazos que quedaron guardados, que son los que firmó el árbitro. */
  async function join(matchId: `0x${string}`, betUsdc: number, seatSig: `0x${string}`) {
    if (!ESCROW_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    const m = await readMatch(matchId);
    const nowSec = Math.floor(Date.now() / 1000);
    if (m.status !== MatchStatus.Open) throw new Error("la partida no está abierta");
    if (m.stake !== toUsdcUnits(betUsdc)) throw new Error("el monto no coincide con la mesa");
    if (nowSec > m.fundDeadline) throw new Error("venció el plazo para unirse");
    const hash = await writeContractAsync({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "join",
      args: [matchId, seatSig],
    });
    await confirmTx(publicClient, hash);
  }

  /** El ganador cobra con la firma del árbitro. Es el RESPALDO: desde la v2 el
   *  árbitro liquida solo apenas decide. Por eso mira la cadena antes y
   *  después: si la partida ya está pagada (el árbitro se adelantó, o la
   *  transacción se minó y falló solo la espera del recibo), el premio ya
   *  salió y no hay nada que mandar. `deadline` es hasta cuándo vale la firma
   *  (segundos), tal como la publica el árbitro. */
  async function claim(
    matchId: `0x${string}`,
    winner: `0x${string}`,
    deadline: number,
    signature: `0x${string}`,
  ): Promise<"paid" | "already"> {
    if (!ESCROW_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    if ((await readMatch(matchId)).status === MatchStatus.Settled) return "already";
    try {
      const hash = await writeContractAsync({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: "settle",
        args: [matchId, winner, BigInt(deadline), signature],
      });
      await confirmTx(publicClient, hash);
      return "paid";
    } catch (e) {
      const after = await readMatch(matchId).catch(() => null);
      if (after?.status === MatchStatus.Settled) return "already";
      throw e;
    }
  }

  /** Lo ACREDITADO a `owner` en el contrato (unidades del token): pagos o
   *  reembolsos que el USDC rechazó al enviarlos. */
  async function readOwed(owner: `0x${string}`): Promise<bigint> {
    if (!ESCROW_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    return (await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "owed",
      args: [owner],
    })) as bigint;
  }

  /** ¿La liquidación `txHash` le ACREDITÓ el pago a `account` en vez de
   *  mandárselo (el USDC lo rechazó)? Se lee del recibo de ESA transacción, así
   *  un crédito viejo de otra partida no confunde. Sin hash (la pagó otro con
   *  la misma firma), mira si hay algo acreditado. */
  async function creditedIn(
    txHash: `0x${string}` | null,
    account: `0x${string}`,
  ): Promise<boolean> {
    if (!ESCROW_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    if (!txHash) return (await readOwed(account)) > 0n;
    const escrowAddr = ESCROW_ADDRESS.toLowerCase();
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    return parseEventLogs({ abi: escrowAbi, eventName: "Credited", logs: receipt.logs }).some(
      (l) =>
        l.address.toLowerCase() === escrowAddr &&
        l.args.account.toLowerCase() === account.toLowerCase(),
    );
  }

  /** Retira todo lo acreditado a la wallet conectada. */
  async function withdraw() {
    if (!ESCROW_ADDRESS || !publicClient) {
      throw new Error("on-chain no configurado");
    }
    const hash = await writeContractAsync({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "withdraw",
      args: [],
    });
    await confirmTx(publicClient, hash);
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
    await confirmTx(publicClient, hash);
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
    await confirmTx(publicClient, hash);
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
    readOwed,
    creditedIn,
    withdraw,
    refundUnfunded,
    refundExpired,
    readMatch,
  };
}
