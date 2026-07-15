// Agentes HOSTEADOS: los que se crean desde el builder no-code de la web.
// Cada agente es una wallet generada acá (la clave privada NUNCA sale del
// servidor) + una config de estrategia del registro compartido. El runner
// (agent-runner.ts) los hace jugar solos en la ladder gratis (stake 0).
// Persistencia vía persist.ts (Redis o archivo; opt-in, ver ese módulo).

import { randomBytes } from "node:crypto";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getStrategy, validateParams, AGENT_AVATARS } from "@arcade1v1/strategies";
import { isKnownGame, dropWaitingMatch } from "./matchmaking.js";
import { getRating } from "./ratings.js";
import { recordAgentCreated } from "./stats.js";
import { jsonStore } from "./persist.js";
import { validateWebhookUrl, webhookAgentsEnabled } from "./webhook-fetch.js";

export { AGENT_AVATARS };

// Límites (configurables por entorno, como STAKES_ALLOWED).
export const MAX_AGENTS_PER_OWNER = Number(process.env.MAX_AGENTS_PER_OWNER ?? 3);
export const MAX_AGENTS_TOTAL = Number(process.env.MAX_AGENTS_TOTAL ?? 200);

// Agentes BYO por webhook (v4.2): el cerebro vive afuera, la identidad acá.
export const WEBHOOK_STRATEGY_ID = "webhook";
/** Fallas consecutivas del webhook (notificación fallida o forfeit) antes de
 *  auto-pausar al agente para no seguir encolando un muerto. */
export const WEBHOOK_MAX_FAILURES = Number(process.env.WEBHOOK_MAX_FAILURES ?? 3);

// Wallets de la casa (v4.1): dueñas de los agentes "CASA" que mantienen la
// arena viva. Exentas del tope POR OWNER (no del global, que sigue protegiendo
// contra abuso). Se relee el env por llamada (con cache por valor) para que
// los tests puedan variarlo sin reimportar el módulo.
let houseCache: { raw: string; set: Set<string> } | undefined;
export function isHouseWallet(address: string): boolean {
  const raw = process.env.HOUSE_WALLETS ?? "";
  if (!houseCache || houseCache.raw !== raw) {
    const set = new Set(
      raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
    houseCache = { raw, set };
  }
  return houseCache.set.has(String(address).toLowerCase());
}
const MAX_NAME_LEN = 24;
const HISTORY_CAP = 50; // ring buffer: las Match se purgan a los 2 días, esto queda

export interface AgentMatchSummary {
  matchId: string;
  game: string;
  opponent?: string;
  yourScore?: number;
  rivalScore?: number;
  outcome: "win" | "loss" | "draw";
  ratingDelta?: number;
  ts: number;
}

export interface HostedAgent {
  id: string; // "agt_" + hex
  owner: string; // wallet del dueño, normalizada
  name: string;
  avatar: string;
  game: string;
  strategyId: string;
  params: Record<string, unknown>;
  /** Identidad del agente en la ladder (clave del ELO). */
  address: Hex;
  /** Generada server-side. NUNCA se incluye en una respuesta de la API. */
  privateKey: Hex;
  /** Agente BYO: el cerebro corre en el servidor del dueño, vía webhook.
   *  `secret` = mismo trust level que privateKey (NUNCA en toView; se entrega
   *  UNA vez al crear). `notifiedAt` ancla el deadline del forfeit y refiere
   *  SIEMPRE a pendingMatchId (se limpia junto con él). */
  webhook?: { url: string; secret: string; failures: number; notifiedAt?: number };
  active: boolean;
  createdAt: number;
  lastPlayedAt?: number;
  pendingMatchId?: string;
  pendingSince?: number;
  stats: { matches: number; wins: number; losses: number; draws: number };
  history: AgentMatchSummary[];
}

/** Lo que ve la API: el agente SIN la clave privada. */
export interface AgentView {
  id: string;
  owner: string;
  name: string;
  avatar: string;
  game: string;
  strategyId: string;
  params: Record<string, unknown>;
  address: Hex;
  active: boolean;
  createdAt: number;
  lastPlayedAt?: number;
  stats: HostedAgent["stats"];
  rating: number;
  /** true solo para agentes cuyo owner está en HOUSE_WALLETS (etiqueta CASA). */
  house?: boolean;
  /** true para agentes BYO por webhook (nunca se expone la URL ni el secreto). */
  byo?: boolean;
}

const store$ = jsonStore("agents");
const agents = new Map<string, HostedAgent>();

/** Restaura los agentes guardados. La llama index.ts ANTES de escuchar. */
export async function restoreAgents(): Promise<void> {
  const raw = await store$.load();
  if (!raw) return;
  try {
    const arr = JSON.parse(raw) as HostedAgent[];
    for (const a of arr) agents.set(a.id, a);
    if (arr.length) console.log(`Agentes hosteados recuperados: ${arr.length}`);
  } catch (e) {
    console.error("agents restore (dato corrupto, arrancamos limpio):", (e as Error).message);
  }
}

function save() {
  store$.save(() => JSON.stringify([...agents.values()]));
}

const normAddr = (a: string) => String(a).toLowerCase();

/** Nombre saneado: imprimible, sin saltos de línea, largo acotado. Exportado
 *  para reusarlo en los perfiles humanos (misma validación, sin duplicar). */
export function sanitizeName(raw: unknown): string {
  const s = String(raw ?? "")
    // eslint-disable-next-line no-control-regex -- justamente queremos filtrar caracteres de control
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_NAME_LEN);
  if (!s) throw new Error("name required");
  return s;
}

export function toView(a: HostedAgent): AgentView {
  return {
    id: a.id,
    owner: a.owner,
    name: a.name,
    avatar: a.avatar,
    game: a.game,
    strategyId: a.strategyId,
    params: a.params,
    address: a.address,
    active: a.active,
    createdAt: a.createdAt,
    lastPlayedAt: a.lastPlayedAt,
    stats: a.stats,
    rating: getRating(normAddr(a.address), a.game),
    ...(isHouseWallet(a.owner) ? { house: true } : {}),
    ...(a.webhook ? { byo: true } : {}),
  };
}

export function createHostedAgent(input: {
  owner: string;
  name: unknown;
  avatar: unknown;
  game: string;
  strategyId: string;
  params: unknown;
  webhookUrl?: unknown;
}): HostedAgent {
  const owner = normAddr(input.owner);
  if (!/^0x[0-9a-f]{40}$/.test(owner)) throw new Error("bad owner address");
  if (!isKnownGame(input.game)) throw new Error(`unknown game: ${input.game}`);
  // BYO por webhook: sin estrategia del registro — el cerebro es la URL del
  // dev. Validación sintáctica acá (sync); el guard con DNS corre al notificar.
  let webhook: HostedAgent["webhook"];
  if (input.strategyId === WEBHOOK_STRATEGY_ID) {
    if (!webhookAgentsEnabled()) throw new Error("webhook agents disabled");
    webhook = {
      url: validateWebhookUrl(input.webhookUrl),
      secret: randomBytes(32).toString("hex"),
      failures: 0,
    };
  }
  const def = webhook ? undefined : getStrategy(input.strategyId);
  if (!webhook && (!def || def.game !== input.game)) {
    throw new Error(`unknown strategy for ${input.game}: ${input.strategyId}`);
  }
  if (agents.size >= MAX_AGENTS_TOTAL) throw new Error("agent capacity reached");
  // Las wallets de la casa (HOUSE_WALLETS) no tienen tope por owner: son
  // nuestras y pueblan los 6 juegos. El tope global de arriba sí les aplica.
  if (!isHouseWallet(owner)) {
    const mine = [...agents.values()].filter((a) => a.owner === owner);
    if (mine.length >= MAX_AGENTS_PER_OWNER) {
      throw new Error(`max ${MAX_AGENTS_PER_OWNER} agents per owner`);
    }
  }

  const privateKey = generatePrivateKey();
  const agent: HostedAgent = {
    id: "agt_" + randomBytes(8).toString("hex"),
    owner,
    name: sanitizeName(input.name),
    avatar: AGENT_AVATARS.includes(String(input.avatar)) ? String(input.avatar) : AGENT_AVATARS[0],
    game: input.game,
    strategyId: webhook ? WEBHOOK_STRATEGY_ID : def!.id,
    // Default-deny server-side: lo que no valida, cae al default del registro.
    // Los BYO no tienen params (su config es la URL).
    params: webhook ? {} : validateParams(def!, input.params as Record<string, unknown>),
    ...(webhook ? { webhook } : {}),
    privateKey,
    address: privateKeyToAccount(privateKey).address,
    active: true,
    createdAt: Date.now(),
    stats: { matches: 0, wins: 0, losses: 0, draws: 0 },
    history: [],
  };
  agents.set(agent.id, agent);
  save();
  // Embudo (v4.1): solo cuentan los agentes de TERCEROS — los de la casa son
  // nuestros y contarlos inflaría la señal de tracción.
  if (!isHouseWallet(owner)) recordAgentCreated();
  return agent;
}

export function getAgent(id: string): HostedAgent | undefined {
  return agents.get(id);
}

export function listAgents(owner?: string): HostedAgent[] {
  const all = [...agents.values()];
  if (!owner) return all;
  const o = normAddr(owner);
  return all.filter((a) => a.owner === o);
}

/** ¿Esta address de la ladder es un agente hosteado? (para el anti-farming). */
export function hostedAgentByAddress(address: string): HostedAgent | undefined {
  const a = normAddr(address);
  return [...agents.values()].find((x) => normAddr(x.address) === a);
}

export function updateAgent(
  id: string,
  patch: { name?: unknown; avatar?: unknown; params?: unknown; webhookUrl?: unknown },
): HostedAgent {
  const a = agents.get(id);
  if (!a) throw new Error("agent not found");
  if (patch.name !== undefined) a.name = sanitizeName(patch.name);
  if (patch.avatar !== undefined && AGENT_AVATARS.includes(String(patch.avatar))) {
    a.avatar = String(patch.avatar);
  }
  // Los BYO no tienen estrategia del registro: params se ignora (antes,
  // getStrategy(...)!  explotaba con un strategyId fuera del registro).
  if (patch.params !== undefined && !a.webhook) {
    const def = getStrategy(a.strategyId)!;
    a.params = validateParams(def, patch.params as Record<string, unknown>);
  }
  // Cambiar la URL del webhook (re-validada). El secreto NO rota en v1.
  if (patch.webhookUrl !== undefined && a.webhook) {
    a.webhook.url = validateWebhookUrl(patch.webhookUrl);
  }
  save();
  return a;
}

/** Si el agente quedó esperando rival en la cola, descartar esa espera: sin
 *  esto, un humano (u otro agente) se emparejaba con un fantasma que nunca
 *  iba a jugar su intento. No borra pendingMatchId: si la partida ya estaba
 *  emparejada sigue viva (al reanudar, el agente la juega), y si se descartó,
 *  el runner lo detecta solo (getMatch devuelve null) y limpia. */
function releaseQueue(a: HostedAgent) {
  if (a.pendingMatchId) dropWaitingMatch(a.pendingMatchId);
}

export function setAgentActive(id: string, active: boolean): HostedAgent {
  const a = agents.get(id);
  if (!a) throw new Error("agent not found");
  a.active = active;
  if (!active) releaseQueue(a);
  save();
  return a;
}

export function deleteAgent(id: string) {
  const a = agents.get(id);
  if (!a) throw new Error("agent not found");
  releaseQueue(a);
  agents.delete(id);
  save();
}

/** El runner registra el resultado de una partida terminada del agente. */
export function recordAgentResult(a: HostedAgent, entry: AgentMatchSummary) {
  a.stats.matches += 1;
  if (entry.outcome === "win") a.stats.wins += 1;
  else if (entry.outcome === "loss") a.stats.losses += 1;
  else a.stats.draws += 1;
  a.history.unshift(entry);
  if (a.history.length > HISTORY_CAP) a.history.length = HISTORY_CAP;
  a.lastPlayedAt = entry.ts;
  a.pendingMatchId = undefined;
  a.pendingSince = undefined;
  if (a.webhook) a.webhook.notifiedAt = undefined; // el ancla muere con el pending
  save();
}

/** Marca / limpia la partida en curso del agente (estado del runner). */
export function setAgentPending(a: HostedAgent, matchId: string | undefined) {
  a.pendingMatchId = matchId;
  a.pendingSince = matchId ? Date.now() : undefined;
  if (a.webhook) a.webhook.notifiedAt = undefined; // el ancla muere con el pending
  save();
}

/** El runner marcó que se notificó al webhook: arranca el reloj del forfeit. */
export function markWebhookNotified(a: HostedAgent) {
  if (!a.webhook) return;
  a.webhook.notifiedAt = Date.now();
  save();
}

/** Falla del webhook (notificación fallida o forfeit). A las
 *  WEBHOOK_MAX_FAILURES consecutivas se auto-pausa (y suelta la cola) para no
 *  seguir encolando un muerto. Devuelve true si pausó (para loguear). */
export function recordWebhookFailure(a: HostedAgent): boolean {
  if (!a.webhook) return false;
  a.webhook.failures += 1;
  const paused = a.webhook.failures >= WEBHOOK_MAX_FAILURES;
  if (paused) {
    a.active = false;
    a.webhook.failures = 0;
    releaseQueue(a);
  }
  save();
  return paused;
}

/** Un /play exitoso limpia la racha de fallas (el endpoint del dev vive). */
export function resetWebhookFailures(a: HostedAgent) {
  if (!a.webhook || a.webhook.failures === 0) return;
  a.webhook.failures = 0;
  save();
}
