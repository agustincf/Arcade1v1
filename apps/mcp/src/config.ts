// La wallet del servidor MCP, leída del entorno UNA vez al arrancar. Todo lo
// que decide plata sale de acá y lo fija el OPERADOR: el modelo nunca elige a
// qué contrato se le aprueba USDC ni cuánto se pone como máximo en una mesa.
import type { Hex } from "viem";
import type { Paid1v1Config } from "@arcade1v1/agent-sdk";

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
  /** Las mesas 1v1 de plata, de ARCADE_1V1_ESCROW_ADDRESS, ARCADE_1V1_RPC_URL,
   *  ARCADE_1V1_CHAIN_ID y ARCADE_1V1_MAX_STAKE: van las cuatro o ninguna, y
   *  exigen ARCADE_PRIVATE_KEY. Sin ellas, apagadas. Van APARTE de las de Aleph
   *  (en mainnet el 1v1 corre en Base y Aleph sigue en Base Sepolia), y el RPC
   *  del 1v1 NO hereda RPC_URL, para no usar sin querer el de la otra red. */
  paid1v1?: Paid1v1Config;
}

const ONE_V_ONE_VARS = [
  "ARCADE_1V1_ESCROW_ADDRESS",
  "ARCADE_1V1_RPC_URL",
  "ARCADE_1V1_CHAIN_ID",
  "ARCADE_1V1_MAX_STAKE",
] as const;
const ONE_V_ONE_CHAINS = [8453, 84532, 31337] as const;

/** ¿Una URL que el transporte http de viem puede usar? */
function httpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Un pin de contrato usable: 0x + 40 hex y no la dirección cero. */
const contractAddress = (v: string) =>
  /^0x[0-9a-fA-F]{40}$/.test(v) && v.toLowerCase() !== "0x" + "0".repeat(40);

/** Un decimal positivo LISO y finito ("2", "2.5"): ver ARCADE_ALEPH_MAX_STAKE. */
const plainPositive = (v: string) =>
  /^\d+(\.\d+)?$/.test(v) && Number.isFinite(Number(v)) && Number(v) > 0;

function paid1v1FromEnv(
  env: Record<string, string | undefined>,
  hasKey: boolean,
): Paid1v1Config | undefined {
  const got = ONE_V_ONE_VARS.map((k) => present(env[k]));
  if (got.every((v) => v === undefined)) return undefined;
  const missing = ONE_V_ONE_VARS.filter((_, i) => got[i] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `paid 1v1 tables need all four of ${ONE_V_ONE_VARS.join(", ")} — missing: ${missing.join(", ")}`,
    );
  }
  if (!hasKey) {
    throw new Error(
      "paid 1v1 tables need ARCADE_PRIVATE_KEY (a dedicated wallet funded with USDC and ETH for gas)",
    );
  }
  const [escrow, rpcUrl, chainRaw, maxRaw] = got as string[];
  // Ningún mensaje repite el valor: la URL puede traer una API key y en el pin
  // se puede pegar una clave por error.
  if (!contractAddress(escrow)) {
    throw new Error(
      "ARCADE_1V1_ESCROW_ADDRESS must be the Escrow1v1 address (0x + 40 hex digits), not the zero address",
    );
  }
  if (!httpUrl(rpcUrl)) {
    throw new Error(
      "ARCADE_1V1_RPC_URL must be a full URL starting with http:// or https:// (its value is not shown here: it may carry an API key)",
    );
  }
  const chainId = /^\d+$/.test(chainRaw) ? Number(chainRaw) : NaN;
  if (!ONE_V_ONE_CHAINS.includes(chainId as never)) {
    throw new Error(`ARCADE_1V1_CHAIN_ID must be one of ${ONE_V_ONE_CHAINS.join(", ")}`);
  }
  if (!plainPositive(maxRaw)) {
    throw new Error(
      "ARCADE_1V1_MAX_STAKE must be a plain positive decimal number of USDC, like 2 or 10",
    );
  }
  return {
    escrow: escrow as Hex,
    rpcUrl,
    chainId: chainId as Paid1v1Config["chainId"],
    maxStake: Number(maxRaw),
  };
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
  // pero se descubriría recién con la sala en fondeo y el reloj corriendo. La
  // dirección cero tampoco es un pin: pasaba el formato, el servidor arrancaba
  // con las mesas de plata prendidas, aleph_join se sentaba a una mesa que no
  // podía pagar y, si el árbitro servía la misma cero, la wallet firmaba un
  // approve a 0x000…000. El agent-sdk aplica la misma regla en createAgent.
  if (
    escrow !== undefined &&
    (!/^0x[0-9a-fA-F]{40}$/.test(escrow) || escrow.toLowerCase() === "0x" + "0".repeat(40))
  ) {
    throw new Error(
      "ARCADE_ALEPH_ESCROW_ADDRESS must be a 0x address (40 hex digits), not the zero address",
    );
  }
  const maxRaw = present(env.ARCADE_ALEPH_MAX_STAKE);
  // Solo un decimal positivo LISO ("2", "2.5"). `Number()` acepta mucho más y lo
  // convierte en silencio: "0x10" arrancaba con un tope de 16 USDC y "1e3" con
  // uno de 1000, así que un error de tipeo cambiaba el tope en vez de frenar el
  // arranque. Nada de signo, exponente, hexa, espacios ni separadores. Y FINITO:
  // un decimal liso más grande que Number.MAX_VALUE (unos 309 dígitos) es
  // `Infinity` para `Number()`, y con ese tope aleph_join se sentaba a cualquier
  // mesa mientras cada aleph_deposit fallaba (el agent-sdk no acepta un maxStake
  // infinito).
  if (
    maxRaw !== undefined &&
    !(/^\d+(\.\d+)?$/.test(maxRaw) && Number.isFinite(Number(maxRaw)) && Number(maxRaw) > 0)
  ) {
    throw new Error(
      "ARCADE_ALEPH_MAX_STAKE must be a plain positive decimal number of USDC, like 2 or 2.5",
    );
  }
  const maxStake = maxRaw === undefined ? undefined : Number(maxRaw);
  const privateKey = present(env.ARCADE_PRIVATE_KEY) as Hex | undefined;
  const paid1v1 = paid1v1FromEnv(env, privateKey !== undefined);
  return {
    privateKey,
    rpcUrl,
    escrow: escrow as Hex | undefined,
    maxStake,
    ...(paid1v1 ? { paid1v1 } : {}),
  };
}
