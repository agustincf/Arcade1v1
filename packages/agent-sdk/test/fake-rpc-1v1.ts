// packages/agent-sdk/test/fake-rpc-1v1.ts
// Un RPC de mentira con un Escrow1v1 y un USDC adentro, para probar qué LEE,
// FIRMA y TRANSMITE la wallet de un agente en una mesa 1v1 de plata. A
// diferencia de fake-rpc.ts (el de Aleph, que comparte el MCP y no se toca),
// este MINA: cada transacción cambia el estado (el permiso de un approve, la
// partida que abre un open, el p2 de un join), y lo que cambió se ve en
// `latest` recién cuando el bloque se sella (`sealMs` después), como en el RPC
// público de Base. Las simulaciones revierten como el contrato.
// `calls` anota cada método (los eth_call con su función: `eth_call:matches`)
// y `broadcasts` lo que llegó a eth_sendRawTransaction, ya decodificado.
// No es un *.test.ts: `npm test` no lo corre.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  keccak256,
  parseAbi,
  parseTransaction,
  recoverTransactionAddress,
  type Hex,
} from "viem";
import { escrow1v1Abi, escrow1v1MatchFeeAbi, erc20MinimalAbi } from "@arcade1v1/game-sdk/escrow1v1";

export interface Broadcast {
  to?: string;
  functionName: string;
  args: readonly unknown[];
}

/** Una partida en la cadena (el `matches(id)` del contrato). */
export interface ChainMatch {
  p1: Hex;
  p2: Hex;
  stake: bigint;
  fundDeadline: bigint;
  playDeadline: bigint;
  status: number; // ESCROW1V1_STATUS
  frozenFeeBps?: number;
}

export interface Fake1v1State {
  escrow: Hex;
  usdc: Hex;
  arbiter: Hex;
  usdcBalance?: bigint;
  /** ETH de la wallet, en wei (default: mucho). */
  ethBalance?: bigint;
  allowance?: bigint;
  feeBps?: number;
  /** Mesas permitidas, en micro-USDC (default: 1, 2, 5 y 10 USDC). */
  allowed?: bigint[];
  /** ¿Hay código en el escrow? (default: sí). */
  code?: boolean;
  matches?: Record<string, ChainMatch>;
  /** Hora de la cadena, en segundos (default: la del reloj). */
  blockTimestamp?: number;
  owed?: bigint;
  /** Contrato anterior a la revisión: `matches` sin la novena salida. */
  noFeeField?: boolean;
  /** Cuánto tarda en sellarse un bloque (ms). 0 = al instante. */
  sealMs?: number;
  /** La próxima transacción de esta función se mina REVERTIDA. */
  minedRevert?: "open" | "join" | "approve";
  /** Al mandar un `join`, se une antes otro p2 (esta dirección) en el mismo
   *  bloque: el de la wallet se mina revertido. */
  rivalJoinsFirst?: Hex;
  /** Después del approve, la wallet se queda sin ETH: la estimación de gas del
   *  depósito falla con "insufficient funds". */
  ethForGas?: "approveOnly";
  /** El RPC falla al pedir recibos (un 429 que no cede): la transacción ya se
   *  transmitió, pero la wallet no puede confirmarla. */
  receiptFails?: boolean;
  /** La próxima transacción se transmite pero NO se mina (queda colgada). */
  dropNext?: boolean;
}

export interface FakeRpc1v1 {
  url: string;
  calls: string[];
  broadcasts: Broadcast[];
  /** El estado de arranque: se puede tocar entre llamadas (devolverle el ETH). */
  state: Fake1v1State;
  close: () => void;
}

const ABI = [...escrow1v1Abi, ...erc20MinimalAbi];
const REVERTS = parseAbi([
  "error Error(string message)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);
const ZERO = ("0x" + "0".repeat(40)) as Hex;
const hex = (n: number | bigint) => "0x" + n.toString(16);
const lc = (a: string) => a.toLowerCase();
const BASE_BLOCK = 16;

interface Mined {
  hash: Hex;
  from: Hex;
  to?: string;
  functionName: string;
  args: readonly unknown[];
  status: "success" | "reverted";
  block: number;
  sealAt: number;
  /** La mandó otra wallet (el rival de `rivalJoinsFirst`): no toca el saldo ni
   *  el permiso de la wallet del agente. */
  foreign?: boolean;
}

export async function fakeRpc1v1(chainIdHex: string, state: Fake1v1State): Promise<FakeRpc1v1> {
  const calls: string[] = [];
  const broadcasts: Broadcast[] = [];
  const mined: Mined[] = [];
  const sealed = (m: Mined) => Date.now() >= m.sealAt;
  const visible = (tag: unknown) =>
    mined.filter((m) => m.status === "success" && (tag === "pending" || sealed(m)));
  const latestBlock = () => Math.max(BASE_BLOCK, ...mined.filter(sealed).map((m) => m.block));
  const nextBlock = () => Math.max(BASE_BLOCK, ...mined.map((m) => m.block)) + 1;
  const now = () => state.blockTimestamp ?? Math.floor(Date.now() / 1000);
  const allowed = () => state.allowed ?? [1_000_000n, 2_000_000n, 5_000_000n, 10_000_000n];

  /** El estado que se ve en un bloque: el de arranque más lo minado visible. */
  function view(tag: unknown) {
    let allowance = state.allowance ?? 0n;
    let balance = state.usdcBalance ?? 0n;
    let owed = state.owed ?? 0n;
    let approved = false;
    const matches: Record<string, ChainMatch> = {};
    for (const [k, v] of Object.entries(state.matches ?? {})) matches[lc(k)] = { ...v };
    for (const m of visible(tag)) {
      if (m.functionName === "approve") {
        allowance = m.args[1] as bigint;
        approved = true;
      } else if (m.functionName === "open") {
        const [id, stake, fd, pd] = m.args as [Hex, bigint, bigint, bigint];
        matches[lc(id)] = {
          p1: m.from,
          p2: ZERO,
          stake,
          fundDeadline: fd,
          playDeadline: pd,
          status: 1,
          frozenFeeBps: state.feeBps ?? 1500,
        };
        allowance -= stake;
        balance -= stake;
      } else if (m.functionName === "join") {
        const id = lc(m.args[0] as Hex);
        const x = matches[id];
        matches[id] = { ...x, p2: m.from, status: 2 };
        if (!m.foreign) {
          allowance -= x.stake;
          balance -= x.stake;
        }
      } else if (m.functionName === "withdraw") {
        balance += owed;
        owed = 0n;
      } else if (m.functionName === "mint") {
        balance += m.args[1] as bigint;
      }
    }
    return { allowance, balance, owed, matches, approved };
  }

  /** Por qué revertiría `fn` desde `from` en el bloque `tag`, o null. */
  function revertReason(fn: string, args: readonly unknown[], from: Hex, tag: unknown) {
    const v = view(tag);
    if (fn === "open") {
      const [id, stake] = args as [Hex, bigint];
      if (v.matches[lc(id)] && v.matches[lc(id)].status !== 0) return "match exists";
      if (!allowed().includes(stake)) return "stake not allowed";
      if (v.allowance < stake) return { allowance: v.allowance, needed: stake };
      return null;
    }
    if (fn === "join") {
      const x = v.matches[lc(args[0] as Hex)];
      if (!x || x.status !== 1) return "not open";
      if (now() > Number(x.fundDeadline)) return "fund expired";
      if (lc(x.p1) === lc(from)) return "same player";
      if (v.allowance < x.stake) return { allowance: v.allowance, needed: x.stake };
      return null;
    }
    if (fn === "withdraw") return v.owed > 0n ? null : "nothing owed";
    return null;
  }

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const msg = JSON.parse(body) as { id: number; method: string; params?: unknown[] };
      const reply = (o: object) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...o }));
      };
      const ok = (result: unknown) => reply({ result });
      const fail = (message: string) => reply({ error: { code: -32000, message } });
      const revert = (r: string | { allowance: bigint; needed: bigint }) =>
        reply({
          error: {
            code: 3,
            message: "execution reverted",
            data:
              typeof r === "string"
                ? encodeErrorResult({ abi: REVERTS, errorName: "Error", args: [r] })
                : encodeErrorResult({
                    abi: REVERTS,
                    errorName: "ERC20InsufficientAllowance",
                    args: [state.escrow, r.allowance, r.needed],
                  }),
          },
        });
      calls.push(msg.method);
      try {
        switch (msg.method) {
          case "eth_chainId":
            return ok(chainIdHex);
          case "eth_getCode":
            return ok(
              lc(String(msg.params![0])) === lc(state.escrow) && state.code !== false
                ? "0x6080"
                : "0x",
            );
          case "eth_getBalance": {
            const drained = state.ethForGas === "approveOnly" && view("pending").approved;
            return ok(hex(drained ? 0n : (state.ethBalance ?? 10n ** 18n)));
          }
          case "eth_call": {
            const [{ data, from }, tag] = msg.params as [{ data: Hex; from?: Hex }, unknown];
            const { functionName, args = [] } = decodeFunctionData({ abi: ABI, data });
            calls[calls.length - 1] = `eth_call:${functionName}`;
            const v = view(tag);
            const enc = (result: unknown) =>
              ok(encodeFunctionResult({ abi: ABI, functionName, result } as never));
            switch (functionName) {
              case "arbiter":
                return enc(state.arbiter);
              case "usdc":
                return enc(state.usdc);
              case "feeBps":
                return enc(state.feeBps ?? 1500);
              case "allowedStake":
                return enc(allowed().includes(args[0] as bigint));
              case "owed":
                return enc(v.owed);
              case "balanceOf":
                return enc(v.balance);
              case "allowance":
                return enc(v.allowance);
              case "matches": {
                const x = v.matches[lc(args[0] as Hex)];
                const eight = x
                  ? [
                      x.p1,
                      x.p2,
                      x.stake,
                      x.status >= 1,
                      x.status === 2 || x.p2 !== ZERO,
                      x.fundDeadline,
                      x.playDeadline,
                      x.status,
                    ]
                  : [ZERO, ZERO, 0n, false, false, 0n, 0n, 0];
                if (state.noFeeField) return enc(eight);
                return ok(
                  encodeFunctionResult({
                    abi: escrow1v1MatchFeeAbi,
                    functionName: "matches",
                    result: [...eight, x?.frozenFeeBps ?? 0] as never,
                  }),
                );
              }
              case "approve":
              case "mint":
                return enc(functionName === "approve" ? true : undefined);
              case "open":
              case "join":
              case "withdraw": {
                const why = revertReason(functionName, args, (from ?? ZERO) as Hex, tag);
                return why ? revert(why) : ok("0x");
              }
            }
            return fail(`fake rpc 1v1: unhandled eth_call ${functionName}`);
          }
          case "eth_estimateGas": {
            const [{ data, from }] = msg.params as [{ data: Hex; from?: Hex }];
            const { functionName, args = [] } = decodeFunctionData({ abi: ABI, data });
            const isDeposit = functionName === "open" || functionName === "join";
            if (isDeposit && state.ethForGas === "approveOnly" && view("pending").approved) {
              return fail("insufficient funds for gas * price + value");
            }
            const why = revertReason(functionName, args, (from ?? ZERO) as Hex, "pending");
            return why ? revert(why) : ok("0xc350");
          }
          case "eth_getTransactionCount":
            return ok(hex(broadcasts.length));
          case "eth_blockNumber":
            return ok(hex(latestBlock()));
          case "eth_getBlockByNumber":
            return ok({
              number: hex(latestBlock()),
              hash: "0x" + "11".repeat(32),
              parentHash: "0x" + "22".repeat(32),
              timestamp: hex(now()),
              baseFeePerGas: "0x1",
              gasLimit: "0x1c9c380",
              gasUsed: "0x0",
              miner: ZERO,
              difficulty: "0x0",
              totalDifficulty: "0x0",
              extraData: "0x",
              logsBloom: "0x" + "00".repeat(256),
              nonce: "0x0000000000000000",
              sha3Uncles: "0x" + "33".repeat(32),
              size: "0x1",
              stateRoot: "0x" + "44".repeat(32),
              receiptsRoot: "0x" + "55".repeat(32),
              transactionsRoot: "0x" + "66".repeat(32),
              transactions: [],
              uncles: [],
            });
          case "eth_maxPriorityFeePerGas":
          case "eth_gasPrice":
            return ok("0x1");
          case "eth_getTransactionReceipt": {
            if (state.receiptFails) return fail("rate limited");
            const m = mined.find((x) => x.hash === msg.params![0]);
            if (!m) return ok(null);
            return ok({
              transactionHash: m.hash,
              transactionIndex: "0x0",
              blockHash: "0x" + "11".repeat(32),
              blockNumber: hex(m.block),
              from: m.from,
              to: m.to ?? null,
              cumulativeGasUsed: "0xc350",
              gasUsed: "0xc350",
              effectiveGasPrice: "0x1",
              contractAddress: null,
              logs: [],
              logsBloom: "0x" + "00".repeat(256),
              status: m.status === "success" ? "0x1" : "0x0",
              type: "0x2",
            });
          }
          case "eth_sendRawTransaction": {
            const raw = msg.params![0] as Hex;
            const tx = parseTransaction(raw);
            const from = await recoverTransactionAddress({ serializedTransaction: raw as never });
            const { functionName, args = [] } = decodeFunctionData({ abi: ABI, data: tx.data! });
            broadcasts.push({ to: tx.to ?? undefined, functionName, args });
            const hash = keccak256(raw);
            const block = nextBlock();
            const sealAt = Date.now() + (state.sealMs ?? 0);
            const base = { from, to: tx.to ?? undefined, functionName, args, block, sealAt };
            if (state.dropNext) {
              state.dropNext = false;
              return ok(hash);
            }
            if (functionName === "join" && state.rivalJoinsFirst) {
              mined.push({
                ...base,
                from: state.rivalJoinsFirst,
                hash: keccak256(hash),
                status: "success",
                foreign: true,
              });
              mined.push({ ...base, hash, status: "reverted" });
            } else if (state.minedRevert === functionName) {
              state.minedRevert = undefined;
              mined.push({ ...base, hash, status: "reverted" });
            } else {
              mined.push({ ...base, hash, status: "success" });
            }
            return ok(hash);
          }
          default:
            return fail(`fake rpc 1v1: unhandled ${msg.method}`);
        }
      } catch (e) {
        return fail(`fake rpc 1v1 handler: ${(e as Error).message}`);
      }
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    broadcasts,
    state,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
