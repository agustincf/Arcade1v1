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

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { redisGet, redisSet } from "./redis.js";
import { confirmHolder, isHolder } from "./lease.js";

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

/** ¿Hay traspaso entre instancias? Solo con Redis y en el servidor real (lo
 *  enciende persist-on.ts). Sin traspaso (tests, dev con archivo) hay UNA
 *  instancia y siempre escribe. Con traspaso escribe SOLO la dueña de la posta
 *  (lease.ts): una instancia que arranca nunca pisa el estado real con el suyo
 *  vacío, y una vieja que ya entregó no pisa el de la nueva. */
export const handoverEnabled = USE_REDIS && process.env.ARCADE_PERSIST_HANDOVER === "1";
const canWrite = (): boolean => !handoverEnabled || isHolder();

/** Sin la posta no se guarda nada, y eso es un error, no un "listo": aleph.ts
 *  publica on-chain DESPUÉS de guardar, y una tabla firmada que no quedó
 *  guardada no se puede publicar. */
export class NotHolderError extends Error {
  constructor(store: string) {
    super(`persist ${store}: sin la posta, no se guarda`);
    this.name = "NotHolderError";
  }
}

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

export interface JsonStore {
  /** Carga el JSON guardado (una vez, al arrancar). En Redis, un error de red
   *  TIRA: mejor no arrancar que arrancar "limpio" y pisar los datos reales
   *  en el próximo save. Sin datos guardados devuelve null. */
  load(): Promise<string | null>;
  /** Guarda con debounce. `getJson` se evalúa recién al escribir (estado fresco). */
  save(getJson: () => string): void;
  /** Escritura inmediata de lo pendiente. RECHAZA si no se pudo guardar (sin
   *  la posta, o Upstash/disco falló): quien publica algo después de guardar
   *  tiene que enterarse. */
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
  // La suerte de la última escritura (rechaza si falló). Un flush sin nada nuevo
  // devuelve ESTA: "sin cambios" no es "guardado" si la anterior todavía viaja
  // o falló.
  let lastAttempt: Promise<void> = Promise.resolve();
  // Las escrituras a Redis se encadenan: si una tarda y llega otra, la nueva
  // espera a la anterior — nunca se persiste estado viejo por completarse fuera
  // de orden (cada SET es el blob entero, gana el último). `chain` nunca
  // rechaza, así una falla no traba las siguientes.
  let chain: Promise<void> = Promise.resolve();

  const failed = (e: unknown): Promise<void> => {
    const p = Promise.reject(e);
    p.catch(() => {}); // que no cuente como rechazo sin manejar
    return p;
  };

  function writeNow(): Promise<void> {
    // Sin la posta no se escribe: lo pendiente queda para cuando la tenga.
    if (!canWrite()) return pending ? failed(new NotHolderError(name)) : lastAttempt;
    const getJson = pending;
    pending = null;
    if (!getJson) return lastAttempt;
    const json = getJson();
    // SIN CAMBIOS, SIN ESCRITURA. Varios caminos llaman persist() aunque no
    // haya cambiado nada (el barrido, reintentos, endpoints que releen). Cada
    // una de esas subía el blob entero de nuevo para dejarlo igual que estaba.
    if (json === lastWritten) return lastAttempt;
    lastWritten = json;
    if (USE_REDIS) {
      const attempt = chain.then(async () => {
        // Antes de subir el blob, confirmar que la posta sigue siendo mía (una
        // lectura chica): una instancia que la perdió sin enterarse —colgada,
        // por ejemplo— no pisa el estado de la dueña.
        if (handoverEnabled && !(await confirmHolder())) throw new NotHolderError(name);
        await redisSet(redisKey, json);
      });
      chain = attempt.catch((e) => {
        // Falló: se olvida como "escrito" y queda pendiente, así el próximo
        // flush lo vuelve a mandar aunque nadie lo haya modificado.
        if (lastWritten === json) lastWritten = null;
        pending ??= getJson;
        if (!(e instanceof NotHolderError)) {
          console.error(`persist ${name} (redis):`, (e as Error).message);
        }
      });
      lastAttempt = attempt;
      return attempt;
    }
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      // Escritura atómica: a un temporal y luego rename, así un corte a mitad
      // de escritura no deja el archivo corrupto.
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, json);
      renameSync(tmp, file);
      lastAttempt = Promise.resolve();
    } catch (e) {
      lastWritten = null; // igual que en Redis: que el próximo intento reescriba
      pending ??= getJson;
      console.error(`persist ${name} (file):`, (e as Error).message);
      lastAttempt = failed(e);
    }
    return lastAttempt;
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
        // El agrupador no tiene a quién avisarle: la falla ya quedó en el log
        // y lo pendiente, para el próximo intento.
        writeNow().catch(() => {});
      }, DEBOUNCE_MS);
      timer.unref?.();
    },
    async flush() {
      if (!ENABLED) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await writeNow();
    },
  };
  stores.push(store);
  return store;
}

/** Guarda YA todos los stores (entrega de la posta, apagado). RECHAZA si alguno
 *  no se pudo guardar: soltar la posta sin haber guardado haría cargar a la
 *  instancia nueva un estado viejo. El SIGTERM lo maneja handover.ts. */
export async function flushAll(): Promise<void> {
  const results = await Promise.allSettled(stores.map((s) => s.flush()));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length) {
    const first = failures[0].reason as Error | undefined;
    throw new Error(
      `no se guardaron ${failures.length} de ${stores.length} stores: ${first?.message ?? "?"}`,
    );
  }
}
