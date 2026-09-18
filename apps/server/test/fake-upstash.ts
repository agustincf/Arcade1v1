// Un Upstash falso en memoria para los tests del árbitro. Habla las formas que
// usa redis.ts: GET /get/<clave> y POST /set/<clave> con el valor en el body,
// un comando como arreglo JSON en POST /, y varios en POST /pipeline.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeUpstash {
  url: string;
  kv: Map<string, string>;
  /** Cada comando recibido, en orden: [NOMBRE, clave]. */
  log: string[][];
  /** Con un número, TODO pedido responde ese status de error (Upstash caído). */
  failWith: number | null;
  /** Comandos (nombre en mayúsculas) que fallan a propósito mientras estén en el conjunto. */
  failCommands: Set<string>;
  close(): Promise<void>;
}

export async function startFakeUpstash(): Promise<FakeUpstash> {
  const kv = new Map<string, string>();
  const log: string[][] = [];

  function run(cmd: string[]): unknown {
    const [raw, ...args] = cmd;
    const name = raw.toUpperCase();
    if (fake.failCommands.has(name)) throw new Error(`fake-upstash: ${name} falla a propósito`);
    log.push([name, args[0] ?? ""]);
    switch (name) {
      case "GET":
        return kv.get(args[0]) ?? null;
      case "SET":
        kv.set(args[0], args[1]);
        return "OK";
      case "DEL":
        return kv.delete(args[0]) ? 1 : 0;
      case "INCR": {
        const n = Number(kv.get(args[0]) ?? "0") + 1;
        kv.set(args[0], String(n));
        return n;
      }
      case "EXPIRE":
        return kv.has(args[0]) ? 1 : 0;
      default:
        throw new Error(`fake-upstash: comando no soportado ${name}`);
    }
  }

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => void chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = decodeURIComponent(req.url ?? "/");
      res.setHeader("Content-Type", "application/json");
      if (fake.failWith) {
        res.statusCode = fake.failWith;
        res.end(JSON.stringify({ error: "caído" }));
        return;
      }
      try {
        let out: unknown;
        if (url.startsWith("/get/")) out = { result: run(["GET", url.slice(5)]) };
        else if (url.startsWith("/set/")) out = { result: run(["SET", url.slice(5), body]) };
        else if (url === "/pipeline")
          out = (JSON.parse(body) as string[][]).map((c) => ({ result: run(c) }));
        else if (url === "/") out = { result: run(JSON.parse(body) as string[]) };
        else {
          res.statusCode = 404;
          out = { error: "ruta desconocida" };
        }
        res.end(JSON.stringify(out));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  server.unref();

  const fake: FakeUpstash = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    kv,
    log,
    failWith: null,
    failCommands: new Set<string>(),
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
  return fake;
}
