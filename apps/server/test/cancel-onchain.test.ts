// Un cancelMatch del árbitro que se MINA revertido no es un reembolso.
//
// `cancelMatchOnchain` simulaba, mandaba la transacción y esperaba el recibo
// sin mirarlo. viem no tira error cuando el recibo viene con status
// "reverted": lo devuelve. Si otra transacción cambiaba la partida entre la
// simulación y el bloque, el cancel revertido pasaba por reembolso hecho:
// ningún log, ningún reintento, y `m.refundPromise` resolvía como si la plata
// hubiera vuelto. Es el mismo agujero que tapó `sendAlephWrite` en Aleph.
//
// Estos tests pasan por la cancelación REAL (`cancelMatchWithRetries`), con un
// nodo de mentira. El e2e contra anvil (onchain-e2e.ts) reproduce las dos
// carreras con un nodo de verdad.
// Correr: node --import tsx --test apps/server/test/cancel-onchain.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ContractFunctionExecutionError, ContractFunctionRevertedError, type Hex } from "viem";
import { escrowAbi } from "../src/abi.js";
import { cancelMatchWithRetries, ONCHAIN_STATUS } from "../src/onchain.js";

const MATCH = ("0x" + "1".repeat(64)) as Hex;
const { Open, Funded, Settled, Refunded } = ONCHAIN_STATUS;

/** El hash de la n-ésima transacción que manda el nodo de mentira. */
const tx = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;

interface FakeChain {
  /** Estado de la partida en la cadena (`ONCHAIN_STATUS`). */
  status: number;
  /** Cómo se mina cada transacción, en orden de envío. */
  mined: ("success" | "reverted")[];
  /** Lo que pasa en la cadena mientras viaja la transacción n: otra que se mina antes. */
  race?: (n: number) => void;
  /** El getter `matches` no contesta (un RPC caído). */
  readsFail?: boolean;
  /** Un nodo del RPC atrasado: una lectura sin `blockNumber` ve este estado viejo. */
  staleLatest?: number;
}

/** Un nodo con la forma de viem. La simulación aplica la regla del contrato
 *  (solo se cancela en Open o Funded), la transacción sale y el recibo vuelve
 *  como diga `mined`: viem no tira error por un revert minado, igual que acá. */
function fakeNode(chain: FakeChain) {
  let sent = 0;
  const reads: { functionName: string; args: unknown[]; blockNumber?: bigint }[] = [];
  const pub = {
    async simulateContract(p: { functionName: string; args: unknown[] }) {
      if (chain.status !== Open && chain.status !== Funded) {
        const { functionName, args } = p;
        throw new ContractFunctionExecutionError(
          new ContractFunctionRevertedError({
            abi: escrowAbi,
            functionName,
            message: "cant cancel",
          }),
          { abi: escrowAbi, functionName, args },
        );
      }
      return { request: p };
    },
    async waitForTransactionReceipt({ hash }: { hash: Hex }) {
      const status = chain.mined[sent - 1];
      if (status === "success") chain.status = Refunded;
      return { status, blockNumber: 7n, transactionHash: hash };
    },
    async readContract(p: { functionName: string; args: unknown[]; blockNumber?: bigint }) {
      if (chain.readsFail) throw new Error("rpc down");
      const { functionName, args, blockNumber } = p;
      reads.push({ functionName, args, blockNumber });
      const status =
        blockNumber === undefined && chain.staleLatest !== undefined
          ? chain.staleLatest
          : chain.status;
      // Getter `matches`: p1, p2, stake, p1Paid, p2Paid, fundDeadline, playDeadline, status.
      return ["0x" + "a".repeat(40), "0x" + "b".repeat(40), 5_000_000n, true, true, 0n, 0n, status];
    },
  };
  const wallet = {
    account: { address: ("0x" + "c".repeat(40)) as Hex },
    async writeContract() {
      sent++;
      chain.race?.(sent);
      return tx(sent);
    },
  };
  return { clients: () => ({ pub, wallet }) as never, sent: () => sent, reads: () => reads };
}

for (const [name, closed] of [
  ["Refunded", Refunded],
  ["Settled", Settled],
] as const) {
  test(`un cancel que se mina REVERTIDO porque otro dejó la partida ${name} sale con el hash y no se reintenta`, async () => {
    // Mientras viaja el cancel, otro cierra la partida y se mina antes: un
    // jugador que pide su reembolso desde /recover, el dueño con su propio
    // `cancelMatch`, o un `settle`. El nuestro revierte ya dentro del bloque.
    const chain: FakeChain = { status: Funded, mined: ["reverted"] };
    chain.race = () => (chain.status = closed);
    const node = fakeNode(chain);

    await assert.rejects(cancelMatchWithRetries(node.clients, MATCH, 0), (e: Error) => {
      assert.match(e.message, new RegExp(tx(1)), "el hash revertido tiene que quedar en el log");
      assert.match(e.message, new RegExp(name));
      return true;
    });
    assert.equal(node.sent(), 1, "ya está cerrada: no hay nada que cancelar");
  });
}

test("la partida del cancel revertido se lee en el bloque donde se minó, no en un nodo atrasado", async () => {
  // El RPC reparte los pedidos entre nodos: el recibo lo contesta uno que ya
  // tiene el bloque, y la lectura puede caer en otro que todavía ve la
  // partida Funded. Así se reintentaba de más, y el error final perdía el hash.
  const chain: FakeChain = { status: Funded, mined: ["reverted"], staleLatest: Funded };
  chain.race = () => (chain.status = Refunded);
  const node = fakeNode(chain);

  await assert.rejects(cancelMatchWithRetries(node.clients, MATCH, 0), /match already Refunded/);
  assert.equal(node.sent(), 1);
  assert.deepEqual(
    node.reads(),
    [{ functionName: "matches", args: [MATCH], blockNumber: 7n }],
    "el getter `matches` de ESTA partida, en el bloque del recibo",
  );
});

test("un cancel revertido con la partida todavía cancelable se reintenta: el rival se unió mientras viajaba", async () => {
  // El `join` del rival se mina antes: la partida pasa de Open a Funded y el
  // cancel, con el gas estimado para devolver UN depósito, se queda sin gas al
  // devolver dos. La plata de los dos sigue en el escrow.
  const chain: FakeChain = { status: Open, mined: ["reverted", "success"] };
  chain.race = (n) => {
    if (n === 1) chain.status = Funded;
  };
  const node = fakeNode(chain);

  await cancelMatchWithRetries(node.clients, MATCH, 0);
  assert.equal(node.sent(), 2, "el segundo cancel sale con la partida ya Funded");
  assert.equal(chain.status, Refunded);
});

test("si después del revert la cadena no contesta, se reintenta igual: no se abandona un reembolso por el RPC", async () => {
  const chain: FakeChain = { status: Funded, mined: ["reverted", "success"], readsFail: true };
  const node = fakeNode(chain);

  await cancelMatchWithRetries(node.clients, MATCH, 0);
  assert.equal(node.sent(), 2);
  assert.equal(chain.status, Refunded);
});

test("si todos los intentos se minan revertidos, sale el error con el hash del último: nunca resuelve en silencio", async () => {
  const chain: FakeChain = { status: Funded, mined: Array(10).fill("reverted") };
  const node = fakeNode(chain);

  await assert.rejects(cancelMatchWithRetries(node.clients, MATCH, 0), (e: Error) => {
    assert.ok(node.sent() > 1, "reintentó antes de rendirse");
    assert.match(e.message, new RegExp(tx(node.sent())));
    return true;
  });
});
