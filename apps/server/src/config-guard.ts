// Guarda de configuración: evita arrancar el servidor en PRODUCCIÓN con dinero
// real pero mal configurado. El riesgo concreto: si el escrow está activo pero
// falta CHAIN_ID, el dominio EIP-712 cae por defecto en testnet (84532) y las
// firmas del árbitro NO sirven para cobrar en mainnet (los pagos se rompen).
//
// Devuelve la lista de problemas (vacía = todo OK). Se mantiene como función pura
// (recibe el env) para poder testearla sin tocar process.env real.

const ZERO = "0x0000000000000000000000000000000000000000";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const PRIVKEY_RE = /^0x[0-9a-fA-F]{64}$/;

export function productionConfigErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];

  const escrowRaw = (env.ESCROW_ADDRESS || "").trim();
  const escrow = escrowRaw.toLowerCase();
  const onchain = !!escrow && escrow !== ZERO;
  if (!onchain) return []; // sin escrow no hay dinero real on-chain (p. ej. demo)

  const errors: string[] = [];

  // No basta con que las variables EXISTAN: si están mal FORMADAS (un CHAIN_ID no
  // numérico, una clave truncada por un salto de línea, una dirección con un typo)
  // el servidor arrancaba "OK" pero las firmas no valían y NADIE podía cobrar —
  // desastre silencioso de despliegue. Validamos formato, no solo presencia.

  if (!ADDRESS_RE.test(escrowRaw)) {
    errors.push(
      `ESCROW_ADDRESS mal formada ("${escrowRaw}"): debe ser una dirección 0x + 40 hex. ` +
        "Con la dirección equivocada, las firmas EIP-712 no valen y los pagos se rompen.",
    );
  }

  const chainId = (env.CHAIN_ID || "").trim();
  if (!chainId) {
    errors.push("Falta CHAIN_ID (caería en testnet 84532 y las firmas no servirían en mainnet).");
  } else if (!/^[0-9]+$/.test(chainId) || Number(chainId) <= 0) {
    errors.push(
      `CHAIN_ID inválido ("${chainId}"): debe ser un entero positivo (ej. 8453 mainnet, 84532 testnet). ` +
        "Un valor no numérico deja el dominio EIP-712 en el default y las firmas no sirven para cobrar.",
    );
  }

  const pk = (env.ARBITER_PRIVATE_KEY || "").trim();
  if (!pk) {
    errors.push("Falta ARBITER_PRIVATE_KEY (el árbitro no puede firmar resultados).");
  } else if (!PRIVKEY_RE.test(pk)) {
    errors.push(
      "ARBITER_PRIVATE_KEY mal formada: debe ser 0x + 64 hex (32 bytes). " +
        "Una clave truncada o con espacios/saltos de línea no firma resultados válidos.",
    );
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
