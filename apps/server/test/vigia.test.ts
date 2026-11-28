// Vigía del árbitro y del USDC (scripts/vigia.mjs, O4 de docs/MAINNET.md):
// qué cuenta como problema, cuándo abre y cierra issues, y que un RPC que
// parpadea no dispara nada. Sin red: fetch falso.
// Correr: node --import tsx --test apps/server/test/vigia.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

const v = await import("../../../scripts/vigia.mjs");

const URL_ARB = "https://arbitro.test";
const slotDe = (impl: string) => `0x${"0".repeat(24)}${impl.slice(2)}`;

/** fetch falso: responde según el método JSON-RPC o la ruta pedida. */
function fetchFalso(respuestas: Record<string, () => Response | Promise<Response>>) {
  const pedidos: string[] = [];
  const f = async (url: string, init?: RequestInit) => {
    const clave = init?.body ? JSON.parse(String(init.body)).method : new URL(url).pathname;
    pedidos.push(clave);
    const r = respuestas[clave];
    if (!r) throw new Error(`sin respuesta para ${clave}`);
    return r();
  };
  return { f: f as unknown as typeof fetch, pedidos };
}
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
const rpcOk = (result: unknown) => () => json({ jsonrpc: "2.0", id: 1, result });

test("leerHealth: reintenta una vez y devuelve el JSON del segundo intento", async () => {
  let n = 0;
  const { f } = fetchFalso({
    "/health": () => (n++ === 0 ? json({}, 503) : json({ ok: true, commit: "abc" })),
  });
  const esperas: number[] = [];
  const l = await v.leerHealth({
    url: URL_ARB,
    fetchImpl: f,
    esperar: async (ms: number) => void esperas.push(ms),
  });
  assert.deepEqual(l, { health: { ok: true, commit: "abc" } });
  assert.deepEqual(esperas, [15_000]);
});

test("leerHealth + evaluarArbitro: dos fallos son un problema con el motivo", async () => {
  const { f } = fetchFalso({ "/health": () => json({}, 502) });
  const l = await v.leerHealth({ url: URL_ARB, fetchImpl: f, esperar: async () => {} });
  const r = v.evaluarArbitro(l, URL_ARB);
  assert.equal(r.problema, `${URL_ARB}/health: HTTP 502`);
});

test("evaluarArbitro: sin ok:true es problema; con ok:true no", () => {
  assert.match(v.evaluarArbitro({ health: { ok: false } }, URL_ARB).problema, /sin ok/);
  assert.equal(v.evaluarArbitro({ health: { ok: true, commit: "c" } }, URL_ARB).problema, null);
});

test("evaluarEscrow: sin mesas de plata u ok no avisa; unverified pide otra mirada; blocked avisa", () => {
  assert.equal(v.evaluarEscrow({ ok: true }).problema, null);
  assert.equal(v.evaluarEscrow({ ok: true, escrow: "ok" }).problema, null);
  const u = v.evaluarEscrow({ ok: true, escrow: "unverified" });
  assert.equal(u.problema, null);
  assert.equal(u.reintentar, true);
  assert.match(v.evaluarEscrow({ ok: true, escrow: "blocked" }).problema, /blocked/);
});

test("evaluarUsdc: la implementación de las pruebas no avisa", async () => {
  const { f } = fetchFalso({
    eth_getStorageAt: rpcOk(slotDe(v.USDC_IMPL_ESPERADA)),
    eth_blockNumber: rpcOk("0x10"),
  });
  const r = await v.evaluarUsdc({ rpcUrl: "https://rpc.test", fetchImpl: f });
  assert.equal(r.problema, null);
});

test("evaluarUsdc: otra implementación avisa, con la nueva y el bloque para correr las pruebas", async () => {
  const nueva = "0x" + "ab".repeat(20);
  const { f } = fetchFalso({
    eth_getStorageAt: rpcOk(slotDe(nueva)),
    eth_blockNumber: rpcOk("0x3e8"),
  });
  const r = await v.evaluarUsdc({ rpcUrl: "https://rpc.test", fetchImpl: f });
  assert.match(r.problema, new RegExp(nueva));
  assert.match(r.problema, /Bloque actual: 1000\./);
});

test("evaluarUsdc: si el RPC falla no hay veredicto (ni abre ni cierra)", async () => {
  const { f } = fetchFalso({
    eth_getStorageAt: () => json({ jsonrpc: "2.0", id: 1, error: { message: "rate limited" } }),
  });
  const r = await v.evaluarUsdc({ rpcUrl: "https://rpc.test", fetchImpl: f });
  assert.equal(r.sinDatos, true);
  assert.deepEqual(v.decidir([r], [{ number: 7, body: "<!-- vigia:usdc -->" }]), []);
});

test("decidir: abre lo nuevo, no repite lo abierto y cierra lo que se normalizó", () => {
  const abiertos = [
    { number: 3, body: "<!-- vigia:escrow -->\nalgo" },
    { number: 4, body: "<!-- vigia:usdc -->\nalgo" },
  ];
  const acciones = v.decidir(
    [
      { tipo: "arbitro", problema: "caído" },
      { tipo: "escrow", problema: "blocked" },
      { tipo: "usdc", problema: null, detalle: "ok" },
    ],
    abiertos,
  );
  assert.deepEqual(acciones, [
    { accion: "abrir", tipo: "arbitro", problema: "caído" },
    { accion: "cerrar", tipo: "usdc", numero: 4, detalle: "ok" },
  ]);
});

test("cuerpoIssue: lleva la marca que lo identifica y qué hacer", () => {
  const b = v.cuerpoIssue("usdc", "cambió", new Date("2026-11-28T12:00:00Z"));
  assert.ok(b.startsWith("<!-- vigia:usdc -->"));
  assert.match(b, /FORK_BLOCK=<bloque>/);
  assert.match(b, /2026-11-28T12:00:00.000Z/);
  assert.match(v.tituloIssue("arbitro"), /no responde/);
});
