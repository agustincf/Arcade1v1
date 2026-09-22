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

import { createHmac, timingSafeEqual } from "node:crypto";
import { handoverEnabled } from "./persist.js";
import {
  INSTANCE_ID,
  acquireLease,
  classifyLease,
  confirmHolder,
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
  /** Toca el timbre de la vieja para la época `forEpoch`: true si respondió
   *  202. El pedido va firmado (ver doorbellToken) y TIRA si la vieja no
   *  contestó 202 (otro status, red caída o timeout): el llamador decide qué
   *  hacer con eso. */
  ringDoorbell: (forEpoch: number) => Promise<boolean>;
  /** Guarda todos los stores; rechaza si alguno falló (persist.ts). */
  flushAll: () => Promise<void>;
  startJobs: () => void;
  stopJobs: (capMs: number) => Promise<string[]>;
  waitForIdle: (capMs: number) => Promise<boolean>;
  log: (msg: string) => void;
  /** Termina el proceso (Render lo reinicia). */
  exit: (code: number) => void;
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

/** Antes de tomar una posta clasificada VENCIDA (stale) que tiene registro
 *  (una dueña real cuyo latido envejeció, no una época huérfana), primero le
 *  toca el timbre. Después de una caída de Upstash de más de LEASE_STALE_MS,
 *  una vieja VIVA puede parecer vencida (sus latidos no pudieron llegar), y si
 *  CONTESTA el timbre es la prueba de que sigue viva: hay que esperar a que
 *  SUELTE su época — tomársela apenas sabemos que está viva sería el mismo
 *  error que el timbre vino a evitar. Si no contesta, se toma directo (está
 *  realmente muerta). Una época vencida SIN registro (huérfana), y
 *  "none"/"released", se toman directo, como siempre — por eso `label` es lo
 *  que devuelve cada sitio cuando el timbre no aplica o no lo contestan.
 *
 *  Devuelve `null` cuando TODAVÍA no hay que tomarla: la dueña volvió a latir
 *  (sigue "held", por ejemplo abortó su entrega porque falló el guardado) o
 *  cambió la época (otra instancia se movió en el medio). El llamador sigue
 *  su flujo normal — típicamente termina en respaldo — hasta que la posta
 *  quede libre de verdad. */
async function takeFree(
  d: HandoverDeps,
  t: HandoverTiming,
  view: LeaseView,
  status: Free,
  label: TakeoverOutcome,
): Promise<TakeoverOutcome | null> {
  if (status === "stale" && view.epoch !== null && view.record !== null && d.doorbellConfigured) {
    const epoch = view.epoch;
    await retrying(d, "pedir la posta", () => requestHandover(epoch));
    const accepted = await d.ringDoorbell(epoch).catch((e) => {
      d.log(`Traspaso: el timbre no fue aceptado (${(e as Error).message})`);
      return false;
    });
    if (accepted) {
      // La dueña contestó: sigue viva y entregando. Esperar a que SUELTE su
      // época — nunca tomarle la posta a una dueña que acaba de contestar
      // que está viva.
      let cur: { view: LeaseView; status: LeaseStatus } = { view, status };
      const t0 = d.now();
      while (
        d.now() - t0 < t.releaseWaitMs &&
        cur.view.epoch === epoch &&
        cur.status !== "released"
      ) {
        await d.sleep(t.pollMs);
        cur = await look(d);
      }
      if (cur.view.epoch === epoch && cur.status === "released") {
        await take(d, cur.view);
        return "doorbell";
      }
      if (cur.view.epoch !== epoch) return null; // otra instancia se movió en el medio
      if (cur.status === "held") return null; // volvió a latir: sigue viva
      // Misma época, todavía vencida después de esperar: aceptó el timbre
      // pero quedó colgada a mitad de la entrega. Se toma igual.
      await take(d, cur.view);
      return label;
    }
  }
  await take(d, view);
  return label;
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
    const got = await takeFree(d, t, first.view, first.status, first.status);
    if (got) return got;
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
      const got = await takeFree(d, t, cur.view, cur.status, "fallback");
      if (got) return got;
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
    accepted = await d.ringDoorbell(epoch).catch((e) => {
      d.log(`Traspaso: el timbre no fue aceptado (${(e as Error).message})`);
      return false;
    });
    if (accepted) break;
    const cur = await look(d);
    if (isFree(cur.status)) {
      const got = await takeFree(d, t, cur.view, cur.status, cur.status);
      if (got) return got;
    }
    await d.sleep(t.doorbellEveryMs);
  }
  if (!accepted) return null;
  const t1 = d.now();
  while (d.now() - t1 < t.releaseWaitMs) {
    // Primero esperar: la vieja necesita un momento para frenar y guardar.
    await d.sleep(t.pollMs);
    const cur = await look(d);
    if (cur.view.epoch === epoch) {
      // La vieja aceptó el timbre: está entregando. Mientras siga en SU época
      // solo se espera a que suelte, aunque su registro venza en el medio (sus
      // latidos pudieron no llegar a Upstash): acaba de contestar que está
      // viva. Volver a tocarle el timbre daba 429 (un toque cada 2 s), eso se
      // leía como "no contesta" y se le tomaba la posta antes de su guardado
      // final.
      if (cur.status === "released") {
        await take(d, cur.view);
        return "doorbell";
      }
      continue;
    }
    if (isFree(cur.status)) {
      const got = await takeFree(d, t, cur.view, cur.status, "doorbell");
      if (got) return got;
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
  // PERDIÓ LA POSTA A MITAD DE LA ENTREGA (el latido o el chequeo antes de
  // escribir vieron otra época): el cerco ya la puso en "fenced". No hay nada que
  // soltar ni retomar, y sobre todo no hay que volver a "ready": otra instancia
  // es la dueña.
  let releasedOk = false;
  const lost = () => getMode() === "fenced" || (!releasedOk && !isHolder());
  let saved = false;
  for (let i = 0; i < t.flushTries && !saved && !lost(); i++) {
    try {
      await d.flushAll();
      saved = true;
    } catch (e) {
      d.log(`Entrega: falló el guardado (${(e as Error).message})`);
      if (i + 1 < t.flushTries && !lost()) await d.sleep(1_000);
    }
  }
  if (saved && !lost()) {
    try {
      await releaseLease();
      releasedOk = true;
    } catch (e) {
      saved = false;
      d.log(`Entrega: no pude soltar la posta (${(e as Error).message})`);
    }
  }
  if (lost()) {
    d.log("⚠️ Entrega: la posta se perdió a mitad de camino; la instancia queda cercada");
    return "not-holder";
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

/** Después de entregar por el timbre, la vieja sigue mirando la posta mientras
 *  esté entregada. Si la nueva se cae antes de tomarla (o la toma y la suelta sin
 *  haber cargado, como en un deploy cancelado), Render le sigue mandando el
 *  tráfico a esta instancia, que respondería 503 para siempre. Si la posta queda
 *  LIBRE (soltada, vencida o sin registro) durante `resumeAfterMs` seguidos:
 *   - si nadie la tomó después (sigue la época propia), la retoma sin recargar:
 *     su memoria es la última versión y nadie escribió después;
 *   - si pasó otra época por el medio, alguien pudo haber escrito: sale con 1
 *     para que Render la reinicie y cargue el estado de nuevo.
 *  Un error de Upstash no la hace rendirse: sigue mirando. */
async function watchForResume(epoch: number, d: HandoverDeps, t: HandoverTiming): Promise<void> {
  let freeSince: number | null = null;
  while (getMode() === "released") {
    await d.sleep(t.resumePollMs);
    if (getMode() !== "released") return;
    let view: LeaseView;
    try {
      view = await readLease();
    } catch (e) {
      d.log(`No pude mirar la posta para retomarla (${(e as Error).message}); sigo mirando`);
      continue;
    }
    if (!isFree(classifyLease(view, d.now()))) {
      freeSince = null; // otra instancia la tiene viva
      continue;
    }
    freeSince ??= d.now();
    if (d.now() - freeSince < t.resumeAfterMs) continue;
    if (view.epoch !== epoch) {
      d.log(
        `La posta quedó libre en la época ${view.epoch} (la mía era ${epoch}): ` +
          "salgo para que Render me reinicie y cargue el estado de nuevo",
      );
      d.exit(1);
      return;
    }
    if (getMode() !== "released") return;
    try {
      await acquireLease(view);
      // Tomar y confirmar no es atómico: si otra instancia sacó una época MÁS
      // ALTA en el medio, gana ella y esta instancia SIGUE MIRANDO (no se
      // cerca: seguimos en "released", no en "ready", así que installFence no
      // hace nada). Si esa instancia se cae antes de declararse sana, la posta
      // vuelve a quedar libre en OTRA época, y el chequeo de arriba
      // (`view.epoch !== epoch`) nos hace salir con 1 para recargar. Un error
      // de red al confirmar no es evidencia de haberla perdido: seguimos
      // mirando.
      if (!(await confirmHolder().catch(() => true))) continue;
      startLeaseHeartbeat();
      setMode("ready");
      d.startJobs();
      d.log(`Retomé la posta (época ${myEpoch()}): la instancia nueva no apareció`);
      return;
    } catch (e) {
      d.log(`No pude retomar la posta (${(e as Error).message}); reintento`);
    }
  }
}

// ---- El timbre ---------------------------------------------------------------

let lastRing = 0;

/** Firma del timbre: HMAC-SHA256 con el token de Upstash (que nadie de afuera
 *  tiene) sobre la época pedida y el momento. Sin esta firma cualquiera podía
 *  tocar `/internal/handover` y gastarnos el cupo gratis de Upstash con una
 *  lectura por toque. */
export function doorbellToken(forEpoch: number, ts: number): string {
  return createHmac("sha256", process.env.UPSTASH_REDIS_REST_TOKEN ?? "")
    .update(`arcade-handover:${forEpoch}:${ts}`)
    .digest("hex");
}

function validDoorbellToken(forEpoch: number, ts: number, token: string): boolean {
  const expected = Buffer.from(doorbellToken(forEpoch, ts));
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface DoorbellBody {
  forEpoch?: unknown;
  ts?: unknown;
  token?: unknown;
}

/** POST /internal/handover: la nueva pide la posta. El timbre va firmado (ver
 *  doorbellToken): sin una firma válida, 403 ANTES de tocar Redis, para que un
 *  tercero no pueda gastarnos el cupo llamando a lo loco. La autoridad de
 *  FONDO sigue en Redis: el pedido que escribió la nueva. Como mucho, un
 *  toque cada `doorbellMinGapMs`. */
export async function answerDoorbell(
  d: HandoverDeps,
  body: DoorbellBody,
  t: HandoverTiming = HANDOVER_TIMING,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { forEpoch, ts, token } = body ?? {};
  if (
    typeof forEpoch !== "number" ||
    !Number.isFinite(forEpoch) ||
    typeof ts !== "number" ||
    !Number.isFinite(ts) ||
    Math.abs(d.now() - ts) > t.requestMaxAgeMs ||
    typeof token !== "string" ||
    !validDoorbellToken(forEpoch, ts, token)
  ) {
    return { status: 403, body: { accepted: false } };
  }
  const mode = getMode();
  const active = mode === "ready" && isHolder();
  const handingOver = mode === "draining" || mode === "released";
  if (!active && !handingOver) return { status: 409, body: { accepted: false, mode } };
  if (forEpoch !== myEpoch()) return { status: 409, body: { accepted: false, mode } };
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
  if (active)
    void handOver("doorbell", d, t).catch((e) =>
      d.log(`Entrega por timbre: ${(e as Error).message}`),
    );
  return { status: 202, body: { accepted: true, epoch } };
}

/** Toca el timbre por la URL pública del servicio: mientras la nueva no está
 *  sana, Render solo enruta a la vieja. El pedido lleva la firma de
 *  doorbellToken. Si la vieja no contesta 202 (otro status, red caída,
 *  timeout), TIRA: el llamador decide qué hacer con eso. */
export function doorbellAt(baseUrl: string | undefined): (forEpoch: number) => Promise<boolean> {
  return async (forEpoch) => {
    if (!baseUrl) return false;
    const ts = Date.now();
    const r = await fetch(`${baseUrl.replace(/\/+$/, "")}${HANDOVER_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forEpoch, ts, token: doorbellToken(forEpoch, ts) }),
      signal: AbortSignal.timeout(5_000),
    });
    if (r.status !== 202) throw new Error(`el timbre respondió HTTP ${r.status}`);
    return true;
  };
}

// ---- Cerco y apagado ---------------------------------------------------------

/** Si esta instancia descubre que perdió la posta sin haberla entregado, se
 *  cerca: frena sus relojes y /health da 503 para que Render la reinicie. */
export function installFence(d: HandoverDeps): void {
  onLeaseLost(() => {
    if (getMode() === "released") return;
    setMode("fenced");
    void d
      .stopJobs(HANDOVER_TIMING.drainCapMs)
      .catch((e) => d.log(`Cerco: ${(e as Error).message}`));
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

/** Después de cargar el estado: ¿esta instancia sigue siendo la dueña? Un
 *  error de red al preguntar no es evidencia de haberla perdido, y abortar ahí
 *  tiraba un arranque que ya había cargado todo: se reintenta unas veces antes
 *  de rendirse. Un "no" (otra época) no se reintenta: el cerco ya actuó. */
export async function confirmAfterLoad(d: HandoverDeps, tries = 4): Promise<boolean> {
  for (let i = 1; ; i++) {
    try {
      return await confirmHolder();
    } catch (e) {
      if (i >= tries) throw e;
      d.log(`Traspaso: falló confirmar la posta (${(e as Error).message}); reintento`);
      await d.sleep(500 * 2 ** (i - 1));
    }
  }
}

/** El arranque falló DESPUÉS de tomar la posta (por ejemplo, Upstash se cayó
 *  mientras se cargaba el estado). Se suelta antes de salir: si no, la posta
 *  quedaba "active" con un latido fresco, y la próxima instancia la veía viva,
 *  le tocaba el timbre a nadie y esperaba 3 min a que venciera. No se guarda
 *  nada: esta instancia no llegó a atender. */
export async function abortStartup(e: unknown, d: HandoverDeps): Promise<void> {
  d.log(`❌ El arranque falló: ${(e as Error)?.message ?? String(e)}`);
  if (handoverEnabled && isHolder()) {
    try {
      await releaseLease();
    } catch (e2) {
      d.log(`❌ Y no pude soltar la posta (${(e2 as Error).message}): vence sola en 3 min`);
    }
  }
  d.exit(1);
}

export function installShutdown(d: HandoverDeps): void {
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      void shutdown(sig, d).finally(() => d.exit(0));
    });
  }
}

/** Tests: volver al estado de recién arrancada (el timbre y la entrega en curso). */
export function resetHandoverForTests(): void {
  lastRing = 0;
  draining = null;
}
