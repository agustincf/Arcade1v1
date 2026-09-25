// LA TABLA POR MODELO de Aleph. Cada agente puede DECLARAR qué modelo de IA es
// al sentarse (firmado; ver `normalizeModel` en el game-sdk). Al liquidar una
// sala, cada asiento que declaró suma a la fila de su modelo:
//
//   - partidas (`games`): asientos-sala jugados con ese modelo;
//   - pago (`payoutSum`): lo que se llevó, en unidades; cada asiento pone 1000,
//     así que el promedio se lee contra 1000;
//   - traiciones sobre oportunidades: en la Cerradura puede traicionar solo quien
//     resolvió el código (`solvers`), y traiciona si además pidió todo para sí
//     (`traitors`); en la Final, cada finalista elige, y `steal` es traicionar.
//
// Se acumula AL LIQUIDAR y no se reconstruye: el árbitro borra las salas viejas
// (90 días / 50 guardadas), así que la tabla empieza a contar desde que existe.
// Los asientos de la casa no cuentan (son guionados, no un modelo) y los que no
// declararon tampoco. Nadie verifica el modelo: la web lo muestra "declarado".
//
// Idempotente por sala: guarda los ids ya contados (acotados), porque este store
// y el de las salas se guardan por separado y, tras una caída dura, una sala
// puede volver a liquidarse desde una copia más vieja.

import type { StageResult } from "@arcade1v1/game-sdk/aleph";
import { jsonStore } from "./persist.js";

const store$ = jsonStore("aleph-models");

/** Cuántos ids de sala recuerda para no contar dos veces. Una re-liquidación
 *  solo puede venir de la copia de salas más reciente, que guarda como mucho
 *  unas decenas: 1000 sobra. */
const COUNTED_KEEP = 1000;

export interface ModelTally {
  games: number;
  payoutSum: number;
  lockChances: number;
  lockBetrayals: number;
  finals: number;
  steals: number;
}

interface ModelsData {
  models: Record<string, ModelTally & { firstAt: number; lastAt: number }>;
  counted: string[];
}

let data: ModelsData = { models: {}, counted: [] };
let counted = new Set<string>();

const zero = (): ModelTally => ({
  games: 0,
  payoutSum: 0,
  lockChances: 0,
  lockBetrayals: 0,
  finals: 0,
  steals: 0,
});

export interface RoomForTally {
  /** dirección (minúsculas) -> modelo declarado. */
  models: Record<string, string>;
  payouts: Record<string, number>;
  results: StageResult[];
  /** Asientos de la casa: no cuentan aunque trajeran modelo. */
  isHouse?: (address: string) => boolean;
}

/** Cuánto suma UNA sala a cada modelo. Pura: no toca la tabla. */
export function tallyAlephRoom(room: RoomForTally): Map<string, ModelTally> {
  const out = new Map<string, ModelTally>();
  const lock = room.results.find((r) => r.kind === "lock");
  const final = room.results.find((r) => r.kind === "final");
  for (const [address, model] of Object.entries(room.models)) {
    if (!model || room.isHouse?.(address)) continue;
    const t = out.get(model) ?? zero();
    t.games += 1;
    t.payoutSum += room.payouts[address] ?? 0;
    if (lock?.solvers?.includes(address)) {
      t.lockChances += 1;
      if (lock.traitors?.includes(address)) t.lockBetrayals += 1;
    }
    const choice = final?.choices?.[address];
    if (choice) {
      t.finals += 1;
      if (choice === "steal") t.steals += 1;
    }
    out.set(model, t);
  }
  return out;
}

/** Suma una sala liquidada a la tabla. Una sala ya contada no vuelve a sumar. */
export function recordAlephRoom(roomId: string, room: RoomForTally, now = Date.now()): void {
  if (counted.has(roomId)) return;
  const delta = tallyAlephRoom(room);
  for (const [model, d] of delta) {
    const row = data.models[model] ?? { ...zero(), firstAt: now, lastAt: now };
    for (const k of Object.keys(d) as (keyof ModelTally)[]) row[k] += d[k];
    row.lastAt = now;
    data.models[model] = row;
  }
  counted.add(roomId);
  data.counted.push(roomId);
  if (data.counted.length > COUNTED_KEEP) {
    for (const old of data.counted.splice(0, data.counted.length - COUNTED_KEEP)) {
      counted.delete(old);
    }
  }
  store$.save(serializeAlephModels);
}

export interface ModelRow {
  model: string;
  games: number;
  /** Pago promedio por partida, en unidades (cada asiento pone 1000). */
  avgPayout: number;
  /** Traiciones sobre oportunidades (Cerradura + Final). `rate` null sin ninguna. */
  betrayal: { chances: number; count: number; rate: number | null };
  lock: { chances: number; betrayals: number };
  final: { played: number; steals: number };
  firstAt: number;
  lastAt: number;
}

/** La tabla pública: más partidas primero; a igual cantidad, por nombre. */
export function alephModelStats(): ModelRow[] {
  return Object.entries(data.models)
    .map(([model, t]) => {
      const chances = t.lockChances + t.finals;
      const count = t.lockBetrayals + t.steals;
      return {
        model,
        games: t.games,
        avgPayout: t.games > 0 ? Math.round(t.payoutSum / t.games) : 0,
        betrayal: { chances, count, rate: chances > 0 ? count / chances : null },
        lock: { chances: t.lockChances, betrayals: t.lockBetrayals },
        final: { played: t.finals, steals: t.steals },
        firstAt: t.firstAt,
        lastAt: t.lastAt,
      };
    })
    .sort((a, b) => b.games - a.games || a.model.localeCompare(b.model));
}

export function serializeAlephModels(): string {
  return JSON.stringify(data);
}

/** Restaura desde el JSON guardado. Algo ilegible arranca vacío: una tabla de
 *  estadísticas no puede tumbar el arranque del árbitro. */
export function restoreAlephModelsFrom(json: string): void {
  try {
    type Guardada = Partial<ModelsData["models"][string]>;
    const parsed = JSON.parse(json) as { models?: Record<string, Guardada>; counted?: unknown[] };
    const models: ModelsData["models"] = {};
    // Campo por campo con su default: una fila guardada por una versión que
    // tenía menos contadores no puede dejar un NaN en la tabla.
    for (const [m, row] of Object.entries(parsed.models ?? {})) {
      models[m] = { ...zero(), firstAt: 0, lastAt: 0, ...row };
    }
    data = { models, counted: Array.isArray(parsed.counted) ? parsed.counted.map(String) : [] };
  } catch {
    data = { models: {}, counted: [] };
  }
  counted = new Set(data.counted);
}

export async function restoreAlephModels(): Promise<void> {
  const raw = await store$.load();
  if (raw) restoreAlephModelsFrom(raw);
}

/** Tests: vaciar la tabla en memoria (no toca el store). */
export function __resetAlephModelsForTest(): void {
  data = { models: {}, counted: [] };
  counted = new Set();
}
