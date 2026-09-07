// apps/server/test/aleph-sdk-e2e.test.ts
// El SDK REAL contra el router REAL, con REQUIRE_AUTH como en producción: cuatro
// agentes del agent-sdk se sientan, juegan hasta `settled` y el registro
// verifica. Si el cliente y el árbitro dejan de hablar el mismo idioma (una
// ruta, un campo, la query del pase, la firma), se nota acá y no en Render.
// Correr: node --import tsx --test apps/server/test/aleph-sdk-e2e.test.ts
import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgent, randomWallet, signAlephView, type AlephRoomView } from "@arcade1v1/agent-sdk";
import type { AlephAction } from "@arcade1v1/game-sdk/aleph";

// Como en producción: firma obligatoria. Con 4 asientos arranca (el knob solo
// puede achicar dentro de [4, 8]). Fase de una hora: la sala se juega con el
// reloj real y no tiene por qué terminar en los 2 minutos del default.
process.env.REQUIRE_AUTH = "true";
process.env.ALEPH_MAX_SEATS = "4";
process.env.ALEPH_PHASE_MS = String(60 * 60_000);
const { alephRouter } = await import("../src/aleph-routes.js");
const V = await import("../src/aleph.js");

const app = express();
app.use(express.json());
app.use(alephRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

/** Política guionada: el primer vivo guarda, el resto aporta; nadie acepta
 *  ofertas; todos votan al primer vivo que no sean ellos; pasan la Cerradura;
 *  dividen. Misma que en aleph-game.test.ts, ahora a través del SDK. */
function policy(v: AlephRoomView, me: string): AlephAction {
  const st = v.stage!;
  if (st.phase === "talk") return { type: "ready" };
  const alive = v.seats.filter((s) => s.status === "alive");
  switch (st.kind) {
    case "share":
      return { type: me === alive[0].address ? "keep" : "contribute" };
    case "offer":
      return { type: "decline" };
    case "vote":
      return { type: "vote", target: (alive.find((s) => s.address !== me) ?? alive[0]).address };
    case "lock":
      return { type: "ready" };
    default:
      return { type: "split" };
  }
}

test("cuatro agentes del SDK juegan una sala entera por HTTP firmado; el registro verifica", async () => {
  V.__resetAlephForTest();
  const agents = Array.from({ length: 4 }, () => createAgent({ arbiterUrl: BASE }));
  // Ancla la premisa del archivo (REQUIRE_AUTH=true, como en producción): sin
  // firma el árbitro tiene que negar el asiento con el motivo exacto, no un
  // 200 silencioso. Antes de jugar y sin efecto sobre las salas de abajo:
  // verifySeatAuth corre antes de tocar cualquier lobby (apps/server/src/aleph.ts).
  await assert.rejects(
    () => agents[0].client.alephJoin(0, agents[0].address),
    /400.*signature required/,
    "sin firma el árbitro no da asiento",
  );
  let v!: AlephRoomView;
  v = await agents[0].alephJoin(0);
  // Ancla el contrato real de GET /aleph/lobbies que `assertCompatibleRules`
  // (dentro de alephJoin, corrección A) consume en modo mejor-esfuerzo: si el
  // árbitro cambiara el sobre de {lobbies:[...]} a otra forma, o `stake`
  // dejara de ser number, el pre-chequeo de rulesV se apagaría en silencio y
  // este assert es lo único que lo notaría.
  const lobbies = await agents[0].client.alephLobbies();
  assert.equal(lobbies.length, 1, "el SDK ve la mesa abierta");
  assert.equal(lobbies[0].stake, 0);
  for (const a of agents.slice(1)) v = await a.alephJoin(0);
  assert.equal(v.status, "playing", "con 4 asientos (ALEPH_MAX_SEATS=4) la sala arranca");
  const roomId = v.roomId;
  assert.ok(v.you, "la respuesta del join ya es la vista privada");

  // Vista pública vs privada: sin pase no hay `you`; con el pase del SDK, sí.
  const pub = await agents[0].client.alephView(roomId);
  assert.equal(pub.you, undefined);
  const mine = await agents[0].alephView(roomId);
  assert.equal(mine.you!.status, "alive");
  // Un pase firmado por OTRA wallet para mi asiento no abre la vista privada.
  const stranger = randomWallet();
  const forged = await signAlephView({
    roomId,
    address: agents[0].address,
    privateKey: stranger.privateKey,
  });
  const spied = await agents[0].client.alephView(roomId, { address: agents[0].address, ...forged });
  assert.equal(spied.you, undefined, "un pase ajeno da la vista pública");

  // Jugar hasta el final con acciones firmadas por el SDK.
  let said = false;
  let settled: AlephRoomView | undefined;
  for (let guard = 0; guard < 400 && !settled; guard++) {
    const probe = await agents[0].client.alephView(roomId);
    if (probe.status === "settled") {
      settled = probe;
      break;
    }
    for (const a of agents) {
      const view = await a.alephView(roomId);
      const you = view.you;
      if (view.status !== "playing" || !you || you.status !== "alive" || you.decided || you.ready)
        continue;
      const at = { stage: view.stage!.index, phase: view.stage!.phase };
      if (!said) {
        said = true;
        await a.alephAct(roomId, { type: "say", text: "gm table" }, at);
      }
      await a.alephAct(roomId, policy(view, a.address.toLowerCase()), at);
    }
  }
  assert.ok(settled, "la sala terminó");
  assert.equal(
    Object.values(settled!.payouts!).reduce((x, y) => x + y, 0),
    4000,
  );
  // La vista privada final trae el rating del asiento.
  const done = await agents[1].alephView(roomId);
  assert.ok(done.rating, "rating en la vista del asiento que consulta con pase");
  assert.equal(typeof done.rating!.after, "number");

  // El registro público verifica como lo haría un tercero (mismo phaseMs que este árbitro).
  const { verifyAlephLog } = await import("../../../scripts/aleph-verify.mjs");
  const log = await agents[0].client.alephLog(roomId);
  const { ok, checks } = await verifyAlephLog(log, V.ALEPH_PHASE_MS);
  assert.equal(ok, true, JSON.stringify(checks));
  // verifyAlephLog da ok=true con badSig===0, que también es cierto para un
  // registro con CERO firmas (unsigned>0 no lo hace fallar): no alcanza como
  // respaldo de "firmas obligatorias". Este assert sí lo exige de verdad.
  assert.ok(
    log.events.every((e) => e.type !== "action" || e.signature),
    "todas las acciones del registro van firmadas",
  );
});

test("una acción de una fase vieja se rechaza con el motivo del árbitro en el error", async () => {
  V.__resetAlephForTest();
  const agents = Array.from({ length: 4 }, () => createAgent({ arbiterUrl: BASE }));
  let v!: AlephRoomView;
  for (const a of agents) v = await a.alephJoin(0);
  await assert.rejects(
    () => agents[0].alephAct(v.roomId, { type: "keep" }, { stage: 7, phase: "decide" }),
    /400.*stage or phase mismatch/,
  );
  // Un mensaje de más de 280 caracteres lo rechaza el árbitro (forma), no el SDK.
  await assert.rejects(
    () =>
      agents[0].alephAct(
        v.roomId,
        { type: "say", text: "x".repeat(281) },
        { stage: 0, phase: "decide" },
      ),
    /400.*invalid action/,
  );
});
