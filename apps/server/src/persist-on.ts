// Enciende la persistencia del estado del árbitro: partidas, ratings y agentes
// hosteados (ver persist.ts, que elige backend: Upstash Redis o archivo local).
//
// Es OPT-IN a propósito: solo el servidor real la activa. Los tests (selftest) y
// los e2e on-chain NO importan este módulo, así que corren sin tocar disco ni
// red y quedan herméticos/deterministas.
//
// IMPORTANTE: importar ANTES que cualquier módulo que lea el flag al cargarse
// (matchmaking/ratings/agents importan persist.ts, que lo lee al importarse).
process.env.ARCADE_PERSIST = "1";
// Y el traspaso entre instancias (ver persist.ts): el servidor real no escribe
// hasta tomar la posta. Los tests que prueban la persistencia sola no lo piden.
process.env.ARCADE_PERSIST_HANDOVER = "1";
