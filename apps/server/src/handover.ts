// EL TRASPASO ENTRE INSTANCIAS en un deploy de Render (spec:
// docs/superpowers/specs/2026-09-18-traspaso-con-timbre-design.md).
//
// Render arranca la instancia nueva, le pasa el tráfico cuando pasa el health
// check y recién 60 s DESPUÉS le manda SIGTERM a la vieja. Por eso la nueva no
// espera ese SIGTERM: no se declara sana (/health 503, ver readiness.ts) hasta
// tener el estado, y mientras tanto le TOCA EL TIMBRE a la vieja con un pedido a
// la URL pública del servicio, que en ese momento solo puede llegarle a la
// vieja. La vieja frena sus relojes, termina lo que tenía en curso, guarda todo
// y suelta la posta; la nueva la toma, carga y recién ahí se declara sana.
//
// Si el timbre no llega (el primer deploy desde el PR #33, o una vieja que no
// contesta), la nueva pasa a RESPALDO: /health en 200 para que Render pase el
// tráfico y apague a la vieja, que entrega igual en su SIGTERM. Nunca se toma la
// posta de una dueña viva: solo si está soltada, vencida o no existe.

import { handoverEnabled } from "./persist.js";
import {
  INSTANCE_ID,
  acquireLease,
  classifyLease,
  currentEpoch,
  isHolder,
  myEpoch,
  onLeaseLost,
  readHandoverRequest,
  readLease,
  releaseLease,
  requestHandover,
  startLeaseHeartbeat,
  type LeaseStatus,
  type LeaseView,
} from "./lease.js";
import { HANDOVER_PATH, getMode, setMode } from "./readiness.js";

export interface HandoverDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** ¿Hay adónde tocar el timbre? (RENDER_EXTERNAL_URL o HANDOVER_URL). */
  doorbellConfigured: boolean;
  /** Toca el timbre de la vieja: true si respondió 202. */
  ringDoorbell: () => Promise<boolean>;
  /** Guarda todos los stores; rechaza si alguno falló (persist.ts). */
  flushAll: () => Promise<void>;
  startJobs: () => void;
  stopJobs: (capMs: number) => Promise<string[]>;
  waitForIdle: (capMs: number) => Promise<boolean>;
  log: (msg: string) => void;
}

export interface HandoverTiming {
  pollMs: number;
  doorbellEveryMs: number;
  acceptWaitMs: number;
  releaseWaitMs: number;
  fallbackPollMs: number;
  drainCapMs: number;
  flushTries: number;
  resumeAfterMs: number;
  resumePollMs: number;
  doorbellMinGapMs: number;
  requestMaxAgeMs: number;
}

const envMs = (k: string, def: number): number => {
  const n = Number(process.env[k]);
  return Number.isFinite(n) && n > 0 ? n : def;
};

export const HANDOVER_TIMING: HandoverTiming = {
  pollMs: envMs("HANDOVER_POLL_MS", 500),
  doorbellEveryMs: 5_000,
  acceptWaitMs: envMs("HANDOVER_ACCEPT_WAIT_MS", 30_000),
  releaseWaitMs: 30_000,
  fallbackPollMs: 1_000,
  drainCapMs: 10_000,
  flushTries: 3,
  resumeAfterMs: envMs("HANDOVER_RESUME_MS", 90_000),
  resumePollMs: 2_000,
  doorbellMinGapMs: 2_000,
  requestMaxAgeMs: 60_000,
};

export type TakeoverOutcome = "off" | "none" | "released" | "stale" | "doorbell" | "fallback";
type Free = "none" | "released" | "stale";

const isFree = (s: LeaseStatus): s is Free => s === "none" || s === "released" || s === "stale";

/** Reintenta un paso contra Upstash: un error pasajero no tira el arranque. Si
 *  Upstash sigue caído, la nueva nunca se declara sana y Render cancela el
 *  deploy a los 15 min, con la vieja atendiendo. */
async function retrying<T>(d: HandoverDeps, what: string, fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      d.log(`Traspaso: falló ${what} (${(e as Error).message}); reintento`);
      await d.sleep(Math.min(5_000, 500 * 2 ** i));
    }
  }
}

async function look(d: HandoverDeps): Promise<{ view: LeaseView; status: LeaseStatus }> {
  const view = await retrying(d, "leer la posta", readLease);
  return { view, status: classifyLease(view, d.now()) };
}

async function take(d: HandoverDeps, view: LeaseView): Promise<void> {
  await retrying(d, "tomar la posta", () => acquireLease(view));
}

// ---- La nueva ----------------------------------------------------------------

/** LA NUEVA: consigue la posta. Al volver, esta instancia es la dueña. */
export async function takeOver(
  d: HandoverDeps,
  t: HandoverTiming = HANDOVER_TIMING,
): Promise<TakeoverOutcome> {
  if (!handoverEnabled) return "off";
  const first = await look(d);
  if (isFree(first.status)) {
    await take(d, first.view);
    return first.status;
  }
  if (first.status === "held" && first.view.epoch !== null && d.doorbellConfigured) {
    const got = await viaDoorbell(d, t, first.view.epoch);
    if (got) return got;
  }
  // RESPALDO, sin tope ciego: /health en 200 para que Render pase el tráfico y
  // le mande el SIGTERM a la vieja, que entrega igual que con el timbre.
  setMode("fallback");
  d.log("Traspaso: respaldo (esperando el SIGTERM de la vieja)");
  for (;;) {
    await d.sleep(t.fallbackPollMs);
    const cur = await look(d);
    if (isFree(cur.status)) {
      await take(d, cur.view);
      return "fallback";
    }
  }
}

async function viaDoorbell(
  d: HandoverDeps,
  t: HandoverTiming,
  epoch: number,
): Promise<TakeoverOutcome | null> {
  await retrying(d, "pedir la posta", () => requestHandover(epoch));
  const t0 = d.now();
  let accepted = false;
  while (d.now() - t0 < t.acceptWaitMs) {
    accepted = await d.ringDoorbell().catch(() => false);
    if (accepted) break;
    const cur = await look(d);
    if (isFree(cur.status)) {
      await take(d, cur.view);
      return cur.status;
    }
    await d.sleep(t.doorbellEveryMs);
  }
  if (!accepted) return null;
  const t1 = d.now();
  while (d.now() - t1 < t.releaseWaitMs) {
    // Primero esperar: la vieja necesita un momento para frenar y guardar.
    await d.sleep(t.pollMs);
    const cur = await look(d);
    if (isFree(cur.status)) {
      await take(d, cur.view);
      return "doorbell";
    }
  }
  return null;
}

// ---- La vieja ----------------------------------------------------------------

export type HandoverResult = "released" | "aborted" | "not-holder";

let draining: Promise<HandoverResult> | null = null;

/** LA VIEJA: entrega la posta, por el timbre o por SIGTERM. Si ya estaba
 *  entregando, devuelve ESA entrega (no guarda dos veces). */
export function handOver(
  reason: "doorbell" | "sigterm",
  d: HandoverDeps,
  t: HandoverTiming = HANDOVER_TIMING,
): Promise<HandoverResult> {
  if (draining) return draining;
  if (getMode() === "released") return Promise.resolve("released");
  if (!isHolder()) return Promise.resolve("not-holder");
  draining = drain(reason, d, t).finally(() => {
    draining = null;
  });
  return draining;
}

async function drain(
  reason: "doorbell" | "sigterm",
  d: HandoverDeps,
  t: HandoverTiming,
): Promise<HandoverResult> {
  const t0 = d.now();
  const epoch = myEpoch();
  setMode("draining");
  const late = await d.stopJobs(t.drainCapMs);
  if (late.length) d.log(`Entrega: relojes que no terminaron a tiempo: ${late.join(", ")}`);
  if (!(await d.waitForIdle(t.drainCapMs))) d.log("Entrega: quedaron pedidos en curso; sigo igual");
  let saved = false;
  for (let i = 0; i < t.flushTries && !saved; i++) {
    try {
      await d.flushAll();
      saved = true;
    } catch (e) {
      d.log(`Entrega: falló el guardado (${(e as Error).message})`);
      if (i + 1 < t.flushTries) await d.sleep(1_000);
    }
  }
  if (saved) {
    try {
      await releaseLease();
    } catch (e) {
      saved = false;
      d.log(`Entrega: no pude soltar la posta (${(e as Error).message})`);
    }
  }
  if (!saved) {
    // Soltar sin haber guardado haría cargar a la nueva un estado viejo: mejor
    // seguir atendiendo con la posta. La nueva espera (o pasa a respaldo).
    startLeaseHeartbeat();
    setMode("ready");
    d.startJobs();
    d.log("⚠️ Entrega abortada: sigo atendiendo con la posta");
    return "aborted";
  }
  setMode("released");
  d.log(
    `Entregué la posta (época ${epoch}, por ${reason === "sigterm" ? "SIGTERM" : "timbre"}): ` +
      `relojes frenados, guardado en ${d.now() - t0} ms`,
  );
  if (reason === "doorbell" && epoch !== null) void watchForResume(epoch, d, t);
  return "released";
}

/** Si la nueva se cae después del timbre y antes de tomar la posta, Render no le
 *  pasó el tráfico y esta instancia quedaría respondiendo 503 para siempre: a
 *  los `resumeAfterMs` sin que nadie la tome, la retoma. Su memoria es la última
 *  versión y nadie escribió después, así que no recarga. */
async function watchForResume(epoch: number, d: HandoverDeps, t: HandoverTiming): Promise<void> {
  const t0 = d.now();
  while (d.now() - t0 < t.resumeAfterMs) {
    await d.sleep(t.resumePollMs);
    if (getMode() !== "released") return;
    // Si Upstash falla, seguir mirando.
    const cur = await currentEpoch().catch(() => epoch);
    if (cur !== epoch) return; // la nueva ya la tomó
  }
  if (getMode() !== "released") return;
  try {
    if ((await currentEpoch()) !== epoch) return;
    await acquireLease();
    startLeaseHeartbeat();
    setMode("ready");
    d.startJobs();
    d.log(`Retomé la posta (época ${myEpoch()}): la instancia nueva no apareció`);
  } catch (e) {
    d.log(`No pude retomar la posta: ${(e as Error).message}`);
  }
}

// ---- El timbre ---------------------------------------------------------------

let lastRing = 0;

/** POST /internal/handover: la nueva pide la posta. La autoridad está en Redis
 *  (el pedido que escribió la nueva); el timbre solo avisa que hay que mirarlo,
 *  así que no lleva secreto. Como mucho, un toque cada `doorbellMinGapMs`. */
export async function answerDoorbell(
  d: HandoverDeps,
  t: HandoverTiming = HANDOVER_TIMING,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const mode = getMode();
  const active = mode === "ready" && isHolder();
  const handingOver = mode === "draining" || mode === "released";
  if (!active && !handingOver) return { status: 409, body: { accepted: false, mode } };
  const now = d.now();
  if (now - lastRing < t.doorbellMinGapMs) return { status: 429, body: { accepted: false } };
  lastRing = now;
  const req = await readHandoverRequest();
  const epoch = myEpoch();
  if (
    !req ||
    req.forEpoch !== epoch ||
    req.by === INSTANCE_ID ||
    now - req.at > t.requestMaxAgeMs
  ) {
    return { status: 409, body: { accepted: false, mode } };
  }
  if (active) void handOver("doorbell", d, t);
  return { status: 202, body: { accepted: true, epoch } };
}

/** Toca el timbre por la URL pública del servicio: mientras la nueva no está
 *  sana, Render solo enruta a la vieja. */
export function doorbellAt(baseUrl: string | undefined): () => Promise<boolean> {
  return async () => {
    if (!baseUrl) return false;
    const r = await fetch(`${baseUrl.replace(/\/+$/, "")}${HANDOVER_PATH}`, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    });
    return r.status === 202;
  };
}

// ---- Cerco y apagado ---------------------------------------------------------

/** Si esta instancia descubre que perdió la posta sin haberla entregado, se
 *  cerca: frena sus relojes y /health da 503 para que Render la reinicie. */
export function installFence(d: HandoverDeps): void {
  onLeaseLost(() => {
    if (getMode() === "released") return;
    setMode("fenced");
    void d.stopJobs(HANDOVER_TIMING.drainCapMs);
    d.log("⚠️ Instancia cercada: otra tomó la posta. /health da 503 para que Render la reinicie.");
  });
}

/** SIGTERM/SIGINT. Con traspaso: la dueña entrega (igual que con el timbre).
 *  Una instancia que nunca terminó de arrancar pero alcanzó a tomar la posta la
 *  suelta SIN guardar: no cargó nada que valga más que lo que ya está en Redis.
 *  Sin traspaso (dev con archivo): guardar todo. */
export async function shutdown(sig: string, d: HandoverDeps): Promise<void> {
  try {
    if (!handoverEnabled) {
      await d.flushAll();
      return;
    }
    const mode = getMode();
    if (mode === "ready" || mode === "draining") {
      d.log(`Apagado (${sig}): ${await handOver("sigterm", d)}`);
      return;
    }
    if ((mode === "starting" || mode === "fallback") && isHolder()) await releaseLease();
  } catch (e) {
    d.log(`Apagado (${sig}): ${(e as Error).message}`);
  }
}

export function installShutdown(
  d: HandoverDeps,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      void shutdown(sig, d).finally(() => exit(0));
    });
  }
}
