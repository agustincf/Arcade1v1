// SIMULACIÓN DE UN DEPLOY DE RENDER con árbitros de verdad (procesos hijos), el
// Upstash falso y un "Render" falso que imita lo que importa:
//  1. mientras la nueva no da /health 200, TODO el tráfico (incluido el timbre
//     por la URL pública) va a la vieja;
//  2. cuando la nueva da 200, el tráfico pasa a la nueva;
//  3. recién un rato DESPUÉS (60 s en Render; comprimido acá) le manda SIGTERM
//     a la vieja.
// Es la prueba que le faltó al PR #33: su simulación mandaba el SIGTERM
// enseguida, y en Render llega 60 s después del cambio de tráfico.
//
// Correr: node --import tsx --test apps/server/test/handover-sim.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { startFakeUpstash } from "./fake-upstash.js";

const INDEX = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const TSX = import.meta.resolve("tsx");
// Sin .env: el árbitro carga dotenv desde su cwd, y un .env local podría traer
// variables reales (RPC, escrow). Un directorio vacío lo evita.
const CWD = mkdtempSync(join(tmpdir(), "arcade-sim-"));
// La cuenta #1 de anvil: pública y sin valor (la misma del selftest).
const ARBITER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const fake = await startFakeUpstash();
after(() => fake.close());

// ---- El Render falso: un proxy que manda todo a `target` ---------------------
const router = { target: 0, port: 0 };
const routerServer = createServer((req, res) => {
  const up = request(
    {
      host: "127.0.0.1",
      port: router.target,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (u) => {
      res.writeHead(u.statusCode ?? 502, u.headers);
      u.pipe(res);
    },
  );
  up.on("error", () => {
    res.statusCode = 502;
    res.end();
  });
  req.pipe(up);
});
await new Promise<void>((ok) => routerServer.listen(0, "127.0.0.1", ok));
router.port = (routerServer.address() as AddressInfo).port;
after(() => routerServer.close());
const PUBLIC = `http://127.0.0.1:${router.port}`;

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((ok) => s.close(() => ok()));
  return port;
}

interface Arbiter {
  name: string;
  port: number;
  proc: ChildProcess;
  out: string[];
  exited: Promise<number | null>;
}

async function startArbiter(name: string, env: Record<string, string> = {}): Promise<Arbiter> {
  const port = await freePort();
  const proc = spawn(process.execPath, ["--import", TSX, INDEX], {
    cwd: CWD,
    env: {
      PATH: process.env.PATH ?? "",
      PORT: String(port),
      UPSTASH_REDIS_REST_URL: fake.url,
      UPSTASH_REDIS_REST_TOKEN: "token-de-prueba",
      RENDER_EXTERNAL_URL: PUBLIC,
      ARBITER_PRIVATE_KEY: ARBITER_KEY,
      AGENTS_ENABLED: "false",
      ALEPH_HOUSE_ENABLED: "false",
      // Una hora de debounce: lo que aparezca guardado salió de la entrega.
      PERSIST_DEBOUNCE_MS: "3600000",
      LEASE_HEARTBEAT_MS: "1000",
      HANDOVER_POLL_MS: "100",
      HANDOVER_ACCEPT_WAIT_MS: "5000",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out: string[] = [];
  const collect = (b: Buffer) => {
    for (const line of b.toString("utf8").split("\n")) if (line.trim()) out.push(line);
  };
  proc.stdout!.on("data", collect);
  proc.stderr!.on("data", collect);
  const exited = new Promise<number | null>((ok) => proc.on("exit", (code) => ok(code)));
  return { name, port, proc, out, exited };
}

const logged = (a: Arbiter, re: RegExp) => a.out.some((l) => re.test(l));

async function waitUntil(
  what: string,
  cond: () => boolean | Promise<boolean>,
  arbiters: Arbiter[],
  ms = 30_000,
): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) {
      const dump = arbiters.map((a) => `--- ${a.name}\n${a.out.join("\n")}`).join("\n");
      throw new Error(`se venció esperando: ${what}\n${dump}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function health(port: number): Promise<number | undefined> {
  return (await fetch(`http://127.0.0.1:${port}/health`).catch(() => null))?.status;
}

test(
  "deploy normal: la nueva pide la posta por el timbre y carga lo último de la vieja",
  { timeout: 90_000 },
  async () => {
    fake.kv.clear();
    const a = await startArbiter("A");
    let b: Arbiter | undefined;
    try {
      router.target = a.port;
      await waitUntil("A lista", () => logged(a, /Árbitro listo/), [a]);

      const address = "0x" + "1".repeat(40);
      const mm = await fetch(`${PUBLIC}/matchmake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: "2048", stake: 0, address }),
      });
      assert.equal(mm.status, 200, await mm.clone().text());
      const { matchId } = (await mm.json()) as { matchId: string };
      assert.ok(
        !(fake.kv.get("arcade:matches") ?? "").includes(matchId),
        "la partida todavía vive solo en la memoria de A",
      );

      b = await startArbiter("B");
      const bb = b;
      // Render: espera a que la nueva dé 200, le pasa el tráfico y 60 s
      // (comprimidos en 1,5 s) después le manda SIGTERM a la vieja.
      const seen: number[] = [];
      await waitUntil(
        "B sana",
        async () => {
          const s = await health(bb.port);
          if (s) seen.push(s);
          return s === 200;
        },
        [a, bb],
      );
      router.target = bb.port;
      setTimeout(() => a.proc.kill("SIGTERM"), 1_500);

      assert.ok(seen.includes(503), "B no se declaró sana mientras A tenía la posta");
      assert.ok(logged(bb, /Traspaso: doorbell/), bb.out.join("\n"));
      assert.ok(logged(a, /Entregué la posta \(época 1, por timbre\)/), a.out.join("\n"));
      assert.equal(fake.kv.get("arcade:lease:epoch"), "2");

      const got = await fetch(`${PUBLIC}/match/${matchId}`);
      assert.equal(got.status, 200, "la partida creada en A existe en B");

      assert.equal(await a.exited, 0, "A sale limpia con el SIGTERM");
      assert.ok(!logged(a, /cercada|abortada/), a.out.join("\n"));
      assert.ok(!logged(bb, /cercada|abortada|respaldo/), bb.out.join("\n"));
    } finally {
      a.proc.kill("SIGKILL");
      b?.proc.kill("SIGKILL");
    }
  },
);

test(
  "primer deploy desde el #33: respaldo sin tope ciego, y la posta vieja queda marcada",
  { timeout: 90_000 },
  async () => {
    fake.kv.clear();
    fake.kv.set(
      "arcade:lease",
      JSON.stringify({ id: "vieja-33", at: Date.now(), released: false }),
    );
    const b = await startArbiter("B", { LEASE_STALE_MS: "600000" });
    try {
      await waitUntil("B en respaldo", () => logged(b, /Traspaso: respaldo/), [b]);
      assert.equal(await health(b.port), 200, "en respaldo da 200 para que Render pase el tráfico");
      const r = await fetch(`http://127.0.0.1:${b.port}/matches/recent`);
      assert.equal(r.status, 503, "pero no atiende hasta tener la posta");
      // La vieja del #33 recibe su SIGTERM de Render, guarda y suelta.
      fake.kv.set(
        "arcade:lease",
        JSON.stringify({ id: "vieja-33", at: Date.now(), released: true }),
      );
      await waitUntil("B lista", () => logged(b, /Árbitro listo/), [b]);
      assert.ok(logged(b, /Traspaso: fallback/), b.out.join("\n"));
      assert.notEqual(JSON.parse(fake.kv.get("arcade:lease")!).id, "vieja-33");
      assert.equal(fake.kv.get("arcade:lease:epoch"), "1");
    } finally {
      b.proc.kill("SIGKILL");
    }
  },
);

test(
  "si la nueva muere después del timbre, la vieja retoma la posta y sigue atendiendo",
  { timeout: 90_000 },
  async () => {
    fake.kv.clear();
    const a = await startArbiter("A", { HANDOVER_RESUME_MS: "1500" });
    let b: Arbiter | undefined;
    try {
      router.target = a.port;
      await waitUntil("A lista", () => logged(a, /Árbitro listo/), [a]);
      // B mira la posta recién a los 10 s: muere antes de tomarla.
      b = await startArbiter("B", { HANDOVER_POLL_MS: "10000" });
      const bb = b;
      await waitUntil("A entregó", () => logged(a, /Entregué la posta/), [a, bb]);
      bb.proc.kill("SIGKILL");
      await waitUntil("A retomó", () => logged(a, /Retomé la posta/), [a, bb]);
      assert.equal((await fetch(`${PUBLIC}/matches/recent`)).status, 200, "A vuelve a atender");
      assert.equal(fake.kv.get("arcade:lease:epoch"), "2");
    } finally {
      a.proc.kill("SIGKILL");
      b?.proc.kill("SIGKILL");
    }
  },
);
