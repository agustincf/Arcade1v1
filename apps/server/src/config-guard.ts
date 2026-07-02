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
  if (!env.RPC_URL) {
    errors.push(
      "Falta RPC_URL (sin nodo, el árbitro no puede cancelar/reembolsar on-chain los empates ni las partidas vencidas).",
    );
  }
  return errors;
}

// Interpreta TRUST_PROXY para Express de forma segura. Devuelve `undefined` cuando
// no hay que setear nada (vacío o un valor no reconocido como "si"/"abc"): así un
// error de tipeo del operador NO se pasa crudo a Express (que lo tomaría como lista
// de IPs y podría comportarse raro), y se mantiene el default seguro.
//   "1"/"2"   -> número de saltos detrás del proxy
//   "true"/"false" -> confiar siempre / nunca
//   IP o subred (contiene "." o ":") -> se pasa tal cual (IPv4/IPv6/CIDR)
export function parseTrustProxy(value: string | undefined): number | boolean | string | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value); // saltos detrás del proxy
  if (value === "true") return true;
  if (value === "false") return false;
  if (/[.:]/.test(value)) return value; // IP / subred (IPv4 / IPv6 / CIDR)
  return undefined; // no reconocido -> ignorar (mantener el default seguro)
}
