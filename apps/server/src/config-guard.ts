// Guarda de configuración: evita arrancar el servidor en PRODUCCIÓN con dinero
// real pero mal configurado. El riesgo concreto: si el escrow está activo pero
// falta CHAIN_ID, el dominio EIP-712 cae por defecto en testnet (84532) y las
// firmas del árbitro NO sirven para cobrar en mainnet (los pagos se rompen).
//
// Devuelve la lista de problemas (vacía = todo OK). Se mantiene como función pura
// (recibe el env) para poder testearla sin tocar process.env real.

const ZERO = "0x0000000000000000000000000000000000000000";

export function productionConfigErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];

  const escrow = (env.ESCROW_ADDRESS || "").toLowerCase();
  const onchain = !!escrow && escrow !== ZERO;
  if (!onchain) return []; // sin escrow no hay dinero real on-chain (p. ej. demo)

  const errors: string[] = [];
  if (!env.CHAIN_ID) {
    errors.push("Falta CHAIN_ID (caería en testnet 84532 y las firmas no servirían en mainnet).");
  }
  if (!env.ARBITER_PRIVATE_KEY) {
    errors.push("Falta ARBITER_PRIVATE_KEY (el árbitro no puede firmar resultados).");
  }
  if (!env.ALLOWED_ORIGIN) {
    errors.push("Falta ALLOWED_ORIGIN (CORS quedaría abierto a '*').");
  }
  return errors;
}
