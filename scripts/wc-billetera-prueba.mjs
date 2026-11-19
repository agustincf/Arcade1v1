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
//   PASAR_A=eip155:1   a los 8 s avisa que cambió a esa red (como cambiarla en la app)
//   NO_RESPONDER_TX=1  no contesta las transacciones (aprobar, depositar)
// Imprime cada evento en una línea y escucha hasta 15 minutos.

import { SignClient } from "@walletconnect/sign-client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const uri = process.argv[2];
if (!uri?.startsWith("wc:")) throw new Error("falta la URI wc:… del QR");
const cuenta = privateKeyToAccount(generatePrivateKey());
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
process.on("unhandledRejection", (e) => log("RECHAZO SIN MANEJAR:", e?.message ?? e));
log("billetera de prueba:", cuenta.address);

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
  const methods = [...new Set([...(req.methods ?? []), ...(opt.methods ?? []), "personal_sign"])];
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

client.on("session_request", async ({ id, topic, params }) => {
  const { method, params: p } = params.request;
  log("PEDIDO RECIBIDO:", method, "· cadena", params.chainId);
  // NO_RESPONDER=1 simula la sesión muerta del celular: el pedido no se contesta.
  if (process.env.NO_RESPONDER && method === "personal_sign") {
    log("  (NO_RESPONDER: no se contesta)");
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
      await client.respond({ topic, response: { id, jsonrpc: "2.0", result: null } });
      log("  cambio de red aceptado");
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
