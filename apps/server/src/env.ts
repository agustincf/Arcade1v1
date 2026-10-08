// Las variables con las que el árbitro FIRMA y habla con la cadena, leídas
// igual que las valida la guarda de arranque (config-guard.ts): sin espacios ni
// saltos de línea alrededor. Antes la guarda validaba el valor recortado y los
// firmantes leían el crudo (pre-auditoría INT-3): una clave o una dirección con
// un salto de línea al final pasaba la guarda y rompía las firmas, y un
// CHAIN_ID vacío daba 0 en el dominio EIP-712 mientras la cadena caía en
// testnet.

/** El valor de una variable, recortado ("" si no está). */
export function envValue(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return (env[name] ?? "").trim();
}

/** La red: `CHAIN_ID`, o Base Sepolia (84532) si falta o no es un entero
 *  positivo. La misma para el dominio EIP-712, el cliente de la cadena y lo
 *  que el árbitro le dice a los agentes. */
export function chainIdFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(envValue("CHAIN_ID", env));
  return Number.isInteger(n) && n > 0 ? n : 84532;
}

/** La red de las mesas de plata de Aleph: `ALEPH_CHAIN_ID`, o la del 1v1 si
 *  falta. Puede ser otra: mainnet arranca solo con el 1v1 y las mesas de plata
 *  de Aleph siguen en testnet (decisión 6 de docs/MAINNET.md), así que el mismo
 *  árbitro firma en dos redes. Un valor inválido cae en la del 1v1. */
export function alephChainIdFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(envValue("ALEPH_CHAIN_ID", env));
  return Number.isInteger(n) && n > 0 ? n : chainIdFromEnv(env);
}
