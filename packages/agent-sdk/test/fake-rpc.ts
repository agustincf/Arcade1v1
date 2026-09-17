// packages/agent-sdk/test/fake-rpc.ts
// Un RPC de mentira, sin cadena, para probar qué FIRMA Y TRANSMITE la wallet de
// un agente. Contesta lo justo para que viem llegue hasta
// `eth_sendRawTransaction`; ahí decodifica la transacción firmada, la anota en
// `broadcasts` y NO la mina (responde con error, así el flujo corta ahí). Con
// eso un test puede afirmar "no se transmitió nada" y, en su control positivo,
// ver exactamente qué se habría mandado: sin ese control, un "nada" también
// podría querer decir que este fake no sabe llegar hasta el envío.
// Con `preconfirm` SÍ mina, como el RPC público de Base (ver `fakeRpc`).
// Lo usan packages/agent-sdk/test/agent-aleph.test.ts y
// apps/mcp/test/tools-aleph.test.ts. No es un *.test.ts: `npm test` no lo corre.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  keccak256,
  parseAbi,
  parseTransaction,
  type Hex,
} from "viem";
import { escrowAlephAbi, erc20MinimalAbi } from "@arcade1v1/game-sdk/aleph";

/** Una transacción firmada que llegó al RPC, ya decodificada. */
export interface Broadcast {
  to?: string;
  functionName: string;
  args: readonly unknown[];
}

export interface FakeRpc {
  url: string;
  /** Cada método JSON-RPC recibido, en orden; los `eth_call` con su función
   *  (`eth_call:balanceOf`). Vacío = la wallet ni siquiera leyó la cadena. */
  calls: string[];
  /** Lo que llegó a `eth_sendRawTransaction`. Vacío = no se transmitió nada. */
  broadcasts: Broadcast[];
  close: () => void;
}

const ABI = [...escrowAlephAbi, ...erc20MinimalAbi];

/** El revert del USDC (ERC20 de OpenZeppelin) cuando el escrow quiere tomar el
 *  stake sin permiso suficiente: el selector 0xfb8f41b2 que se vio en Sepolia. */
const ERC20_ERRORS = parseAbi([
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

const hex = (n: number) => "0x" + n.toString(16);

/** Una transacción minada en modo `preconfirm`. */
interface Mined {
  hash: Hex;
  to?: string;
  functionName: string;
  args: readonly unknown[];
  block: number;
  /** Desde cuándo se ve en `latest` (antes, solo en `pending`). */
  sealAt: number;
}

// Un bloque con `baseFeePerGas`: viem lo lee para armar la transacción
// EIP-1559 antes de firmarla.
const BLOCK = {
  number: "0x10",
  hash: "0x" + "11".repeat(32),
  parentHash: "0x" + "22".repeat(32),
  timestamp: "0x66000000",
  baseFeePerGas: "0x1",
  gasLimit: "0x1c9c380",
  gasUsed: "0x0",
  miner: "0x" + "00".repeat(20),
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
};

/** `chainIdHex` es lo que contesta `eth_chainId` (el control de red de
 *  `alephDeposit`). `chain` fija el saldo y el permiso de USDC de la wallet; la
 *  sala on-chain siempre figura sin abrir (status None) y sin pagos.
 *
 *  `preconfirm` hace que las transacciones SE MINEN como en el RPC público de
 *  Base: el recibo exitoso sale al instante, con el número del bloque que
 *  todavía se está armando, pero lo que cambian (el permiso de un `approve`)
 *  recién se ve en `latest` cuando ese bloque se sella, `sealMs` después; en
 *  `pending` se ve enseguida. La simulación de `open` revierte como el USDC si
 *  el permiso que se ve en el bloque consultado no cubre el stake. */
export async function fakeRpc(
  chainIdHex: string,
  chain: { balance?: bigint; allowance?: bigint; preconfirm?: { sealMs: number } } = {},
): Promise<FakeRpc> {
  const calls: string[] = [];
  const broadcasts: Broadcast[] = [];
  const BASE_BLOCK = Number(BLOCK.number);
  const mined: Mined[] = [];
  const sealed = (m: Mined) => Date.now() >= m.sealAt;
  const visibleAllowance = (blockTag: unknown) => {
    const approves = mined.filter(
      (m) => m.functionName === "approve" && (blockTag === "pending" || sealed(m)),
    );
    return approves.length > 0
      ? (approves[approves.length - 1].args[1] as bigint)
      : (chain.allowance ?? 0n);
  };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msg = JSON.parse(body) as { id: number; method: string; params?: unknown[] };
      const reply = (o: object) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...o }));
      };
      const ok = (result: unknown) => reply({ result });
      const fail = (message: string) => reply({ error: { code: -32000, message } });
      calls.push(msg.method);
      try {
        switch (msg.method) {
          case "eth_chainId":
            return ok(chainIdHex);
          case "eth_call": {
            const [{ data, to }, blockTag] = msg.params as [{ data: Hex; to: Hex }, unknown];
            const { functionName, args } = decodeFunctionData({ abi: ABI, data });
            calls[calls.length - 1] = `eth_call:${functionName}`;
            if (functionName === "roomOf")
              return ok(
                encodeFunctionResult({
                  abi: escrowAlephAbi,
                  functionName: "roomOf",
                  result: [[], 0n, 0, 0n, 0n, 0],
                }),
              );
            if (functionName === "paid")
              return ok(
                encodeFunctionResult({ abi: escrowAlephAbi, functionName: "paid", result: false }),
              );
            if (functionName === "balanceOf")
              return ok(
                encodeFunctionResult({
                  abi: erc20MinimalAbi,
                  functionName: "balanceOf",
                  result: chain.balance ?? 0n,
                }),
              );
            if (functionName === "allowance")
              return ok(
                encodeFunctionResult({
                  abi: erc20MinimalAbi,
                  functionName: "allowance",
                  result: visibleAllowance(blockTag),
                }),
              );
            if (functionName === "open" && chain.preconfirm) {
              const allowance = visibleAllowance(blockTag);
              const needed = args![2] as bigint;
              if (allowance < needed)
                return reply({
                  error: {
                    code: 3,
                    message: "execution reverted",
                    data: encodeErrorResult({
                      abi: ERC20_ERRORS,
                      errorName: "ERC20InsufficientAllowance",
                      args: [to, allowance, needed],
                    }),
                  },
                });
              return ok("0x");
            }
            return fail(`fake rpc: unhandled eth_call ${functionName}`);
          }
          case "eth_getTransactionCount":
            return ok("0x0");
          case "eth_blockNumber":
            return ok(hex(BASE_BLOCK + mined.filter(sealed).length));
          case "eth_getTransactionReceipt": {
            const m = mined.find((x) => x.hash === msg.params![0]);
            if (!m) return ok(null);
            // Preconfirmado: el recibo sale ya, con el bloque que todavía no se selló.
            return ok({
              transactionHash: m.hash,
              transactionIndex: "0x0",
              blockHash: BLOCK.hash,
              blockNumber: hex(m.block),
              from: "0x" + "00".repeat(20),
              to: m.to ?? null,
              cumulativeGasUsed: "0xc350",
              gasUsed: "0xc350",
              effectiveGasPrice: "0x1",
              contractAddress: null,
              logs: [],
              logsBloom: BLOCK.logsBloom,
              status: "0x1",
              type: "0x2",
            });
          }
          case "eth_getBlockByNumber":
            return ok(BLOCK);
          case "eth_maxPriorityFeePerGas":
          case "eth_gasPrice":
            return ok("0x1");
          case "eth_estimateGas":
            return ok("0xc350");
          case "eth_sendRawTransaction": {
            const raw = msg.params![0] as Hex;
            const tx = parseTransaction(raw);
            const { functionName, args } = decodeFunctionData({ abi: ABI, data: tx.data! });
            broadcasts.push({ to: tx.to ?? undefined, functionName, args: args ?? [] });
            if (!chain.preconfirm)
              return fail("fake rpc: signed transaction captured, never mined");
            const hash = keccak256(raw);
            mined.push({
              hash,
              to: tx.to ?? undefined,
              functionName,
              args: args ?? [],
              block: BASE_BLOCK + mined.length + 1,
              sealAt: Date.now() + chain.preconfirm.sealMs,
            });
            return ok(hash);
          }
          default:
            return fail(`fake rpc: unhandled ${msg.method}`);
        }
      } catch (e) {
        return fail(`fake rpc handler: ${(e as Error).message}`);
      }
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    broadcasts,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
