// Mensaje canonico que el jugador/agente FIRMA con su wallet para probar que
// controla su direccion. Mismo formato en la web y en el servidor (sin drift).

/** Mensaje a firmar al enviar un puntaje. Ata: partida + jugador + puntaje. */
export function scoreAuthMessage(matchId: string, address: string, score: number): string {
  return [
    "Arcade1v1: confirmo mi puntaje",
    `match: ${matchId}`,
    `player: ${address.toLowerCase()}`,
    `score: ${score}`,
  ].join("\n");
}

/** Ventana de validez (ms) de la firma de emparejamiento (anti-replay). */
export const MATCHMAKE_AUTH_TTL_MS = 10 * 60 * 1000;

/** Ventana de validez (ms) de la firma de administración de agentes. */
export const AGENT_AUTH_TTL_MS = 10 * 60 * 1000;

/** Mensaje a firmar para ADMINISTRAR un agente hosteado (crear, editar,
 *  pausar, borrar). Ata: acción + agente + dueño + momento (ts). `agentRef`
 *  es el id del agente (o, al crear, "juego:estrategia:nombre"). Sin esta
 *  firma, cualquiera manejaría los agentes de otro con solo saber su address. */
export function agentAuthMessage(
  action: string,
  agentRef: string,
  owner: string,
  ts: number,
): string {
  return [
    "Arcade1v1: administro mi agente",
    `action: ${action}`,
    `agent: ${agentRef}`,
    `owner: ${owner.toLowerCase()}`,
    `ts: ${ts}`,
  ].join("\n");
}

/** Mensaje a firmar para editar el PERFIL humano (nombre + avatar). Ata:
 *  acción + la propia address + momento (ts). El firmante debe ser esa address:
 *  nadie edita el perfil de otro. */
export function profileAuthMessage(action: string, address: string, ts: number): string {
  return [
    "Arcade1v1: edito mi perfil",
    `action: ${action}`,
    `player: ${address.toLowerCase()}`,
    `ts: ${ts}`,
  ].join("\n");
}

/** Mensaje a firmar para DESAFIAR a un rival puntual (ladder gratis). Ata:
 *  quién desafía + a quién + momento (ts). Lo firma el humano que desafía; para
 *  agente→agente se usa agentAuthMessage("challenge", ...) en su lugar. */
export function challengeAuthMessage(challenger: string, target: string, ts: number): string {
  return [
    "Arcade1v1: desafío a un rival",
    `challenger: ${challenger.toLowerCase()}`,
    `target: ${target.toLowerCase()}`,
    `ts: ${ts}`,
  ].join("\n");
}

/** Mensaje a firmar al EMPAREJAR. Ata: juego + mesa + jugador + momento (ts).
 *  Sin esto, cualquiera podría encolar direcciones ajenas (suplantación) o
 *  llenar la cola de rivales fantasma que nunca depositan. El `ts` (epoch ms)
 *  evita reusar una firma vieja: el árbitro la acepta solo unos minutos. */
export function matchmakeAuthMessage(
  game: string,
  stake: number,
  address: string,
  ts: number,
): string {
  return [
    "Arcade1v1: quiero emparejar",
    `game: ${game}`,
    `stake: ${stake}`,
    `player: ${address.toLowerCase()}`,
    `ts: ${ts}`,
  ].join("\n");
}

/** Mensaje a firmar por cada ACCIÓN en una sala de La Bóveda (formato
 *  multi-agente). Ata: sala + etapa + fase + la línea canónica de la acción
 *  (`actionLine` del subpath /vault) + momento (ts, válido MATCHMAKE_AUTH_TTL_MS).
 *  Sin esto, cualquiera votaría o hablaría a nombre de otro asiento. */
export function vaultActionAuthMessage(
  roomId: string,
  stage: number,
  phase: string,
  line: string,
  ts: number,
): string {
  return [
    "Arcade1v1: actúo en la sala",
    `room: ${roomId.toLowerCase()}`,
    `stage: ${stage}`,
    `phase: ${phase}`,
    `action: ${line}`,
    `ts: ${ts}`,
  ].join("\n");
}

/** Mensaje a firmar para pedir la VISTA PRIVADA de tu asiento en una sala de
 *  La Bóveda (el "pase de vista"). Ata: sala + jugador + momento (ts, válido
 *  MATCHMAKE_AUTH_TTL_MS). Sin esto, cualquiera leería con un `?address=`
 *  ajeno el fragmento de la Cerradura y los susurros privados de ese asiento. */
export function vaultViewAuthMessage(roomId: string, address: string, ts: number): string {
  return [
    "Arcade1v1: miro mi sala",
    `room: ${roomId.toLowerCase()}`,
    `player: ${address.toLowerCase()}`,
    `ts: ${ts}`,
  ].join("\n");
}
