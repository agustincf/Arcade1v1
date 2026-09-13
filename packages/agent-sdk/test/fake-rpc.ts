// packages/agent-sdk/test/fake-rpc.ts
// Un RPC de mentira, sin cadena, para probar qué FIRMA Y TRANSMITE la wallet de
// un agente. Contesta lo justo para que viem llegue hasta
// `eth_sendRawTransaction`; ahí decodifica la transacción firmada, la anota en
// `broadcasts` y NO la mina (responde con error, así el flujo corta ahí). Con
// eso un test puede afirmar "no se transmitió nada" y, en su control positivo,
// ver exactamente qué se habría mandado: sin ese control, un "nada" también
// podría querer decir que este fake no sabe llegar hasta el envío.
// Lo usan packages/agent-sdk/test/agent-aleph.test.ts y
// apps/mcp/test/tools-aleph.test.ts. No es un *.test.ts: `npm test` no lo corre.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeFunctionData, encodeFunctionResult, parseTransaction, type Hex } from "viem";
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
 *  sala on-chain siempre figura sin abrir (status None) y sin pagos. */
export async function fakeRpc(
  chainIdHex: string,
  chain: { balance?: bigint; allowance?: bigint } = {},
): Promise<FakeRpc> {
  const calls: string[] = [];
  const broadcasts: Broadcast[] = [];
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
            const { data } = msg.params![0] as { data: Hex };
            const { functionName } = decodeFunctionData({ abi: ABI, data });
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
                  result: chain.allowance ?? 0n,
                }),
              );
            return fail(`fake rpc: unhandled eth_call ${functionName}`);
          }
          case "eth_getTransactionCount":
            return ok("0x0");
          case "eth_blockNumber":
            return ok(BLOCK.number);
          case "eth_getBlockByNumber":
            return ok(BLOCK);
          case "eth_maxPriorityFeePerGas":
          case "eth_gasPrice":
            return ok("0x1");
          case "eth_estimateGas":
            return ok("0xc350");
          case "eth_sendRawTransaction": {
            const tx = parseTransaction(msg.params![0] as Hex);
            const { functionName, args } = decodeFunctionData({ abi: ABI, data: tx.data! });
            broadcasts.push({ to: tx.to ?? undefined, functionName, args: args ?? [] });
            return fail("fake rpc: signed transaction captured, never mined");
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
