// Enciende la persistencia de partidas en disco (ver matchmaking.ts).
//
// Es OPT-IN a propósito: solo el servidor real la activa. Los tests (selftest) y
// los e2e on-chain NO importan este módulo, así que corren sin tocar disco y
// quedan herméticos/deterministas.
//
// IMPORTANTE: importar ANTES que "./matchmaking.js" (que lee el flag al cargarse).
process.env.ARCADE_PERSIST_MATCHES = "1";
