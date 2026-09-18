// Persistencia clave→JSON del árbitro, con dos backends:
//
//  - REDIS (Upstash por REST): para hosting con disco EFÍMERO (Render, Railway…)
//    donde cada deploy/reinicio borra el filesystem — sin esto se perdían todos
//    los agentes hosteados (¡con sus claves!), el ranking ELO y las partidas.
//    Se activa solo con las dos variables: UPSTASH_REDIS_REST_URL y
//    UPSTASH_REDIS_REST_TOKEN. Va por fetch puro (sin dependencia npm).
//
//  - ARCHIVO local en apps/server/data/ (dev, o hosting con disco persistente):
//    el comportamiento histórico, JSON atómico (tmp + rename).
//
// Es OPT-IN (lo enciende persist-on.ts, que solo importa el servidor real):
// tests y e2e corren sin tocar disco ni red, herméticos. Antes agents.ts y
// ratings.ts persistían SIEMPRE y los tests pisaban los datos reales.

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export type PersistenceBackend = "redis" | "file" | "off";

/** Qué backend le toca a ESE entorno. Esta función es la única definición de la
 *  regla: el módulo la aplica sobre `process.env` acá abajo, y config-guard la
 *  evalúa sobre el env que le pasen para exigir Redis cuando hay mesas de plata
 *  encendidas — un host de disco efímero no debería descubrirse en el primer
 *  deploy que borra las salas, sino al arrancar. */
export function persistenceBackendFor(env: NodeJS.ProcessEnv): PersistenceBackend {
  const enabled = env.ARCADE_PERSIST === "1" || env.ARCADE_PERSIST_MATCHES === "1";
  if (!enabled) return "off";
  const url = (env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/+$/, "");
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? "";
  return url && token ? "redis" : "file";
}

export const persistenceBackend = persistenceBackendFor(process.env);
const ENABLED = persistenceBackend !== "off";
const USE_REDIS = persistenceBackend === "redis";
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/+$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
// AGRUPADOR DE ESCRITURAS. Cada escritura sube el blob ENTERO del store (~1,3 MB
// en el caso de las partidas, que llevan los replays adentro), así que la
// frecuencia se paga en ancho de banda de salida: con 500 ms, una sola partida
// —que dispara media docena de persist() en pocos segundos— costaba varias
// subidas del blob completo. Eso fundió los 5 GB incluidos de Render en
// septiembre de 2026 (8,57 GB consumidos, 100% "Service-Initiated").
//
// Con 20 s, una partida entera se agrupa en UNA escritura. Lo que se arriesga a
// cambio: si el proceso muere de golpe (crash/OOM, no un redeploy —ese manda
// SIGTERM y dispara el flush de más abajo) se pierden hasta 20 s de cambios en
// las partidas en curso. El dinero no: vive en el escrow on-chain.
//
// Lo que NO puede esperar al debounce se guarda con `flush()` en el acto: la
// tabla de pagos firmada de una mesa de plata de Aleph (ver `settleOnchain` en
// aleph.ts), porque su firma no lleva nonce y perderla haría firmar una
// segunda, igual de válida.
const DEBOUNCE_MS = Number(process.env.PERSIST_DEBOUNCE_MS ?? 20_000);
const REDIS_TIMEOUT_MS = 10_000;

async function redisGet(key: string): Promise<string | null> {
  const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`redis GET ${key}: HTTP ${r.status}`);
  const body = (await r.json()) as { result: string | null };
  return body.result;
}

async function redisSet(key: string, value: string): Promise<void> {
  // El valor va en el BODY (no en la URL): el JSON de partidas con replays
  // puede medir cientos de KB y reventaría el largo máximo de una URL.
  const r = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: value,
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`redis SET ${key}: HTTP ${r.status}`);
}

// TRASPASO ENTRE INSTANCIAS (deploys sin cortes). Render arranca la instancia
// nueva, le pasa el tráfico y recién DESPUÉS le manda SIGTERM a la vieja. Como
// la nueva cargaba el estado al arrancar, se perdía todo lo que la vieja
// cambiaba en ese rato, y las escrituras siguientes de la nueva pisaban el
// flush final de la vieja. En una mesa de plata eso podía decidir una partida
// dos veces, con dos firmas válidas de ganadores distintos.
//
// Ahora hay una POSTA en Redis: la instancia que escribe la tiene y la hace
// latir; al recibir SIGTERM guarda todo y la suelta. La nueva recién carga
// cuando la ve soltada (o sin latir, si la anterior se cayó), y mientras no la
// tenga no escribe nada: nunca pisa el estado real con el suyo vacío.
const LEASE_KEY = "arcade:lease";
const LEASE_HEARTBEAT_MS = Number(process.env.LEASE_HEARTBEAT_MS ?? 60_000);

/** Identidad de este proceso: cada deploy o reinicio es una instancia nueva. */
export const INSTANCE_ID = randomUUID();

interface Lease {
  id: string;
  at: number; // último latido
  released: boolean;
}

/** ¿Esta instancia puede escribir? Sin Redis, siempre (hay una sola instancia).
 *  Con Redis y el traspaso encendido (el servidor real, vía persist-on.ts),
 *  recién cuando tomó la posta, y deja de poder si otra se la quitó. */
let writable = !(USE_REDIS && process.env.ARCADE_PERSIST_HANDOVER === "1");

async function readLease(): Promise<Lease | null> {
  const raw = await redisGet(LEASE_KEY);
  if (!raw) return null;
  try {
    const l = JSON.parse(raw) as Partial<Lease>;
    return typeof l.id === "string" && typeof l.at === "number" ? (l as Lease) : null;
  } catch {
    return null;
  }
}

async function writeLease(released: boolean): Promise<void> {
  await redisSet(
    LEASE_KEY,
    JSON.stringify({ id: INSTANCE_ID, at: Date.now(), released } satisfies Lease),
  );
}

export type HandoverOutcome = "off" | "none" | "released" | "stale" | "timeout";

/** Antes de cargar el estado: espera a que la instancia anterior lo guarde y
 *  suelte la posta. No espera si no hay posta (primer arranque), si ya está
 *  soltada, o si hace rato que no late (la anterior se cayó sin avisar). Con
 *  `timeoutMs` de techo, por si la anterior quedó colgada. */
export async function waitForHandover(
  opts: { timeoutMs?: number; pollMs?: number; staleMs?: number } = {},
): Promise<HandoverOutcome> {
  if (!USE_REDIS) return "off";
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollMs = opts.pollMs ?? 500;
  const staleMs = opts.staleMs ?? 3 * LEASE_HEARTBEAT_MS;
  const start = Date.now();
  for (;;) {
    const lease = await readLease();
    if (!lease) return "none";
    if (lease.released) return "released";
    if (Date.now() - lease.at > staleMs) return "stale";
    if (Date.now() - start >= timeoutMs) return "timeout";
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Tomar la posta: desde acá esta instancia es la que escribe. */
export async function acquireLease(): Promise<void> {
  if (!USE_REDIS) return;
  await writeLease(false);
  writable = true;
}

/** Latido de la posta. Si otra instancia la tomó (esta quedó colgada y la
 *  nueva se cansó de esperar), esta deja de escribir para no pisarla. */
export async function leaseHeartbeat(): Promise<void> {
  if (!USE_REDIS || !writable) return;
  const lease = await readLease();
  if (lease && lease.id !== INSTANCE_ID) {
    writable = false;
    console.error("persist: otra instancia tomó la posta; esta deja de escribir");
    return;
  }
  await writeLease(false);
}

/** El latido periódico de la posta (lo arranca index.ts después de cargar). */
export function startLeaseHeartbeat(): void {
  if (!USE_REDIS) return;
  const timer = setInterval(() => {
    leaseHeartbeat().catch((e) => console.error("persist lease:", (e as Error).message));
  }, LEASE_HEARTBEAT_MS);
  timer.unref?.();
}

export interface JsonStore {
  /** Carga el JSON guardado (una vez, al arrancar). En Redis, un error de red
   *  TIRA: mejor no arrancar que arrancar "limpio" y pisar los datos reales
   *  en el próximo save. Sin datos guardados devuelve null. */
  load(): Promise<string | null>;
  /** Guarda con debounce. `getJson` se evalúa recién al escribir (estado fresco). */
  save(getJson: () => string): void;
  /** Escritura inmediata de lo pendiente (apagado ordenado). */
  flush(): Promise<void>;
}

const stores: JsonStore[] = [];

export function jsonStore(name: string): JsonStore {
  const file = join(DATA_DIR, `${name}.json`);
  const redisKey = `arcade:${name}`;

  let pending: (() => string) | null = null;
  let timer: NodeJS.Timeout | null = null;
  // Último contenido efectivamente escrito, para no repetir escrituras idénticas.
  let lastWritten: string | null = null;
  // Las escrituras a Redis se encadenan: si una tarda y llega otra, la nueva
  // espera a la anterior — nunca se persiste estado viejo por completarse
  // fuera de orden (cada SET es el blob entero, gana el último).
  let chain: Promise<void> = Promise.resolve();

  function writeNow(): Promise<void> {
    // Sin la posta no se escribe: lo pendiente queda para cuando la tenga.
    if (!writable) return USE_REDIS ? chain : Promise.resolve();
    const getJson = pending;
    pending = null;
    if (!getJson) return Promise.resolve();
    const json = getJson();
    // SIN CAMBIOS, SIN ESCRITURA. Varios caminos llaman persist() aunque no
    // haya cambiado nada (el barrido, reintentos, endpoints que releen). Cada
    // una de esas subía el blob entero de nuevo para dejarlo igual que estaba.
    if (json === lastWritten) return USE_REDIS ? chain : Promise.resolve();
    lastWritten = json;
    if (USE_REDIS) {
      chain = chain
        .then(() => redisSet(redisKey, json))
        .catch((e) => {
          // La escritura falló: olvidamos el "último escrito" para que el
          // próximo intento vuelva a mandar este contenido aunque nadie lo
          // haya modificado mientras tanto.
          lastWritten = null;
          console.error(`persist ${name} (redis):`, (e as Error).message);
        });
      return chain;
    }
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      // Escritura atómica: a un temporal y luego rename, así un corte a mitad
      // de escritura no deja el archivo corrupto.
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, json);
      renameSync(tmp, file);
    } catch (e) {
      lastWritten = null; // igual que en Redis: que el próximo intento reescriba
      console.error(`persist ${name} (file):`, (e as Error).message);
    }
    return Promise.resolve();
  }

  const store: JsonStore = {
    async load() {
      if (!ENABLED) return null;
      if (USE_REDIS) return redisGet(redisKey); // un error acá corta el arranque
      try {
        return readFileSync(file, "utf8");
      } catch {
        return null; // sin archivo: arrancamos limpio
      }
    },
    save(getJson) {
      if (!ENABLED) return;
      pending = getJson;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void writeNow();
      }, DEBOUNCE_MS);
      timer.unref?.();
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await writeNow();
      if (USE_REDIS) await chain; // esperar también lo que ya estaba en vuelo
    },
  };
  stores.push(store);
  return store;
}

/** Apagado ordenado: un último flush de TODOS los stores y, recién después,
 *  soltar la posta (si todavía es de esta instancia) para que la nueva cargue
 *  lo que quedó guardado. */
export async function shutdownPersistence(): Promise<void> {
  await Promise.allSettled(stores.map((s) => s.flush()));
  if (!USE_REDIS || !writable) return;
  const lease = await readLease();
  if (lease && lease.id !== INSTANCE_ID) return;
  await writeLease(true);
  writable = false;
}

// SIGTERM/SIGINT (típico de un redeploy): centralizado acá para que ningún
// módulo corte el proceso antes de que otro termine de escribir.
if (ENABLED) {
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      shutdownPersistence()
        .catch((e) => console.error("persist shutdown:", (e as Error).message))
        .finally(() => process.exit(0));
    });
  }
}
