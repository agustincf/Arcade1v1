// VERSIÓN DE REGLAS de una sala de Aleph. El 2026-09-18 el azar pasó de
// `mulberry32` sobre un trozo de 32 bits (v1) a SHA-256 del secreto entero
// (v2). El árbitro NO guarda el estado: lo re-simula del registro cada vez que
// se reinicia. Si re-simulara una sala vieja con las reglas nuevas, saldría
// otro mazo, otros códigos y OTRA TABLA DE PAGOS — y la tabla de pagos de una
// mesa de plata es plata de verdad.
//
// Por eso una sala guarda con qué versión nació y la arrastra para siempre.
//
// Correr: node --import tsx --test apps/server/test/aleph-rules-version.test.ts
import "../src/offline-env.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replayAleph, ALEPH_RULES_V } from "@arcade1v1/game-sdk/aleph";
import golden from "../../../packages/game-sdk/test/aleph-v1-golden.json" with { type: "json" };

process.env.ALEPH_PHASE_MS = String(60 * 60_000);
const V = await import("../src/aleph.js");

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0"));

beforeEach(() => V.__resetAlephForTest());

/** Una sala TERMINADA tal como quedó guardada ANTES del cambio: con su
 *  registro y su semilla, y sin campo `rulesV`, que entonces no existía. */
const salaVieja = (i: number) => {
  const p = golden.partidas[i];
  return {
    id: ("0x" + (i + 1).toString(16).padStart(64, "0")) as `0x${string}`,
    stake: 0,
    status: "playing",
    seats: seats(p.n),
    createdAt: 1,
    startedAt: 2,
    secretSeed: p.seed,
    events: p.events,
  };
};

test("una sala guardada ANTES del cambio se sigue re-simulando con reglas v1", () => {
  for (let i = 0; i < golden.partidas.length; i++) {
    V.__resetAlephForTest();
    const p = golden.partidas[i];
    V.restoreAlephFrom(JSON.stringify([salaVieja(i)]));
    const room = V.liveAlephRooms(10)[0] ?? undefined;
    // La sala ya terminó dentro del registro, así que `settleDue` la liquida;
    // en cualquier caso lo que importa es la tabla que sale de re-simular.
    const guardada = JSON.parse(V.serializeAleph())[0];
    const estado = replayAleph(p.seed, seats(p.n), p.events as never, {
      rulesV: guardada.rulesV ?? 1,
    });
    assert.deepEqual(
      estado.payouts,
      p.payouts,
      `la sala vieja ${i} cambió de tabla de pagos al restaurarse`,
    );
    assert.equal(guardada.rulesV ?? 1, 1, "una sala sin versión tiene que valer como v1");
    void room;
  }
});

test("el árbitro re-simula con la versión de la sala, no con la vigente", () => {
  const p = golden.partidas[0];
  V.restoreAlephFrom(JSON.stringify([salaVieja(0)]));
  const room = JSON.parse(V.serializeAleph())[0];
  const estado = V.stateOf(room);
  assert.equal(estado.rulesV, 1, "el estado derivado quedó en la versión vigente, no en la suya");
  assert.deepEqual(estado.payouts, p.payouts, "la tabla de pagos no coincide con la original");
});

test("una sala nueva nace con la versión vigente y la guarda", async () => {
  const addr = seats(4)[0];
  await V.joinAleph(0, addr, undefined, 1000);
  const guardada = JSON.parse(V.serializeAleph())[0];
  assert.equal(guardada.rulesV, ALEPH_RULES_V, "la sala no anotó con qué reglas nació");
});

test("el verificador público acepta un registro v1 y lo re-simula con SUS reglas", async () => {
  // Quien bajó el registro de una partida vieja tiene que poder seguir
  // verificándola con el motor de hoy. Si el verificador exigiera la versión
  // vigente, toda partida anterior al cambio quedaría "sin verificar", que es
  // justo lo que el registro público promete que no pasa.
  const { verifyAlephLog } = await import("../../../scripts/aleph-verify.mjs");
  const { keccak256 } = await import("viem");
  const p = golden.partidas[0];
  const log = {
    roomId: "0x" + "11".repeat(32),
    stake: 0,
    rulesV: 1,
    seats: seats(p.n),
    secretSeed: p.seed,
    commit: keccak256(p.seed as `0x${string}`),
    events: p.events,
    payouts: p.payouts,
  };
  const { checks } = await verifyAlephLog(log);
  const buscar = (re: RegExp) => checks.find((c: { name: string }) => re.test(c.name));
  assert.ok(buscar(/versión de reglas/)!.ok, "rechaza una versión vieja pero conocida");
  assert.ok(buscar(/la tabla de pagos coincide/)!.ok, "re-simuló con las reglas equivocadas");

  // Una versión que el motor no conoce sí se rechaza.
  const futuro = await verifyAlephLog({ ...log, rulesV: 99 });
  assert.equal(futuro.ok, false, "aceptó una versión de reglas que no existe");
});

test("el registro público declara la versión de la sala", async () => {
  // `alephLog` es lo que baja un verificador externo. Si dijera la versión
  // vigente en vez de la de la sala, el verificador re-simularía con las reglas
  // equivocadas y acusaría al árbitro de mentir.
  V.restoreAlephFrom(JSON.stringify([{ ...salaVieja(0), status: "settled", settledAt: 3 }]));
  const log = V.alephLog(salaVieja(0).id, 10);
  assert.equal(log.rulesV, 1, "el registro de una sala vieja dice la versión equivocada");
});
