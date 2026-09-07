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

const ENABLED = process.env.ARCADE_PERSIST === "1" || process.env.ARCADE_PERSIST_MATCHES === "1";
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/+$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
const USE_REDIS = ENABLED && !!REDIS_URL && !!REDIS_TOKEN;

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
const DEBOUNCE_MS = Number(process.env.PERSIST_DEBOUNCE_MS ?? 20_000);
const REDIS_TIMEOUT_MS = 10_000;

export const persistenceBackend: "redis" | "file" | "off" = USE_REDIS
  ? "redis"
  : ENABLED
    ? "file"
    : "off";

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

// Apagado ordenado (SIGTERM/SIGINT, típico de un redeploy): un último flush de
// TODOS los stores antes de salir. Centralizado acá para que ningún módulo
// corte el proceso antes de que otro termine de escribir.
if (ENABLED) {
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      Promise.allSettled(stores.map((s) => s.flush())).finally(() => process.exit(0));
    });
  }
}
