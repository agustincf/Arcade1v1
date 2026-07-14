// MÉTRICAS del árbitro: contadores reales para la página pública de estado
// (/status) y el endpoint GET /stats. Todo es honesto y verificable — nada de
// números inflados (regla de la casa):
//
//   - matchesCreated / matchesSettled: partidas creadas y decididas.
//   - verificationsRejected: envíos que el anti-trampa rechazó (replay que no
//     re-juega igual, seed/score mismatch, etc.).
//   - uptime: del PROCESO actual (por-proceso; se reinicia con cada deploy).
//   - activeAgents: se inyecta al servir (vive en agents.ts), no se persiste.
//
// Los acumulados se persisten con el mismo jsonStore que ratings/agents, así
// sobreviven un redeploy del árbitro. El detalle por día (UTC) se poda a los
// últimos STATS_MAX_DAYS para no crecer sin fin (como el resto del server).
//
// stats.ts solo depende de persist.ts (a propósito): matchmaking → stats es un
// import de una vía; el conteo de agentes activos entra desde index.ts para no
// crear un ciclo con agents.ts.

import { jsonStore } from "./persist.js";

const store$ = jsonStore("stats");

/** Días de detalle diario que se conservan (el total nunca se pierde). */
export const STATS_MAX_DAYS = 30;

interface Counters {
  matchesCreated: number;
  matchesSettled: number;
  verificationsRejected: number;
  /** Embudo de tracción (v4.1): agentes creados por TERCEROS (la casa no cuenta). */
  agentsCreated: number;
  /** Partidas decididas casa vs casa (mantienen viva la arena, no son tracción). */
  settledHouse: number;
  /** Partidas decididas tercero vs casa (señal: alguien de afuera jugó). */
  settledMixed: number;
}
type CounterKey = keyof Counters;

interface StatsData {
  totals: Counters;
  /** día UTC "YYYY-MM-DD" -> contadores de ese día. */
  daily: Record<string, Partial<Counters>>;
  /** desde cuándo acumulan los totales (primer arranque; sobrevive redeploys). */
  firstRecordedAt: number;
}

const zeros = (): Counters => ({
  matchesCreated: 0,
  matchesSettled: 0,
  verificationsRejected: 0,
  agentsCreated: 0,
  settledHouse: 0,
  settledMixed: 0,
});

// Arranque del PROCESO actual: base del uptime honesto (no se persiste).
let processStartedAt = Date.now();

let data: StatsData = { totals: zeros(), daily: {}, firstRecordedAt: Date.now() };

/** Día UTC "YYYY-MM-DD" de un instante. */
function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function save() {
  store$.save(() => JSON.stringify(data));
}

/** Poda el detalle diario a los últimos STATS_MAX_DAYS (ordena por fecha ISO,
 *  que es lexicográfica). El total ya está sumado aparte, no se pierde nada. */
function pruneDaily() {
  const keys = Object.keys(data.daily);
  if (keys.length <= STATS_MAX_DAYS) return;
  const keep = new Set(keys.sort().slice(-STATS_MAX_DAYS));
  for (const k of keys) if (!keep.has(k)) delete data.daily[k];
}

function bump(key: CounterKey, now: number) {
  data.totals[key] += 1;
  const k = dayKey(now);
  const day = (data.daily[k] ??= {});
  day[key] = (day[key] ?? 0) + 1;
  pruneDaily();
  save();
}

export function recordMatchCreated(now = Date.now()) {
  bump("matchesCreated", now);
}

/** `houseSide`: cuántos de los dos jugadores son agentes de la casa (0|1|2).
 *  2 = casa vs casa; 1 = un tercero jugó CONTRA la casa (señal de tracción);
 *  0/omitido = terceros puros. matchesSettled cuenta siempre. */
export function recordMatchSettled(houseSide: 0 | 1 | 2 = 0, now = Date.now()) {
  bump("matchesSettled", now);
  if (houseSide === 2) bump("settledHouse", now);
  else if (houseSide === 1) bump("settledMixed", now);
}

export function recordAgentCreated(now = Date.now()) {
  bump("agentsCreated", now);
}

export function recordVerificationRejected(now = Date.now()) {
  bump("verificationsRejected", now);
}

export interface StatsSnapshot {
  /** Arranque del proceso actual (ms epoch). */
  startedAt: number;
  /** Uptime del proceso actual, en segundos. */
  uptimeSeconds: number;
  /** Desde cuándo acumulan los totales (ms epoch). */
  since: number;
  totals: Counters;
  today: Counters;
  /** Agentes hosteados activos (en vivo; inyectado al servir). */
  activeAgents: number;
  /** Detalle por día (ascendente por fecha), para el desglose de la página. */
  daily: Array<{ date: string } & Counters>;
}

/** Foto de las métricas para /stats. `activeAgents` se inyecta (vive en
 *  agents.ts). `now` es inyectable para tests. */
export function statsSnapshot(activeAgents: number, now = Date.now()): StatsSnapshot {
  const today = data.daily[dayKey(now)] ?? {};
  const daily = Object.keys(data.daily)
    .sort()
    .map((date) => ({ date, ...zeros(), ...data.daily[date] }));
  return {
    startedAt: processStartedAt,
    uptimeSeconds: Math.max(0, Math.floor((now - processStartedAt) / 1000)),
    since: data.firstRecordedAt,
    totals: { ...data.totals },
    today: { ...zeros(), ...today },
    activeAgents,
    daily,
  };
}

/** Restaura las métricas guardadas. La llama index.ts ANTES de escuchar. */
export async function restoreStats(): Promise<void> {
  const raw = await store$.load();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<StatsData>;
    data = {
      totals: { ...zeros(), ...parsed.totals },
      daily: parsed.daily ?? {},
      firstRecordedAt: parsed.firstRecordedAt ?? Date.now(),
    };
    pruneDaily();
    console.log(`Métricas recuperadas: ${data.totals.matchesCreated} partidas creadas`);
  } catch (e) {
    console.error("stats restore (dato corrupto, arrancamos limpio):", (e as Error).message);
  }
}

/** Reinicia el estado en memoria (solo tests). `startedAt` fija el arranque del
 *  proceso para un uptime determinista. */
export function __resetStatsForTest(startedAt = Date.now()) {
  processStartedAt = startedAt;
  data = { totals: zeros(), daily: {}, firstRecordedAt: startedAt };
}
