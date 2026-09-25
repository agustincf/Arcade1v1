// Salas EN JUEGO en `GET /aleph/lobbies` (`playing`). Antes el árbitro solo
// publicaba lobbies/fondeo y salas liquidadas: quien llegaba a /aleph durante
// una partida no la encontraba. El resumen lleva SOLO datos que la vista
// pública ya muestra — nunca la semilla, fragmentos ni decisiones.
// Correr: node --import tsx --test apps/server/test/aleph-playing.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";

const V = await import("../src/aleph.js");

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "0b00");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);
const T0 = 1_800_000_000_000;

async function salaDeCuatro() {
  const a1 = addr();
  const v = await V.joinAleph(0, a1, undefined, T0);
  for (let i = 0; i < 3; i++) await V.joinAleph(0, addr(), undefined, T0 + 1);
  return { roomId: v.roomId, a1 };
}

test("una sala aparece en `playing` recién cuando arranca, con su etapa y su reloj", async () => {
  V.__resetAlephForTest();
  const { roomId, a1 } = await salaDeCuatro();
  assert.deepEqual(V.listAlephPlaying(T0 + 2), [], "en lobby todavía no se juega");

  const arranque = T0 + V.ALEPH_LOBBY_MS;
  const vista = (await V.getAlephRoom(roomId, a1, arranque))!;
  assert.equal(vista.status, "playing");

  assert.deepEqual(V.listAlephPlaying(arranque), [
    {
      roomId,
      stake: 0,
      seats: 4,
      alive: 4,
      stage: { index: 0, kind: "share", phase: "decide" },
      startedAt: arranque,
      deadline: arranque + V.ALEPH_PHASE_MS,
    },
  ]);
});

test("el resumen no filtra nada que la vista pública no muestre", async () => {
  V.__resetAlephForTest();
  const { roomId, a1 } = await salaDeCuatro();
  await V.getAlephRoom(roomId, a1, T0 + V.ALEPH_LOBBY_MS);
  const [s] = V.listAlephPlaying(T0 + V.ALEPH_LOBBY_MS);
  assert.deepEqual(Object.keys(s).sort(), [
    "alive",
    "deadline",
    "roomId",
    "seats",
    "stage",
    "stake",
    "startedAt",
  ]);
  assert.deepEqual(Object.keys(s.stage).sort(), ["index", "kind", "phase"]);
  const json = JSON.stringify(s);
  for (const secreto of ["secretSeed", "fragment", "events", "decisions", "passes"]) {
    assert.ok(!json.includes(secreto), `filtra ${secreto}`);
  }
});

test("una sala terminada sale de `playing`", async () => {
  V.__resetAlephForTest();
  const { roomId, a1 } = await salaDeCuatro();
  await V.getAlephRoom(roomId, a1, T0 + V.ALEPH_LOBBY_MS);
  assert.equal(V.listAlephPlaying(T0 + V.ALEPH_LOBBY_MS).length, 1);
  // Sin que nadie actúe, las fases vencen solas hasta cerrar la sala.
  const lejos = T0 + V.ALEPH_LOBBY_MS + 200 * V.ALEPH_PHASE_MS;
  const fin = (await V.getAlephRoom(roomId, a1, lejos))!;
  assert.equal(fin.status, "settled");
  assert.deepEqual(V.listAlephPlaying(lejos), []);
});
