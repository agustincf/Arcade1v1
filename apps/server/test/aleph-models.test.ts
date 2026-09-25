// El modelo DECLARADO por cada agente de Aleph: va firmado al sentarse, se
// congela en el asiento de esa sala, se ve en la vista y en el registro, y al
// liquidar suma a una tabla por modelo (partidas, pago promedio contra los 1000
// que pone cada asiento, y traiciones sobre las veces que pudo traicionar).
// Nadie verifica el modelo: es lo que el agente dice ser.
// Correr: node --import tsx --test apps/server/test/aleph-models.test.ts
import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { matchmakeAuthMessage } from "@arcade1v1/game-sdk/auth";

const V = await import("../src/aleph.js");
const M = await import("../src/aleph-models.js");
const { alephRouter } = await import("../src/aleph-routes.js");

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "0c00");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);
const T0 = 1_800_000_000_000;
const LEJOS = T0 + V.ALEPH_LOBBY_MS + 200 * V.ALEPH_PHASE_MS;

function reset() {
  V.__resetAlephForTest();
  M.__resetAlephModelsForTest();
}

/** Arranca la sala (vence el lobby) y después deja vencer todas las fases sin
 *  que nadie actúe, hasta que se liquida. En dos pasos: si se salta directo al
 *  final, la sala recién arranca en ese instante. */
async function jugarHastaElFinal(roomId: string, address: string) {
  await V.getAlephRoom(roomId, address, T0 + V.ALEPH_LOBBY_MS);
  return (await V.getAlephRoom(roomId, address, LEJOS))!;
}

test("el modelo declarado al sentarse queda en el asiento, normalizado, y se ve en la sala", async () => {
  reset();
  const a = addr();
  const b = addr();
  const v = await V.joinAleph(0, a, undefined, T0, "Claude Sonnet 5");
  await V.joinAleph(0, b, undefined, T0 + 1);
  const view = (await V.getAlephRoom(v.roomId, undefined, T0 + 2))!;
  const byAddr = Object.fromEntries(view.seats.map((s) => [s.address, s]));
  assert.equal(byAddr[a].model, "claude-sonnet-5");
  // Sin declarar, sin campo (ni `model: undefined`).
  assert.ok(!("model" in byAddr[b]));
});

test("volver a pedir asiento no cambia el modelo: vale el de cuando se sentó", async () => {
  reset();
  const a = addr();
  const v = await V.joinAleph(0, a, undefined, T0, "gpt-5");
  const again = await V.joinAleph(0, a, undefined, T0 + 1, "claude-opus-5");
  assert.equal(again.roomId, v.roomId);
  const seat = again.seats.find((s) => s.address === a)!;
  assert.equal(seat.model, "gpt-5");
});

test("con firma, el modelo tiene que estar firmado", async () => {
  reset();
  const acc = privateKeyToAccount(generatePrivateKey());
  const a = acc.address.toLowerCase();
  const ts = T0;
  // Firmó el modelo: entra, y queda el modelo firmado.
  const firmada = await acc.signMessage({
    message: matchmakeAuthMessage("aleph", 0, a, ts, "Claude Sonnet 5"),
  });
  const v = await V.joinAleph(0, a, { signature: firmada, ts }, T0, "Claude Sonnet 5");
  assert.equal(v.seats.find((s) => s.address === a)!.model, "claude-sonnet-5");

  // Firmó sin modelo pero manda uno: no se puede colgar un modelo de una firma
  // que no lo cubre.
  reset();
  const b = privateKeyToAccount(generatePrivateKey());
  const sinModelo = await b.signMessage({
    message: matchmakeAuthMessage("aleph", 0, b.address.toLowerCase(), ts),
  });
  await assert.rejects(
    V.joinAleph(0, b.address, { signature: sinModelo, ts }, T0, "gpt-5"),
    /bad signature/,
  );
});

test("el registro público de la sala liquidada trae los modelos declarados", async () => {
  reset();
  const [a, b, c, d] = [addr(), addr(), addr(), addr()];
  const v = await V.joinAleph(0, a, undefined, T0, "claude-sonnet-5");
  await V.joinAleph(0, b, undefined, T0, "gpt-5");
  await V.joinAleph(0, c, undefined, T0);
  await V.joinAleph(0, d, undefined, T0);
  assert.equal((await jugarHastaElFinal(v.roomId, a)).status, "settled");
  const log = V.alephLog(v.roomId, LEJOS);
  assert.deepEqual(log.models, { [a]: "claude-sonnet-5", [b]: "gpt-5" });
});

test("tallyAlephRoom: partidas, pago y traiciones por modelo; sin la casa ni los que no declararon", () => {
  const [A, B, C, D, H] = [addr(), addr(), addr(), addr(), addr()];
  const delta = M.tallyAlephRoom({
    models: { [A]: "claude-sonnet-5", [B]: "gpt-5", [C]: "claude-sonnet-5", [H]: "gpt-5" },
    payouts: { [A]: 1500, [B]: 700, [C]: 1000, [D]: 800, [H]: 0 },
    results: [
      { index: 0, kind: "share", potAfter: 0, boxAfter: 0 },
      { index: 1, kind: "lock", potAfter: 0, boxAfter: 0, solvers: [A, B], traitors: [A] },
      {
        index: 2,
        kind: "final",
        potAfter: 0,
        boxAfter: 0,
        choices: { [A]: "steal", [B]: "split" },
      },
    ],
    isHouse: (x) => x === H,
  });
  assert.deepEqual(Object.fromEntries(delta), {
    "claude-sonnet-5": {
      games: 2,
      payoutSum: 2500,
      lockChances: 1,
      lockBetrayals: 1,
      finals: 1,
      steals: 1,
    },
    "gpt-5": { games: 1, payoutSum: 700, lockChances: 1, lockBetrayals: 0, finals: 1, steals: 0 },
  });
});

test("al liquidar, la sala suma a la tabla por modelo (una sola vez)", async () => {
  reset();
  const [a, b, c, d] = [addr(), addr(), addr(), addr()];
  const v = await V.joinAleph(0, a, undefined, T0, "claude-sonnet-5");
  await V.joinAleph(0, b, undefined, T0, "claude-sonnet-5");
  await V.joinAleph(0, c, undefined, T0, "gpt-5");
  await V.joinAleph(0, d, undefined, T0, "gpt-5");
  const fin = await jugarHastaElFinal(v.roomId, a);
  assert.equal(fin.status, "settled");

  const rows = M.alephModelStats();
  assert.deepEqual(
    rows.map((r) => [r.model, r.games]),
    [
      ["claude-sonnet-5", 2],
      ["gpt-5", 2],
    ],
  );
  // Los pagos de una sala suman exactamente 1000 por asiento.
  const total = rows.reduce((n, r) => n + r.avgPayout * r.games, 0);
  assert.equal(total, 4000);
  assert.equal(
    M.alephModelStats()[0].betrayal.chances,
    0,
    "nadie llegó a la Cerradura ni a la Final",
  );

  // Contarla de nuevo (por ejemplo, tras un reinicio que re-liquida) no suma.
  M.recordAlephRoom(v.roomId, {
    models: { [a]: "claude-sonnet-5" },
    payouts: { [a]: 1000 },
    results: [],
  });
  assert.equal(M.alephModelStats()[0].games, 2);
});

test("la fila pública: pago promedio y tasa de traición (null sin oportunidades)", () => {
  M.__resetAlephModelsForTest();
  const [A, B] = [addr(), addr()];
  M.recordAlephRoom("0xsala1", {
    models: { [A]: "x-model", [B]: "y-model" },
    payouts: { [A]: 1500, [B]: 500 },
    results: [
      {
        index: 0,
        kind: "final",
        potAfter: 0,
        boxAfter: 0,
        choices: { [A]: "steal", [B]: "steal" },
      },
    ],
  });
  M.recordAlephRoom("0xsala2", {
    models: { [A]: "x-model" },
    payouts: { [A]: 900 },
    results: [],
  });
  const x = M.alephModelStats().find((r) => r.model === "x-model")!;
  assert.equal(x.games, 2);
  assert.equal(x.avgPayout, 1200);
  assert.deepEqual(x.betrayal, { chances: 1, count: 1, rate: 1 });
  assert.deepEqual(x.lock, { chances: 0, betrayals: 0 });
  assert.deepEqual(x.final, { played: 1, steals: 1 });
  M.recordAlephRoom("0xsala3", { models: { [B]: "z-model" }, payouts: { [B]: 1000 }, results: [] });
  assert.equal(M.alephModelStats().find((r) => r.model === "z-model")!.betrayal.rate, null);
});

test("la tabla sobrevive a serializar y restaurar, incluida la memoria de salas contadas", () => {
  M.__resetAlephModelsForTest();
  const A = addr();
  M.recordAlephRoom("0xsala-a", { models: { [A]: "m1" }, payouts: { [A]: 1000 }, results: [] });
  const json = M.serializeAlephModels();
  M.__resetAlephModelsForTest();
  assert.deepEqual(M.alephModelStats(), []);
  M.restoreAlephModelsFrom(json);
  assert.equal(M.alephModelStats()[0].games, 1);
  M.recordAlephRoom("0xsala-a", { models: { [A]: "m1" }, payouts: { [A]: 1000 }, results: [] });
  assert.equal(M.alephModelStats()[0].games, 1, "la sala ya contada no vuelve a sumar");
  // Basura en el store: arranca vacío en vez de tirar el arranque.
  M.restoreAlephModelsFrom("{no es json");
  assert.deepEqual(M.alephModelStats(), []);
});

// ---- HTTP ----
const app = express();
app.use(express.json());
app.use(alephRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

test("POST /aleph/join con `model` y GET /aleph/models", async () => {
  reset();
  const acc = privateKeyToAccount(generatePrivateKey());
  const a = acc.address.toLowerCase();
  const ts = Date.now();
  const signature = await acc.signMessage({
    message: matchmakeAuthMessage("aleph", 0, a, ts, "gpt-5"),
  });
  const r = await fetch(`${BASE}/aleph/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stake: 0, address: a, signature, ts, model: "gpt-5" }),
  });
  const body = (await r.json()) as { seats: { address: string; model?: string }[] };
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.seats.find((s) => s.address === a)!.model, "gpt-5");

  M.recordAlephRoom("0xsala-http", {
    models: { [a]: "gpt-5" },
    payouts: { [a]: 1100 },
    results: [],
  });
  const g = await fetch(`${BASE}/aleph/models`);
  const out = (await g.json()) as { models: { model: string; games: number; avgPayout: number }[] };
  assert.equal(g.status, 200);
  assert.deepEqual(
    out.models.map((m) => [m.model, m.games, m.avgPayout]),
    [["gpt-5", 1, 1100]],
  );
});
