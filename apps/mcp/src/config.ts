// La wallet del servidor MCP, leída del entorno UNA vez al arrancar. Todo lo
// que decide plata sale de acá y lo fija el OPERADOR: el modelo nunca elige a
// qué contrato se le aprueba USDC ni cuánto se pone como máximo en una mesa.
import type { Hex } from "viem";

export interface WalletEnv {
  /** ARCADE_PRIVATE_KEY: la wallet del operador. Sin ella, una efímera por
   *  arranque, que solo firma. */
  privateKey?: Hex;
  /** RPC_URL: el RPC de la red del escrow, http:// o https://. */
  rpcUrl?: string;
  /** ARCADE_ALEPH_ESCROW_ADDRESS: el EscrowAleph en el que confía el operador
   *  (el mismo que corre el árbitro como ALEPH_ESCROW_ADDRESS). Sin él, las
   *  mesas de plata quedan apagadas en este servidor (tools.ts). */
  escrow?: Hex;
  /** ARCADE_ALEPH_MAX_STAKE: lo máximo, en USDC, que esta wallet pone en una
   *  mesa. Opcional. */
  maxStake?: number;
}

// Vacío cuenta como ausente: una config de Claude Desktop con `"RPC_URL": ""`
// de relleno es un "no configurado", no una URL rota que frene el arranque.
function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

/** Lee y valida la wallet. Tira con un mensaje para el operador que NUNCA
 *  repite el valor de una variable: la clave y la URL del RPC son secretas. */
export function walletFromEnv(env: Record<string, string | undefined>): WalletEnv {
  const rpcUrl = present(env.RPC_URL);
  if (rpcUrl !== undefined) {
    // viem repite la URL tal cual en sus mensajes de error, y la máscara de
    // aleph_deposit (withoutUrls, tools.ts) solo reconoce una URL con esquema:
    // escrita sin él ("eth-sepolia.g.alchemy.com/v2/<key>"), la API key del
    // path llegaba entera, dos veces, al error que lee el modelo. Solo http y
    // https: el SDK arma sus clientes con el transporte http de viem, así que
    // cualquier otro esquema (wss://, o "localhost:8545", que `new URL` lee
    // como el esquema "localhost:") falla en cada pedido de todas formas.
    let protocol: string | undefined;
    try {
      protocol = new URL(rpcUrl).protocol;
    } catch {
      protocol = undefined;
    }
    if (protocol !== "http:" && protocol !== "https:") {
      throw new Error(
        "RPC_URL must be a full URL starting with http:// or https:// (its value is not shown here: it may carry an API key)",
      );
    }
  }
  const escrow = present(env.ARCADE_ALEPH_ESCROW_ADDRESS);
  // Un pin mal escrito no abre nada (cada depósito fallaría "escrow mismatch"),
  // pero se descubriría recién con la sala en fondeo y el reloj corriendo.
  if (escrow !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(escrow)) {
    throw new Error("ARCADE_ALEPH_ESCROW_ADDRESS must be a 0x address (40 hex digits)");
  }
  const maxRaw = present(env.ARCADE_ALEPH_MAX_STAKE);
  // Solo un decimal positivo LISO ("2", "2.5"). `Number()` acepta mucho más y lo
  // convierte en silencio: "0x10" arrancaba con un tope de 16 USDC y "1e3" con
  // uno de 1000, así que un error de tipeo cambiaba el tope en vez de frenar el
  // arranque. Nada de signo, exponente, hexa, espacios ni separadores.
  if (maxRaw !== undefined && !(/^\d+(\.\d+)?$/.test(maxRaw) && Number(maxRaw) > 0)) {
    throw new Error(
      "ARCADE_ALEPH_MAX_STAKE must be a plain positive decimal number of USDC, like 2 or 2.5",
    );
  }
  const maxStake = maxRaw === undefined ? undefined : Number(maxRaw);
  return {
    privateKey: present(env.ARCADE_PRIVATE_KEY) as Hex | undefined,
    rpcUrl,
    escrow: escrow as Hex | undefined,
    maxStake,
  };
}
