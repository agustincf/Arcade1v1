// El árbitro comprueba contra la cadena que el escrow del 1v1 es el que cree
// (pre-auditoría INT-2 y F13): la red, que haya un contrato en la dirección, su
// propio rol (`arbiter()`), la comisión (`feeBps()`) y las mesas
// (`allowedStake`). Hasta acá todo eso se copiaba a mano en la config y nadie
// lo cruzaba: con la red o el rol equivocados el árbitro emparejaba, la gente
// depositaba y después ninguna firma suya servía para pagar.
//
// Lo que no coincide cierra las MESAS PAGAS, no el servidor: la ladder gratis no
// toca la cadena y sigue andando. Y se vuelve a mirar solo (el reloj
// "escrow-check" de index.ts), así un arreglo on-chain —rotar el árbitro con
// `setArbiter`, habilitar una mesa— las reabre sin reiniciar. Por la misma razón
// no corta el arranque: rotar la llave obliga a un rato en que la llave nueva ya
// corre y el contrato todavía apunta a la vieja.

import type { Hex } from "viem";
import { escrowAbi } from "./abi.js";
import { readClient } from "./onchain.js";

/** Lo que el árbitro cree (su config). */
export interface EscrowExpect {
  chainId: number;
  escrow: string;
  arbiter: string;
  feeBps: number;
  /** Mesas pagas que ofrece (`STAKES_ALLOWED`), en USDC enteros. */
  stakes: number[];
}

/** Lo que dice la cadena. */
export interface EscrowFacts {
  chainId: number;
  hasCode: boolean;
  arbiter: string;
  feeBps: number;
  /** De las mesas de `EscrowExpect.stakes`, las que el contrato permite. */
  allowedStakes: number[];
}

export type EscrowReader = (e: EscrowExpect) => Promise<EscrowFacts>;

export type EscrowGate =
  | { status: "unverified"; reason: string }
  | { status: "blocked"; reasons: string[] }
  | { status: "ok"; closedStakes: number[] };

/** Compara config y cadena. `blocking` cierra todas las mesas pagas;
 *  `closedStakes` solo esas (el dueño puede frenar una mesa con
 *  `setAllowedStake(x, false)` sin tocar la config del árbitro). */
export function compareEscrow(
  e: EscrowExpect,
  f: EscrowFacts,
): { blocking: string[]; closedStakes: number[] } {
  const blocking: string[] = [];
  if (f.chainId !== e.chainId) {
    blocking.push(`the RPC is on chain ${f.chainId}, the arbiter signs for chain ${e.chainId}`);
  } else if (!f.hasCode) {
    blocking.push(`no contract at the escrow address ${e.escrow}`);
  } else {
    if (f.arbiter.toLowerCase() !== e.arbiter.toLowerCase()) {
      blocking.push(`the escrow's arbiter is ${f.arbiter.toLowerCase()}, not this arbiter`);
    }
    if (f.feeBps !== e.feeBps) {
      blocking.push(`the escrow's fee is ${f.feeBps} bps, the arbiter's FEE_BPS is ${e.feeBps}`);
    }
  }
  const closedStakes = blocking.length ? [] : e.stakes.filter((s) => !f.allowedStakes.includes(s));
  return { blocking, closedStakes };
}

const stakeUnits = (stake: number) => BigInt(Math.round(stake * 1_000_000));

/** Lee los hechos del contrato. Sin código en la dirección no pregunta nada
 *  más: un `eth_call` a una dirección vacía no revierte, devuelve ceros. */
export const readEscrowFacts: EscrowReader = async (e) => {
  const pub = readClient();
  const address = e.escrow as Hex;
  const [chainId, code] = await Promise.all([pub.getChainId(), pub.getCode({ address })]);
  if (chainId !== e.chainId || !code || code === "0x") {
    return { chainId, hasCode: !!code && code !== "0x", arbiter: "", feeBps: 0, allowedStakes: [] };
  }
  const [arbiter, feeBps, allowed] = await Promise.all([
    pub.readContract({ address, abi: escrowAbi, functionName: "arbiter" }),
    pub.readContract({ address, abi: escrowAbi, functionName: "feeBps" }),
    Promise.all(
      e.stakes.map((s) =>
        pub.readContract({
          address,
          abi: escrowAbi,
          functionName: "allowedStake",
          args: [stakeUnits(s)],
        }),
      ),
    ),
  ]);
  return {
    chainId,
    hasCode: true,
    arbiter,
    feeBps: Number(feeBps),
    allowedStakes: e.stakes.filter((_, i) => allowed[i]),
  };
};

let gate: EscrowGate = { status: "unverified", reason: "not checked yet" };

export const escrowGate = (): EscrowGate => gate;

/** Lee la cadena y actualiza el veredicto. Si no la pudo leer y ya había uno,
 *  lo conserva: red, contrato y rol no cambian en un minuto, y un parpadeo del
 *  RPC no tiene por qué cerrar y reabrir las mesas. */
export async function verifyEscrow(
  e: EscrowExpect,
  read: EscrowReader = readEscrowFacts,
): Promise<EscrowGate> {
  let facts: EscrowFacts;
  try {
    facts = await read(e);
  } catch (err) {
    if (gate.status === "unverified") {
      gate = {
        status: "unverified",
        reason: `could not read the escrow contract (${(err as Error)?.message ?? err})`,
      };
    }
    return gate;
  }
  const { blocking, closedStakes } = compareEscrow(e, facts);
  gate = blocking.length
    ? { status: "blocked", reasons: blocking }
    : { status: "ok", closedStakes };
  return gate;
}

/** Motivo por el que una mesa paga no se puede abrir ahora, o null si se
 *  puede. El texto lleva "disabled" a propósito: el árbitro contesta 400 con él
 *  (ERRORES_ESPERABLES en index.ts) y la web lo muestra tal cual. */
export function paidTableClosed(stake: number): string | null {
  if (gate.status === "unverified") {
    return `paid tables disabled: ${gate.reason}; try again in a minute`;
  }
  if (gate.status === "blocked") {
    return `paid tables disabled: the escrow contract does not match this arbiter (${gate.reasons.join("; ")})`;
  }
  if (gate.closedStakes.includes(stake)) {
    return `paid table disabled: stake ${stake} is not allowed by the escrow contract`;
  }
  return null;
}

/** El veredicto en una línea, para el log. */
export function describeEscrowGate(g: EscrowGate = gate): string {
  if (g.status === "unverified") return `escrow sin verificar: ${g.reason}`;
  if (g.status === "blocked")
    return `escrow NO coincide, mesas pagas cerradas: ${g.reasons.join("; ")}`;
  return g.closedStakes.length
    ? `escrow ok; mesas que el contrato no permite (cerradas): ${g.closedStakes.join(", ")}`
    : "escrow ok";
}

let timer: NodeJS.Timeout | undefined;
let running: Promise<unknown> | undefined;
let stopped = true;

/** El reloj "escrow-check": verifica ya y después cada `everyMs`, una vuelta por
 *  vez (nunca dos lecturas solapadas), y solo escribe en el log cuando el
 *  veredicto cambia. */
export function startEscrowCheck(
  expect: () => EscrowExpect,
  opts: { everyMs?: number; read?: EscrowReader; log?: (m: string) => void } = {},
): void {
  if (!stopped) return;
  stopped = false;
  const { everyMs = 60_000, read = readEscrowFacts, log = console.log } = opts;
  let last: string | undefined;
  const round = async () => {
    running = verifyEscrow(expect(), read);
    await running;
    running = undefined;
    const now = describeEscrowGate();
    if (now !== last) log(`[escrow-check] ${now}`);
    last = now;
    if (!stopped) {
      timer = setTimeout(round, everyMs);
      timer.unref?.(); // no mantener vivo un proceso que ya terminó (tests, scripts)
    }
  };
  void round();
}

export async function stopEscrowCheck(): Promise<void> {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = undefined;
  await running;
}
