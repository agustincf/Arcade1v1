// Entrypoint del servidor MCP por stdio. Config: ARBITER_URL (default = árbitro
// publicado) y, para las mesas de plata de Aleph, la wallet del operador
// (config.ts). Sin wallet propia, el agente usa una efímera por arranque que
// solo firma.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ArbiterClient, createAgent } from "@arcade1v1/agent-sdk";
import { buildServer } from "./server";
import { walletFromEnv } from "./config";

const arbiterUrl = process.env.ARBITER_URL ?? "https://arcade1v1.onrender.com";

async function main() {
  // La wallet se valida PRIMERO: una RPC_URL sin esquema o un pin mal escrito
  // frenan el arranque con un mensaje que no repite el valor, en vez de
  // aparecer (o filtrar una API key) recién en el primer depósito. Va adentro
  // de main para que el catch de abajo lo imprima sin stack y salga con 1.
  const wallet = walletFromEnv(process.env);

  // Calentamiento: el árbitro (Render free) se duerme por inactividad y tarda
  // ~30-50s en despertar — más que el timeout típico de un cliente MCP. Un ping
  // al arrancar lo despierta mientras el usuario todavía está escribiendo.
  fetch(`${arbiterUrl}/health`).catch(() => {});

  // El ping no garantiza que el árbitro esté despierto cuando llegue la primera
  // herramienta, así que el cliente va con sus topes por defecto: el primer
  // pedido espera el arranque en frío (COLD_START_TIMEOUT_MS) y recién después
  // baja al tope corto de régimen. Con un tope corto desde el vamos, la primera
  // herramienta contra un árbitro dormido falla siempre.
  const client = new ArbiterClient(arbiterUrl);
  // El pin de escrow sale del MISMO objeto hacia los dos lados: al agente, que
  // lo hace cumplir dentro de `alephDeposit`, y a las herramientas, que sin él
  // no se sientan a una mesa de plata ni depositan.
  const agent = createAgent({
    arbiterUrl,
    client,
    privateKey: wallet.privateKey,
    rpcUrl: wallet.rpcUrl,
    escrow: wallet.escrow,
  });
  const server = buildServer({
    agent,
    client,
    money: { escrow: wallet.escrow, maxStake: wallet.maxStake },
  });
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error("arcade1v1-mcp error:", (e as Error).message);
  process.exit(1);
});
