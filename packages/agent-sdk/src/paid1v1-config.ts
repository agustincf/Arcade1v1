// La configuración de las mesas 1v1 de plata (`paid1v1` en createAgent). Va
// APARTE de las opciones de Aleph (`rpcUrl`, `escrow`): en mainnet el 1v1 corre
// en Base y las mesas de plata de Aleph siguen en Base Sepolia (decisión 6 de
// docs/MAINNET.md), y `escrow` ya significa EscrowAleph en todo el SDK.
//
// Se valida al crear el agente, sin tocar la red, y es todo o nada. Ningún
// mensaje repite un valor: en `escrow` se puede pegar una clave privada por
// error, y la URL del RPC puede llevar una API key.

/** Las redes en las que un agente puede jugar plata: Base, Base Sepolia y anvil
 *  (pruebas). */
export const PAID1V1_CHAIN_IDS = [8453, 84532, 31337] as const;

/** La comisión máxima que un agente acepta si su operador no fija otra (la de
 *  hoy, 15 %). */
export const DEFAULT_MAX_FEE_BPS = 1500;

/** El tope del contrato (`MAX_FEE_BPS`): más que eso no puede existir. */
const MAX_FEE_BPS = 2000;

export interface Paid1v1Config {
  /** RPC de la red del 1v1, http:// o https://. */
  rpcUrl: string;
  /** El Escrow1v1 en el que confía el operador. El agente solo le aprueba USDC
   *  a este contrato, nunca a uno que nombre el árbitro. */
  escrow: `0x${string}`;
  /** La red del escrow. El RPC tiene que estar en esta misma red. */
  chainId: (typeof PAID1V1_CHAIN_IDS)[number];
  /** Lo máximo, en USDC, que el agente pone en una mesa. Obligatorio. */
  maxStake: number;
  /** La comisión máxima que acepta, en puntos básicos (por defecto 1500). */
  maxFeeBps?: number;
}

/** Valida `paid1v1`. Sin configuración devuelve `undefined`; con una inválida
 *  tira nombrando cada campo con problemas. */
export function validatePaid1v1(cfg: unknown, hasPrivateKey: boolean): Paid1v1Config | undefined {
  if (cfg === undefined) return undefined;
  if (typeof cfg !== "object" || cfg === null) {
    throw new Error("createAgent: paid1v1 must be an object { rpcUrl, escrow, chainId, maxStake }");
  }
  const c = cfg as Record<string, unknown>;
  const bad: string[] = [];

  const escrow = c.escrow;
  if (
    typeof escrow !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(escrow) ||
    escrow.toLowerCase() === "0x" + "0".repeat(40)
  ) {
    bad.push(
      "paid1v1.escrow must be the Escrow1v1 contract address — 0x followed by 40 hex digits, not the zero address",
    );
  }

  let protocol: string | undefined;
  try {
    protocol = typeof c.rpcUrl === "string" ? new URL(c.rpcUrl).protocol : undefined;
  } catch {
    protocol = undefined;
  }
  if (protocol !== "http:" && protocol !== "https:") {
    bad.push("paid1v1.rpcUrl must be a full URL starting with http:// or https://");
  }

  if (!PAID1V1_CHAIN_IDS.includes(c.chainId as never)) {
    bad.push(`paid1v1.chainId must be one of ${PAID1V1_CHAIN_IDS.join(", ")}`);
  }

  if (typeof c.maxStake !== "number" || !Number.isFinite(c.maxStake) || c.maxStake <= 0) {
    bad.push(
      "paid1v1.maxStake must be a positive number of USDC (the most this agent puts on one table)",
    );
  }

  if (
    c.maxFeeBps !== undefined &&
    (typeof c.maxFeeBps !== "number" ||
      !Number.isInteger(c.maxFeeBps) ||
      c.maxFeeBps < 0 ||
      c.maxFeeBps > MAX_FEE_BPS)
  ) {
    bad.push(`paid1v1.maxFeeBps must be an integer between 0 and ${MAX_FEE_BPS}`);
  }

  if (bad.length > 0) {
    throw new Error(`createAgent: ${bad.join("; ")} (values are not shown here)`);
  }
  if (!hasPrivateKey) {
    throw new Error(
      "createAgent: paid1v1 needs privateKey (the ephemeral wallet can never hold USDC)",
    );
  }
  return {
    rpcUrl: c.rpcUrl as string,
    escrow: escrow as `0x${string}`,
    chainId: c.chainId as Paid1v1Config["chainId"],
    maxStake: c.maxStake as number,
    ...(c.maxFeeBps !== undefined ? { maxFeeBps: c.maxFeeBps as number } : {}),
  };
}
