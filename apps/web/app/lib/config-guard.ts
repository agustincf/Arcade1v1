// Guarda de configuración de la WEB — el espejo de apps/server/src/config-guard.ts.
//
// El árbitro ya falla rápido si arranca mal configurado; la web no tenía nada, y
// ahí estaba el peor modo de falla del producto: `onchainEnabled` se apaga solo
// cuando falta NEXT_PUBLIC_ESCROW_ADDRESS, así que una mesa de "5 USDC" se jugaba
// SIN depósito mientras la pantalla seguía diciendo 5 USDC. Una variable vacía en
// Vercel —o un build hecho sin ella, que el CI no detecta porque nunca corre
// `next build`— convertía todo el modo de plata en modo gratis, en silencio.
//
// Las NEXT_PUBLIC_* se hornean en el build, así que esto se evalúa igual en el
// servidor y en el cliente. Función pura (recibe el env) para poder testearla.

const ZERO = "0x0000000000000000000000000000000000000000";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface WebEnv {
  NEXT_PUBLIC_ESCROW_ADDRESS?: string;
  NEXT_PUBLIC_USDC_ADDRESS?: string;
  NEXT_PUBLIC_ARBITER_URL?: string;
  NEXT_PUBLIC_CHAIN_ID?: string;
  NODE_ENV?: string;
}

/** Problemas de configuración de la web (lista vacía = todo OK). */
export function webConfigErrors(env: WebEnv = process.env as WebEnv): string[] {
  const errors: string[] = [];

  const arbiter = (env.NEXT_PUBLIC_ARBITER_URL || "").trim();
  if (env.NODE_ENV === "production") {
    if (!arbiter) {
      errors.push(
        "Falta NEXT_PUBLIC_ARBITER_URL: en producción el sitio le pegaría a http://localhost:4000 " +
          "y no funcionaría nada (emparejar, ranking, replays).",
      );
    } else if (!/^https:\/\//.test(arbiter)) {
      errors.push(
        `NEXT_PUBLIC_ARBITER_URL debe ser https en producción ("${arbiter}"): ` +
          "un origen http hace que el navegador bloquee los pedidos desde una página segura.",
      );
    }
  }

  const escrowRaw = (env.NEXT_PUBLIC_ESCROW_ADDRESS || "").trim();
  const usdcRaw = (env.NEXT_PUBLIC_USDC_ADDRESS || "").trim();

  // Media configuración es peor que ninguna: con una sola de las dos direcciones,
  // `onchainEnabled` queda en false y las mesas de plata se juegan gratis.
  if (Boolean(escrowRaw) !== Boolean(usdcRaw)) {
    errors.push(
      "NEXT_PUBLIC_ESCROW_ADDRESS y NEXT_PUBLIC_USDC_ADDRESS tienen que estar las dos o ninguna: " +
        "con una sola, el pago on-chain se apaga y las mesas de plata se jugarían sin depósito.",
    );
  }

  for (const [name, raw] of [
    ["NEXT_PUBLIC_ESCROW_ADDRESS", escrowRaw],
    ["NEXT_PUBLIC_USDC_ADDRESS", usdcRaw],
  ] as const) {
    if (!raw) continue;
    if (!ADDRESS_RE.test(raw)) {
      errors.push(
        `${name} mal formada ("${raw}"): debe ser una dirección 0x + 40 hex. ` +
          "Con una dirección con typo, cada depósito revierte.",
      );
    } else if (raw.toLowerCase() === ZERO) {
      errors.push(`${name} es la dirección cero: el pago on-chain quedaría roto.`);
    }
  }

  const chainId = (env.NEXT_PUBLIC_CHAIN_ID || "").trim();
  if (chainId && (!/^[0-9]+$/.test(chainId) || Number(chainId) <= 0)) {
    errors.push(
      `NEXT_PUBLIC_CHAIN_ID inválido ("${chainId}"): debe ser un entero positivo ` +
        "(8453 mainnet, 84532 testnet). Un valor raro deja el sitio apuntando a la red equivocada.",
    );
  }
  if (chainId === "8453" && !escrowRaw) {
    errors.push(
      "NEXT_PUBLIC_CHAIN_ID dice mainnet (8453) pero no hay escrow configurado: " +
        "el sitio anunciaría dinero real y jugaría sin depósito.",
    );
  }

  return errors;
}

/** ¿Se puede ofrecer una mesa de plata con esta configuración?
 *
 *  La regla que faltaba: si el pago on-chain NO está activo, una mesa con
 *  apuesta > 0 **no se juega** — antes se degradaba sola a partida gratis sin
 *  decírselo a nadie. Es preferible una pantalla honesta de "no disponible"
 *  que una apuesta que no existe. */
export function moneyTableBlocked(bet: number, onchainEnabled: boolean): boolean {
  return bet > 0 && !onchainEnabled;
}
