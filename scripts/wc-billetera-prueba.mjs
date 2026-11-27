// Billetera de prueba por WalletConnect: se conecta a la web por el mismo QR
// que escanea MetaMask en el celular, y muestra cada pedido que le llega
// (firma para emparejar, cambio de red, transacciones). Sirve para probar el
// camino del QR sin un celular. Clave efímera sin fondos: firma mensajes y
// rechaza las transacciones.
//
// Uso (desde la raíz del repo, después de `npm ci`):
//   node scripts/wc-billetera-prueba.mjs "wc:...@2?relay-protocol=irn&symKey=..."
// La URI sale del modal oficial de WalletConnect ("Copy link"). Variables para
// simular problemas:
//   NO_RESPONDER=1     no contesta la firma (como una sesión del celular vencida)
//   CADENA=eip155:1    se conecta solo en esa red
//   RECHAZAR_RED=1     rechaza los pedidos de cambiar de red
//   NO_RESPONDER_RED=1 (con CADENA) no deja agregar redes y el primer cambio
//                      de red (el que la web pide al conectar) falla, así que
//                      la conexión queda en la otra red; los cambios
//                      siguientes no se contestan (como el celular al que el
//                      pedido nunca le llega). Con NO_RESPONDER_RED=todos no
//                      contesta ni el primero: la conexión queda colgada
//   PASAR_A=eip155:1   a los 8 s avisa que cambió a esa red (como cambiarla en la app)
//   NO_RESPONDER_TX=1  no contesta las transacciones (aprobar, depositar)
//   LOTES_RPC=http://127.0.0.1:8545  se porta como una cuenta inteligente:
//                      declara lotes atómicos (EIP-5792) y los ejecuta en ESA
//                      red (una copia local de Base Sepolia con anvil, nunca la
//                      real), fondeándose sola con ETH y USDC de prueba
// Imprime cada evento en una línea y escucha hasta 15 minutos.

import { SignClient } from "@walletconnect/sign-client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, toHex } from "viem";
import { baseSepolia } from "viem/chains";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const uri = process.argv[2];
if (!uri?.startsWith("wc:")) throw new Error("falta la URI wc:… del QR");
const cuenta = privateKeyToAccount(generatePrivateKey());
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
process.on("unhandledRejection", (e) => log("RECHAZO SIN MANEJAR:", e?.message ?? e));
log("billetera de prueba:", cuenta.address);

// LOTES_RPC: la billetera ejecuta los lotes en una cadena LOCAL (anvil).
const LOTES_RPC = process.env.LOTES_RPC;
const USDC_PRUEBA = "0xBE3A57a90548b336F5EBF997E6DA6d3DC64EE137";
const lotes = new Map();
let local;
if (LOTES_RPC) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(LOTES_RPC)) {
    throw new Error("LOTES_RPC tiene que ser una cadena local (anvil), nunca una red real");
  }
  const transport = http(LOTES_RPC);
  local = {
    pub: createPublicClient({ chain: baseSepolia, transport }),
    wal: createWalletClient({ account: cuenta, chain: baseSepolia, transport }),
  };
  await local.pub.request({
    method: "anvil_setBalance",
    params: [cuenta.address, toHex(10n ** 18n)],
  });
  const h = await local.wal.writeContract({
    address: USDC_PRUEBA,
    abi: [
      {
        type: "function",
        name: "mint",
        stateMutability: "nonpayable",
        inputs: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [],
      },
    ],
    functionName: "mint",
    args: [cuenta.address, 10_000_000n],
  });
  await local.pub.waitForTransactionReceipt({ hash: h });
  log("fondeada en la copia local: 1 ETH y 10 USDC de prueba");
}

const client = await SignClient.init({
  projectId: "ce6f7a5715f885bc1ce1e91d06f02bff",
  metadata: {
    name: "Billetera de prueba",
    description: "Prueba de WalletConnect",
    url: "https://example.com",
    icons: [],
  },
  storageOptions: { database: join(mkdtempSync(join(tmpdir(), "wc-")), "db") },
});

client.on("session_proposal", async ({ id, params }) => {
  const req = params.requiredNamespaces?.eip155 ?? {};
  const opt = params.optionalNamespaces?.eip155 ?? {};
  // CADENA=eip155:1 simula una wallet parada en otra red (la app usa 84532).
  const chains = process.env.CADENA
    ? [process.env.CADENA]
    : [
        ...new Set([
          ...(req.chains ?? []),
          ...(opt.chains ?? []),
          "eip155:84532",
          ...(process.env.PASAR_A ? [process.env.PASAR_A] : []),
        ]),
      ];
  const methods = [
    ...new Set([...(req.methods ?? []), ...(opt.methods ?? []), "personal_sign"]),
  ].filter((m) => !(process.env.NO_RESPONDER_RED && m === "wallet_addEthereumChain"));
  const events = [...new Set([...(req.events ?? []), ...(opt.events ?? [])])];
  log("propuesta de sesión de", params.proposer?.metadata?.url, "· cadenas:", chains.join(","));
  try {
    const { acknowledged } = await client.approve({
      id,
      namespaces: {
        eip155: { chains, methods, events, accounts: chains.map((c) => `${c}:${cuenta.address}`) },
      },
    });
    const s = await acknowledged();
    log("SESIÓN APROBADA", s.topic.slice(0, 10));
    // PASAR_A=eip155:1 simula que el usuario cambia de red en la app del
    // celular después de conectar: la wallet avisa chainChanged a la web.
    if (process.env.PASAR_A) {
      setTimeout(async () => {
        const destino = process.env.PASAR_A;
        await client.emit({
          topic: s.topic,
          event: { name: "chainChanged", data: Number(destino.split(":")[1]) },
          chainId: destino,
        });
        log("la wallet pasó a la red", destino);
      }, 8_000);
    }
  } catch (e) {
    log("ERROR al aprobar:", e?.message ?? e);
  }
});

let cambiosDeRed = 0;
client.on("session_request", async ({ id, topic, params }) => {
  const { method, params: p } = params.request;
  log("PEDIDO RECIBIDO:", method, "· cadena", params.chainId);
  // NO_RESPONDER=1 simula la sesión muerta del celular: el pedido no se contesta.
  if (process.env.NO_RESPONDER && method === "personal_sign") {
    log("  (NO_RESPONDER: no se contesta)");
    return;
  }
  if (
    process.env.NO_RESPONDER_RED &&
    (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain")
  ) {
    if (!cambiosDeRed++ && process.env.NO_RESPONDER_RED !== "todos") {
      await client.respond({
        topic,
        response: { id, jsonrpc: "2.0", error: { code: -32603, message: "red no disponible" } },
      });
      log("  primer cambio de red: falla (la conexión sigue en la otra red)");
    } else {
      log("  (NO_RESPONDER_RED: el cambio de red no se contesta)");
    }
    return;
  }
  try {
    if (method === "personal_sign") {
      const [msg] = p;
      const texto = msg.startsWith("0x") ? Buffer.from(msg.slice(2), "hex").toString("utf8") : msg;
      log("  mensaje:", JSON.stringify(texto.slice(0, 160)));
      const firma = await cuenta.signMessage({
        message: msg.startsWith("0x") ? { raw: msg } : msg,
      });
      log("  firma lista:", firma.slice(0, 12), "· respondiendo…");
      const t0 = Date.now();
      await Promise.race([
        client.respond({ topic, response: { id, jsonrpc: "2.0", result: firma } }),
        new Promise((_, no) =>
          setTimeout(() => no(new Error("respond tardó más de 30 s")), 30_000),
        ),
      ]);
      log("  respuesta publicada en", Date.now() - t0, "ms");
      log("  FIRMADO y respondido");
    } else if (
      process.env.RECHAZAR_RED &&
      (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain")
    ) {
      // RECHAZAR_RED=1: el usuario no acepta cambiar de red (queda en la suya).
      await client.respond({
        topic,
        response: { id, jsonrpc: "2.0", error: { code: 4001, message: "no cambio de red" } },
      });
      log("  cambio de red RECHAZADO");
    } else if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") {
      // Como una wallet de verdad: si la red no estaba en la sesión, la agrega
      // (con la cuenta), contesta, y avisa que cambió de red.
      const numero = Number(p?.[0]?.chainId);
      const destino = `eip155:${numero}`;
      const ns = client.session.get(topic).namespaces.eip155;
      if (method === "wallet_switchEthereumChain" && !ns.chains?.includes(destino)) {
        const { acknowledged } = await client.update({
          topic,
          namespaces: {
            eip155: {
              ...ns,
              chains: [...(ns.chains ?? []), destino],
              accounts: [...ns.accounts, `${destino}:${cuenta.address}`],
            },
          },
        });
        await acknowledged();
        log("  sesión actualizada con", destino);
      }
      await client.respond({ topic, response: { id, jsonrpc: "2.0", result: null } });
      if (method === "wallet_switchEthereumChain") {
        await client.emit({
          topic,
          event: { name: "chainChanged", data: numero },
          chainId: destino,
        });
      }
      log("  cambio de red aceptado");
    } else if (local && method === "wallet_getCapabilities") {
      const caps = { [toHex(84532)]: { atomic: { status: "supported" } } };
      await client.respond({ topic, response: { id, jsonrpc: "2.0", result: caps } });
      log("  capacidades: lote atómico soportado");
    } else if (local && method === "wallet_sendCalls") {
      const [{ calls }] = p;
      log("  LOTE de", calls.length, "llamadas:", calls.map((c) => c.data.slice(0, 10)).join(", "));
      const recibos = [];
      for (const c of calls) {
        const hash = await local.wal.sendTransaction({
          to: c.to,
          data: c.data,
          value: c.value ? BigInt(c.value) : 0n,
        });
        recibos.push(await local.pub.waitForTransactionReceipt({ hash }));
      }
      const idLote = toHex(crypto.getRandomValues(new Uint8Array(32)));
      lotes.set(idLote, recibos);
      await client.respond({ topic, response: { id, jsonrpc: "2.0", result: { id: idLote } } });
      log("  lote ejecutado:", recibos.map((r) => r.status).join(", "));
    } else if (local && method === "wallet_getCallsStatus") {
      const recibos = lotes.get(p[0]) ?? [];
      const ok = recibos.length > 0 && recibos.every((r) => r.status === "success");
      const result = {
        version: "2.0.0",
        id: p[0],
        chainId: toHex(84532),
        status: ok ? 200 : 500,
        atomic: true,
        receipts: recibos.map((r) => ({
          logs: r.logs.map((l) => ({ address: l.address, data: l.data, topics: l.topics })),
          status: r.status === "success" ? "0x1" : "0x0",
          blockHash: r.blockHash,
          blockNumber: toHex(r.blockNumber),
          gasUsed: toHex(r.gasUsed),
          transactionHash: r.transactionHash,
        })),
      };
      await client.respond({ topic, response: { id, jsonrpc: "2.0", result } });
      log("  estado del lote:", ok ? "éxito" : "falló");
    } else if (
      (method.startsWith("wallet_") && method.includes("Calls")) ||
      method === "wallet_getCapabilities"
    ) {
      // Sin LOTES_RPC, una wallet común: no sabe de lotes (EIP-5792) y lo dice.
      await client.respond({
        topic,
        response: { id, jsonrpc: "2.0", error: { code: 4200, message: "método no soportado" } },
      });
      log("  sin soporte de lotes: método rechazado (4200)");
    } else if (process.env.NO_RESPONDER_TX) {
      log("  (NO_RESPONDER_TX: la transacción no se contesta)");
    } else {
      await client.respond({
        topic,
        response: { id, jsonrpc: "2.0", error: { code: 4001, message: "rechazado por la prueba" } },
      });
      log("  rechazado (la prueba no manda transacciones)");
    }
  } catch (e) {
    log("ERROR al responder:", e?.message ?? e);
  }
});

client.on("session_delete", () => log("la web cerró la sesión"));

await client.core.pairing.pair({ uri });
log("emparejado con la URI; esperando la propuesta…");
setTimeout(() => {
  log("fin de la espera");
  process.exit(0);
}, 15 * 60_000);
