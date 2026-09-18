// Cliente mínimo de Upstash Redis por REST: fetch puro, sin dependencia npm.
// Dos formas de hablarle, cada una para lo suyo:
//
//  - GET /get/<clave> y POST /set/<clave> con el valor en el BODY: para los
//    blobs del estado (cientos de KB). No entran en una URL, y mandarlos dentro
//    de un JSON los escaparía y agregaría bytes, que se pagan en ancho de banda
//    (ver el agrupador de escrituras en persist.ts).
//  - POST / con el comando como arreglo JSON, y POST /pipeline con varios en un
//    solo pedido: para las claves chicas de la posta (INCR, GET, SET). Un
//    pipeline NO es atómico (Upstash lo aclara); lo atómico es cada comando.

const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/+$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
const REDIS_TIMEOUT_MS = 10_000;

const authHeader = () => ({ Authorization: `Bearer ${REDIS_TOKEN}` });

export async function redisGet(key: string): Promise<string | null> {
  const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: authHeader(),
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`redis GET ${key}: HTTP ${r.status}`);
  const body = (await r.json()) as { result: string | null };
  return body.result;
}

export async function redisSet(key: string, value: string): Promise<void> {
  // El valor va en el BODY (no en la URL): el JSON de partidas con replays
  // puede medir cientos de KB y reventaría el largo máximo de una URL.
  const r = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: authHeader(),
    body: value,
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`redis SET ${key}: HTTP ${r.status}`);
}

export type RedisArg = string | number;

interface Reply {
  result?: unknown;
  error?: string;
}

/** Un comando chico: POST / con el comando como arreglo JSON. */
export async function redisCommand(cmd: RedisArg[]): Promise<unknown> {
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(cmd.map(String)),
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  const body = (await r.json().catch(() => ({}))) as Reply;
  if (!r.ok || body.error) {
    throw new Error(`redis ${cmd[0]}: ${body.error ?? `HTTP ${r.status}`}`);
  }
  return body.result ?? null;
}

/** Varios comandos chicos en UN pedido, en orden (no atómico). */
export async function redisPipeline(cmds: RedisArg[][]): Promise<unknown[]> {
  const r = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(cmds.map((c) => c.map(String))),
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`redis pipeline: HTTP ${r.status}`);
  const rows = (await r.json()) as Reply[];
  return rows.map((row, i) => {
    if (row.error) throw new Error(`redis ${cmds[i][0]}: ${row.error}`);
    return row.result ?? null;
  });
}
