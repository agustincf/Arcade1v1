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
