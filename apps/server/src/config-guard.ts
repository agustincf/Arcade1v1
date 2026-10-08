// Guarda de configuración: evita arrancar el servidor en PRODUCCIÓN con dinero
// real pero mal configurado. El riesgo concreto: si el escrow está activo pero
// falta CHAIN_ID, el dominio EIP-712 cae por defecto en testnet (84532) y las
// firmas del árbitro NO sirven para cobrar en mainnet (los pagos se rompen).
//
// Devuelve la lista de problemas (vacía = todo OK). Se mantiene como función pura
// (recibe el env) para poder testearla sin tocar process.env real.

import { persistenceBackendFor } from "./persist.js";
import { alephChainIdFromEnv, chainIdFromEnv } from "./env.js";

const ZERO = "0x0000000000000000000000000000000000000000";

/** Espejo de `Escrow1v1.MAX_MATCH_DURATION` (2 días, en segundos): el contrato
 *  rechaza ("deadlines too far") un asiento cuya partida termine más allá de
 *  eso desde que se abre. */
export const ESCROW_MAX_MATCH_DURATION_S = 2 * 24 * 60 * 60;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const PRIVKEY_RE = /^0x[0-9a-fA-F]{64}$/;

const escrowSet = (raw: string | undefined) => {
  const a = (raw || "").trim().toLowerCase();
  return !!a && a !== ZERO;
};

// AUTENTICACION OBLIGATORIA (secure-by-default): exigir que cada envío venga
// firmado por la wallet del jugador. Sin esto, alguien podría mandar un puntaje
// a nombre del rival (haciéndolo perder). Política:
//   - REQUIRE_AUTH=true  -> obligatoria (cualquier entorno)
//   - REQUIRE_AUTH=false -> desactivada explícitamente (opt-out, p. ej. una demo)
//   - sin setear         -> obligatoria en producción, libre en dev (invitados)
// Vive acá (y matchmaking.ts la usa) para que la guarda de arranque valide
// exactamente la misma regla que aplica el árbitro.
export function authRequiredFor(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.REQUIRE_AUTH === "true" || (env.REQUIRE_AUTH !== "false" && env.NODE_ENV === "production")
  );
}

/** Con un escrow configurado (el del 1v1 o el de Aleph) hay plata en juego, y
 *  sin firma obligatoria cualquiera actúa a nombre de un depositante: presenta
 *  un puntaje bajo por él y el rival se lleva el pozo (pre-auditoría F6).
 *  Antes eso solo se avisaba en el log, y con `NODE_ENV` sin poner ni siquiera
 *  eso. Vale en CUALQUIER entorno: no depende de que alguien se acuerde de
 *  poner `NODE_ENV=production`. */
export function moneyAuthErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!escrowSet(env.ESCROW_ADDRESS) && !escrowSet(env.ALEPH_ESCROW_ADDRESS)) return [];
  if (authRequiredFor(env)) return [];
  return [
    "Hay un escrow configurado (ESCROW_ADDRESS o ALEPH_ESCROW_ADDRESS) pero la firma no es obligatoria " +
      `(REQUIRE_AUTH=${env.REQUIRE_AUTH ?? "sin poner"}, NODE_ENV=${env.NODE_ENV ?? "sin poner"}): ` +
      "cualquiera podría presentar un puntaje a nombre de un depositante. " +
      "Poné NODE_ENV=production (y quitá REQUIRE_AUTH=false), o REQUIRE_AUTH=true.",
  ];
}

export function productionConfigErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];

  const escrowRaw = (env.ESCROW_ADDRESS || "").trim();
  const escrow = escrowRaw.toLowerCase();
  const onchain = !!escrow && escrow !== ZERO;

  // Aleph (mesas de plata): su contrato es aparte. Si ALEPH_STAKES habilita una
  // mesa con plata, el escrow de Aleph es obligatorio: sin él, joinAleph la
  // rechaza por llamada, pero un despliegue así es un error de configuración y
  // conviene que falle al arrancar, no cuando el primer agente pide asiento.
  const alephRaw = (env.ALEPH_ESCROW_ADDRESS || "").trim();
  const alephOn = !!alephRaw && alephRaw.toLowerCase() !== ZERO;
  const moneyStakes = (env.ALEPH_STAKES || "0")
    .split(",")
    .map((s) => Number(s.trim()))
    .some((n) => Number.isFinite(n) && n > 0);

  const errors: string[] = [];
  if (moneyStakes && !alephOn) {
    errors.push(
      `ALEPH_STAKES ("${env.ALEPH_STAKES}") habilita una mesa de plata pero falta ALEPH_ESCROW_ADDRESS: ` +
        "sin el contrato de Aleph, toda mesa de plata se rechaza.",
    );
  }
  // LA RED DE ALEPH (decisión 6 de docs/MAINNET.md): mainnet arranca solo con
  // el 1v1, y las mesas de plata de Aleph siguen en testnet con su propia red.
  const alephChainRaw = (env.ALEPH_CHAIN_ID || "").trim();
  if (alephChainRaw && !(/^[0-9]+$/.test(alephChainRaw) && Number(alephChainRaw) > 0)) {
    errors.push(
      `ALEPH_CHAIN_ID inválido ("${alephChainRaw}"): debe ser un entero positivo (ej. 84532 testnet). ` +
        "Con un valor raro, las mesas de plata de Aleph firmarían para la red del 1v1.",
    );
  }
  const alephChain = alephChainIdFromEnv(env);
  if (moneyStakes && alephOn && alephChain === 8453) {
    errors.push(
      "Las mesas de plata de Aleph irían a Base mainnet (ALEPH_CHAIN_ID, o CHAIN_ID si falta, es 8453): " +
        "EscrowAleph no está auditado y mainnet arranca solo con el 1v1 (decisión 6 de docs/MAINNET.md). " +
        "Poné ALEPH_CHAIN_ID=84532 y ALEPH_RPC_URL de Base Sepolia, o dejá ALEPH_STAKES=0.",
    );
  }
  if (
    moneyStakes &&
    alephOn &&
    alephChain !== chainIdFromEnv(env) &&
    !(env.ALEPH_RPC_URL || "").trim()
  ) {
    errors.push(
      `Aleph va en otra red (${alephChain}) que el 1v1 (${chainIdFromEnv(env)}) pero falta ALEPH_RPC_URL: ` +
        "RPC_URL es el nodo del 1v1, y las lecturas y pagos de Aleph irían a la red equivocada.",
    );
  }
  if (alephOn && !ADDRESS_RE.test(alephRaw)) {
    errors.push(
      `ALEPH_ESCROW_ADDRESS mal formada ("${alephRaw}"): debe ser una dirección 0x + 40 hex. ` +
        "Con la dirección equivocada, los pases y la tabla de pagos no verifican en el contrato.",
    );
  }
  // Mesa de plata SIN persistencia durable. En Render (y cualquier host de disco
  // efímero) el backend "file" se borra entero en cada deploy: el árbitro
  // olvidaría las salas en `funding` —los depósitos quedan trabados en el
  // contrato hasta que cada asiento llame `refundUnfunded` por su cuenta— y las
  // ya liquidadas que todavía no presentó, perdiendo la tabla firmada: partida
  // pagada y anulada, recuperable recién con `refundExpired` horas después. Con
  // la mesa gratis esto costaba un ranking; con plata adentro, no arranca.
  const backend = persistenceBackendFor(env);
  if (moneyStakes && backend !== "redis") {
    errors.push(
      `ALEPH_STAKES ("${env.ALEPH_STAKES}") habilita una mesa de plata pero la persistencia es "${backend}" ` +
        "(faltan UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN): un deploy borraría las salas en fondeo " +
        "y las liquidaciones todavía sin presentar, dejando la plata trabada en el contrato.",
    );
  }
  // Lo mismo para las mesas de plata del 1v1 (pre-auditoría F7): sin Redis, un
  // deploy borra las decisiones firmadas que el árbitro todavía no liquidó, los
  // reembolsos sin confirmar y las partidas en fondeo. La plata no se pierde
  // (los reembolsos del contrato son permissionless), pero el ganador no cobra
  // y cada jugador tiene que ir a /recover por su cuenta.
  if (onchain && backend !== "redis") {
    errors.push(
      `ESCROW_ADDRESS habilita las mesas de plata del 1v1 pero la persistencia es "${backend}" ` +
        "(faltan UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN): un deploy borraría las decisiones " +
        "firmadas sin liquidar y los reembolsos pendientes, dejando la plata trabada en el contrato.",
    );
  }
  if (!onchain && !alephOn) return errors; // sin ningún escrow no hay dinero on-chain

  // No basta con que las variables EXISTAN: si están mal FORMADAS (un CHAIN_ID no
  // numérico, una clave truncada por un salto de línea, una dirección con un typo)
  // el servidor arrancaba "OK" pero las firmas no valían y NADIE podía cobrar —
  // desastre silencioso de despliegue. Validamos formato, no solo presencia.

  if (onchain && !ADDRESS_RE.test(escrowRaw)) {
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

  // El plazo de juego que el árbitro firma en cada asiento sale de
  // SUBMIT_WINDOW_MS (y nunca se firma antes de crear la partida, así que de
  // ahí al depósito solo puede achicarse). Si pasa el tope del contrato, CADA
  // depósito revierte con "deadlines too far": mejor no arrancar.
  const submitRaw = (env.SUBMIT_WINDOW_MS || "").trim();
  if (onchain && submitRaw && !(Number(submitRaw) <= ESCROW_MAX_MATCH_DURATION_S * 1000)) {
    errors.push(
      `SUBMIT_WINDOW_MS ("${submitRaw}") pasa el tope del contrato: una partida dura como mucho ` +
        `${ESCROW_MAX_MATCH_DURATION_S * 1000} ms (Escrow1v1.MAX_MATCH_DURATION, 2 días) y con esa ventana ` +
        "todo depósito revierte.",
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
