// LAS MESAS 1v1 DE PLATA desde la wallet del agente: la revisión previa, la
// verificación del asiento y el depósito (approve + open o join). Sigue el
// patrón de `alephDeposit` (agent.ts) con los frenos del diseño
// (docs/superpowers/specs/2026-11-27-agentes-mesas-de-plata-1v1-design.md):
//  - el contrato y la red los fija el OPERADOR (`paid1v1`), nunca el árbitro:
//    la vista del 1v1 no trae ni dirección ni red;
//  - el monto sale del stake que pidió el agente, nunca de una cifra del árbitro;
//  - el permiso es EXACTO (un stake) y solo hacia el escrow fijado;
//  - el asiento se verifica con la firma EIP-712 contra `arbiter()` del contrato
//    fijado, antes de gastar nada;
//  - la idempotencia sale de leer la cadena, no de lo que diga el árbitro.
// El flujo completo (sentarse, pedir de nuevo, jugar) vive en agent.ts.
import {
  createPublicClient,
  createWalletClient,
  http,
  recoverTypedDataAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { isLiveMatch, LIVE_SINCE_RULES_V } from "@arcade1v1/game-sdk/live";
import { liveGameFor } from "@arcade1v1/game-sdk/live-games";
import { waitUntilSealed } from "@arcade1v1/game-sdk/chain";
import {
  CIRCLE_USDC_BASE,
  ESCROW1V1_STATUS,
  SEAT_TYPES,
  erc20MinimalAbi,
  escrow1v1Abi,
  escrow1v1MatchFeeAbi,
  seatDomain,
  stakeToUnits,
} from "@arcade1v1/game-sdk/escrow1v1";
import type { ArbiterClient, MatchView } from "./client";
import { chainFor } from "./chains";
import { DEFAULT_MAX_FEE_BPS, type Paid1v1Config } from "./paid1v1-config";
import type { TxLock } from "./tx-lock";

/** Lo más lejos que puede estar `fundDeadline` (el árbitro da 70 minutos). */
export const MAX_FUND_AHEAD_S = 75 * 60;
/** Lo más lejos que puede estar `playDeadline` (el árbitro da 2 horas). Frena a
 *  un árbitro mentiroso que quiera trabar la plata hasta los 2 días que permite
 *  el contrato. */
export const MAX_PLAY_AHEAD_S = 6 * 3600;
/** Lo mínimo que tiene que faltar, en hora de la cadena, para `fundDeadline`
 *  antes de un `join`. */
export const CHAIN_MARGIN_S = 60;
/** Gas que se presupuesta para el approve y para el depósito al revisar el ETH
 *  (lo medido en el e2e de anvil, con margen). */
export const APPROVE_GAS = 70_000n;
export const DEPOSIT_GAS = 250_000n;

export type Paid1v1Stage = "check" | "seat" | "deposit" | "play";

/** Un error de una mesa de plata, con en qué paso pasó y si la plata ya entró.
 *  Con `deposited: true` el agente TIENE que jugar la partida (`resume1v1`):
 *  una partida con depósito que no se juega la gana el rival por no presentarse. */
export class Paid1v1Error extends Error {
  readonly stage: Paid1v1Stage;
  readonly matchId?: string;
  readonly deposited: boolean;
  constructor(
    message: string,
    opts: { stage: Paid1v1Stage; matchId?: string; deposited?: boolean; cause?: unknown },
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "Paid1v1Error";
    this.stage = opts.stage;
    this.matchId = opts.matchId;
    this.deposited = opts.deposited ?? false;
  }
}

export interface Paid1v1Deposit {
  /** `open` (abrió la partida), `join` (se unió) o `already` (ya figuraba). */
  step: "open" | "join" | "already";
  role: "p1" | "p2";
  txHash?: Hex;
  approveTx?: Hex;
  /** Si al pedir de nuevo el árbitro lo sentó en otra partida: la primera. */
  reseatedFrom?: string;
}

/** Lo que dejó la revisión previa, para no volver a leerlo. */
export interface Preflight {
  units: bigint;
  usdc: Hex;
  arbiter: Hex;
  chainId: number;
  /** ¿El árbitro publicó `rules` en /health? Si no, la versión de reglas se
   *  revisa después de emparejar, antes de depositar. */
  rulesChecked: boolean;
}

/** El mensaje corto de un error de viem: el largo repite la URL del RPC, que
 *  puede llevar una API key. */
function short(e: unknown): string {
  const x = e as { shortMessage?: string; message?: string } | undefined;
  return x?.shortMessage ?? x?.message ?? String(e);
}

const lc = (a: string) => a.toLowerCase();
const ZERO = "0x" + "0".repeat(40);

export function createPaid1v1(d: {
  cfg: Paid1v1Config;
  privateKey: Hex;
  client: ArbiterClient;
  clock: () => number;
  txLock: TxLock;
}) {
  const { cfg, client, clock, txLock } = d;
  const account = privateKeyToAccount(d.privateKey);
  const me = lc(account.address);
  const chain = chainFor(cfg.chainId);
  const pub = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const w = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  const escrow = cfg.escrow;
  const maxFee = cfg.maxFeeBps ?? DEFAULT_MAX_FEE_BPS;

  async function readMatch(matchId: string) {
    const [p1, p2, stake, , , fundDeadline, playDeadline, status] = await pub.readContract({
      address: escrow,
      abi: escrow1v1Abi,
      functionName: "matches",
      args: [matchId as Hex],
    });
    return { p1: lc(p1), p2: lc(p2), stake, fundDeadline, playDeadline, status };
  }

  /** El rol de esta wallet si su depósito está en la cadena. */
  async function depositedRole(matchId: string): Promise<"p1" | "p2" | null> {
    const m = await readMatch(matchId);
    if (
      m.p1 === me &&
      (m.status === ESCROW1V1_STATUS.Open || m.status === ESCROW1V1_STATUS.Funded)
    ) {
      return "p1";
    }
    if (m.p2 === me && m.status === ESCROW1V1_STATUS.Funded) return "p2";
    return null;
  }

  async function preflight(game: string, stake: number): Promise<Preflight> {
    const fail = (msg: string, cause?: unknown): never => {
      throw new Paid1v1Error(`${msg} — not taking a seat`, { stage: "check", cause });
    };
    if (!(stake > 0) || stake > cfg.maxStake) {
      fail(`a ${stake} USDC table exceeds paid1v1.maxStake (${cfg.maxStake} USDC)`);
    }
    if (!isLiveMatch(game, RULES_V[game]) || !liveGameFor(game)) {
      const live = Object.keys(LIVE_SINCE_RULES_V).filter((g) => isLiveMatch(g, RULES_V[g]));
      fail(
        `paid tables for agents are live games only for now: ${game} is not played live ` +
          `(live: ${live.join(", ")})`,
      );
    }
    const units = stakeToUnits(stake);

    let health;
    try {
      health = await client.health();
    } catch (e) {
      return fail(`could not read the arbiter's /health: ${short(e)}`, e);
    }
    if (health.escrow !== "ok") {
      fail(`this arbiter's paid tables are not open (escrow: ${health.escrow ?? "off"})`);
    }
    const rulesChecked = health.rules !== undefined;
    if (rulesChecked && health.rules![game] !== RULES_V[game]) {
      fail(
        `rules version mismatch for ${game}: arbiter v${health.rules![game]}, SDK v${RULES_V[game]} ` +
          `— update @arcade1v1 packages`,
      );
    }

    try {
      const rpcChain = await pub.getChainId();
      if (rpcChain !== cfg.chainId) {
        fail(`paid1v1.rpcUrl is on chain ${rpcChain}, not paid1v1.chainId ${cfg.chainId}`);
      }
      const code = await pub.getCode({ address: escrow });
      if (!code || code === "0x")
        fail(`there is no contract at paid1v1.escrow on chain ${cfg.chainId}`);
      const [onchainArbiter, usdc, feeBps, allowed, apiArbiter] = await Promise.all([
        pub.readContract({ address: escrow, abi: escrow1v1Abi, functionName: "arbiter" }),
        pub.readContract({ address: escrow, abi: escrow1v1Abi, functionName: "usdc" }),
        pub.readContract({ address: escrow, abi: escrow1v1Abi, functionName: "feeBps" }),
        pub.readContract({
          address: escrow,
          abi: escrow1v1Abi,
          functionName: "allowedStake",
          args: [units],
        }),
        client.arbiterAddress(),
      ]);
      if (lc(onchainArbiter) !== lc(apiArbiter)) {
        fail("the escrow's arbiter() is not the address this arbiter signs with (GET /arbiter)");
      }
      if (cfg.chainId === 8453 && lc(usdc) !== lc(CIRCLE_USDC_BASE)) {
        fail("the escrow's usdc() is not Circle's USDC on Base");
      }
      if (feeBps > maxFee) {
        fail(`the escrow's fee (${feeBps} bps) is above paid1v1.maxFeeBps (${maxFee} bps)`);
      }
      if (!allowed) fail(`the escrow does not allow a ${stake} USDC table`);
      const balance = await pub.readContract({
        address: usdc,
        abi: erc20MinimalAbi,
        functionName: "balanceOf",
        args: [account.address],
      });
      if (balance < units) fail(`insufficient USDC: have ${balance}, need ${units} (micro-USDC)`);
      const eth = await pub.getBalance({ address: account.address });
      const { maxFeePerGas } = await pub.estimateFeesPerGas();
      const need = ((APPROVE_GAS + DEPOSIT_GAS) * (maxFeePerGas ?? 0n) * 3n) / 2n;
      if (eth < need) fail(`insufficient ETH for gas: have ${eth}, need about ${need} (wei)`);
      return { units, usdc, arbiter: onchainArbiter, chainId: cfg.chainId, rulesChecked };
    } catch (e) {
      if (e instanceof Paid1v1Error) throw e;
      return fail(`could not read the chain: ${short(e)}`, e);
    }
  }

  async function verifySeat(view: MatchView, stake: number, pre: Preflight): Promise<void> {
    const fail = (msg: string, cause?: unknown): never => {
      throw new Paid1v1Error(`${msg} — not depositing`, {
        stage: "seat",
        matchId: view.matchId,
        cause,
      });
    };
    if (view.stake !== stake) {
      fail(
        `the arbiter seated this agent at a ${view.stake} USDC table, not the ${stake} it asked for`,
      );
    }
    if (view.role !== "p1" && view.role !== "p2") fail("this agent has no seat in that match");
    if (!view.seatSig || view.fundDeadline === undefined || view.playDeadline === undefined) {
      fail("the arbiter sent no seat or no terms: this is not a money table");
    }
    if (view.live !== true) fail(`match ${view.matchId} is not played live`);
    const localV = RULES_V[view.game];
    if (view.rulesV !== undefined && view.rulesV !== localV) {
      fail(
        `rules version mismatch for ${view.game}: arbiter v${view.rulesV}, SDK v${localV} ` +
          `— update @arcade1v1 packages`,
      );
    }
    const fd = view.fundDeadline!;
    const pd = view.playDeadline!;
    const nowS = Math.floor(clock() / 1000);
    if (
      !(fd > nowS) ||
      fd - nowS > MAX_FUND_AHEAD_S ||
      !(pd > fd) ||
      pd - nowS > MAX_PLAY_AHEAD_S
    ) {
      fail("the seat's deadlines are not sane (fund within 75 min, play within 6 h)");
    }
    let signer: string;
    try {
      signer = await recoverTypedDataAddress({
        domain: seatDomain(cfg.chainId, escrow),
        types: SEAT_TYPES,
        primaryType: "Seat",
        message: {
          matchId: view.matchId as Hex,
          player: me as Hex,
          stake: pre.units,
          fundDeadline: BigInt(fd),
          playDeadline: BigInt(pd),
        },
        signature: view.seatSig as Hex,
      });
    } catch (e) {
      return fail("the seat signature is malformed", e);
    }
    if (lc(signer) !== lc(pre.arbiter)) {
      fail("the seat is not signed by the arbiter of paid1v1.escrow on paid1v1.chainId");
    }

    try {
      const m = await readMatch(view.matchId);
      if (view.role === "p1") {
        if (m.status !== ESCROW1V1_STATUS.None && m.p1 !== me) {
          fail("that match was already opened on-chain by someone else");
        }
        return;
      }
      if (m.p2 === me && m.status === ESCROW1V1_STATUS.Funded) return; // ya se unió
      if (m.status !== ESCROW1V1_STATUS.Open) fail("that match is not open on-chain");
      if (m.stake !== pre.units) fail("the match on-chain has another stake");
      if (m.p1 === me || m.p1 === ZERO) fail("this agent cannot join its own match");
      if (m.fundDeadline !== BigInt(fd) || m.playDeadline !== BigInt(pd)) {
        fail("the match on-chain has other deadlines than the seat");
      }
      const block = await pub.getBlock();
      if (Number(block.timestamp) + CHAIN_MARGIN_S > fd) {
        fail("too little time left (chain time) to join before fundDeadline");
      }
      let fee: number;
      try {
        const r = await pub.readContract({
          address: escrow,
          abi: escrow1v1MatchFeeAbi,
          functionName: "matches",
          args: [view.matchId as Hex],
        });
        fee = r[8];
      } catch {
        // Un contrato anterior a la revisión no tiene la comisión congelada.
        fee = await pub.readContract({
          address: escrow,
          abi: escrow1v1Abi,
          functionName: "feeBps",
        });
      }
      if (fee > maxFee)
        fail(`the match fee (${fee} bps) is above paid1v1.maxFeeBps (${maxFee} bps)`);
    } catch (e) {
      if (e instanceof Paid1v1Error) throw e;
      return fail(`could not read the match on-chain: ${short(e)}`, e);
    }
  }

  /** Manda una transacción con el candado de la wallet: simular (un revert
   *  seguro no quema gas y trae el motivo), estimar con margen, esperar el
   *  recibo Y el sellado (Base da recibos preconfirmados), y exigir `success`
   *  (un revert minado no lanza). */
  function send(
    address: Hex,
    abi: typeof escrow1v1Abi | typeof erc20MinimalAbi,
    functionName: string,
    args: readonly unknown[],
  ): Promise<Hex> {
    return txLock(async () => {
      const params = { address, abi, functionName, args, account } as never;
      const { request } = await pub.simulateContract(params);
      const gas = await pub.estimateContractGas(params);
      const hash = await w.writeContract({
        ...(request as object),
        gas: (gas * 5n) / 4n,
      } as never);
      const receipt = await pub.waitForTransactionReceipt({ hash });
      await waitUntilSealed(pub, receipt.blockNumber);
      if (receipt.status !== "success") {
        throw new Error(`${functionName} reverted on-chain (tx ${hash})`);
      }
      return hash;
    });
  }

  async function approveIfNeeded(pre: Preflight): Promise<Hex | undefined> {
    const allowance = await pub.readContract({
      address: pre.usdc,
      abi: erc20MinimalAbi,
      functionName: "allowance",
      args: [account.address, escrow],
    });
    if (allowance >= pre.units) return undefined;
    try {
      // EXACTAMENTE el stake, nunca un permiso infinito, y al escrow fijado, que
      // solo puede tomarlo dentro de open/join con el asiento de ESTA wallet. Si
      // el depósito falla, el permiso queda y el próximo intento lo reusa.
      return await send(pre.usdc, erc20MinimalAbi, "approve", [escrow, pre.units]);
    } catch (e) {
      throw new Paid1v1Error(`USDC approve failed: ${short(e)} — not depositing`, {
        stage: "deposit",
        cause: e,
      });
    }
  }

  async function deposit(view: MatchView, pre: Preflight): Promise<Paid1v1Deposit> {
    const role = view.role as "p1" | "p2";
    const already = async () => (await depositedRole(view.matchId).catch(() => null)) === role;
    if (await already()) return { step: "already", role };
    const fn = role === "p1" ? "open" : "join";
    const args =
      role === "p1"
        ? [
            view.matchId,
            pre.units,
            BigInt(view.fundDeadline!),
            BigInt(view.playDeadline!),
            view.seatSig,
          ]
        : [view.matchId, view.seatSig];
    let txHash: Hex;
    try {
      txHash = await send(escrow, escrow1v1Abi, fn, args);
    } catch (e) {
      // Se confirma con la cadena, no se adivina: si el depósito está, quedó
      // hecho (un recibo que se perdió, una carrera con uno mismo).
      if (await already()) return { step: "already", role };
      let why = short(e);
      if (role === "p2") {
        const m = await readMatch(view.matchId).catch(() => null);
        if (m && m.status === ESCROW1V1_STATUS.Funded && m.p2 !== me) {
          why = "another player joined this match first";
        }
      }
      throw new Paid1v1Error(`${fn} failed: ${why}`, {
        stage: "deposit",
        matchId: view.matchId,
        deposited: false,
        cause: e,
      });
    }
    if (!(await already())) {
      throw new Paid1v1Error(
        `${fn} was mined (tx ${txHash}) but the deposit is not visible on-chain yet — call resume1v1(matchId)`,
        { stage: "deposit", matchId: view.matchId, deposited: true },
      );
    }
    return { step: fn, role, txHash };
  }

  return { preflight, verifySeat, approveIfNeeded, deposit, depositedRole, pub, w, account };
}
