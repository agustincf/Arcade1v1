// El selftest corre 100% OFFLINE (sin cadena), a propósito: prueba la lógica del
// árbitro (emparejamiento, firma, anti-trampa, ELO) sin depender de un nodo.
//
// Si el .env local tiene ESCROW_ADDRESS configurado, `onchain.ts` lo captura al
// importarse y `onchainEnabled()` daría true -> el empate intentaría cancelar
// on-chain, fallaría (no hay nodo) y ensuciaría la salida con un error de viem.
// Para que el selftest sea DETERMINISTA y limpio, limpiamos esas variables ANTES
// de que se cargue el módulo onchain.
//
// IMPORTANTE: importar JUSTO después de "dotenv/config" y ANTES de cualquier
// módulo que lea estas variables (matchmaking -> onchain).
delete process.env.ESCROW_ADDRESS;
delete process.env.CHAIN_ID;

// Mesas del selftest: incluye 3 y 7 para tener colas dedicadas por caso (el
// default real del árbitro es 1,2,5,10, igual que el contrato).
process.env.STAKES_ALLOWED = "1,2,3,5,7,10";

// Clave de PRUEBA para firmar en el selftest cuando no hay .env (p. ej. en CI):
// es la cuenta #1 de anvil/hardhat, pública y sin valor. El selftest solo
// verifica que la firma sea consistente consigo misma; no necesita la real.
process.env.ARBITER_PRIVATE_KEY ??=
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
