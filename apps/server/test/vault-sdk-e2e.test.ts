// apps/server/test/vault-sdk-e2e.test.ts
// El SDK REAL contra el router REAL, con REQUIRE_AUTH como en producción: cuatro
// agentes del agent-sdk se sientan, juegan hasta `settled` y el registro
// verifica. Si el cliente y el árbitro dejan de hablar el mismo idioma (una
// ruta, un campo, la query del pase, la firma), se nota acá y no en Render.
// Correr: node --import tsx --test apps/server/test/vault-sdk-e2e.test.ts
import "../src/offline-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgent, randomWallet, signVaultView, type VaultRoomView } from "@arcade1v1/agent-sdk";
import type { VaultAction } from "@arcade1v1/game-sdk/vault";

// Como en producción: firma obligatoria. Con 4 asientos arranca (el knob solo
// puede achicar dentro de [4, 8]). Fase de una hora: la sala se juega con el
// reloj real y no tiene por qué terminar en los 2 minutos del default.
process.env.REQUIRE_AUTH = "true";
process.env.VAULT_MAX_SEATS = "4";
process.env.VAULT_PHASE_MS = String(60 * 60_000);
const { vaultRouter } = await import("../src/vault-routes.js");
const V = await import("../src/vault.js");

const app = express();
app.use(express.json());
app.use(vaultRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

/** Política guionada: el primer vivo guarda, el resto aporta; nadie acepta
 *  ofertas; todos votan al primer vivo que no sean ellos; pasan la Cerradura;
 *  dividen. Misma que en vault-game.test.ts, ahora a través del SDK. */
function policy(v: VaultRoomView, me: string): VaultAction {
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
  V.__resetVaultForTest();
  const agents = Array.from({ length: 4 }, () => createAgent({ arbiterUrl: BASE }));
  let v!: VaultRoomView;
  for (const a of agents) v = await a.vaultJoin(0);
  assert.equal(v.status, "playing", "con 4 asientos (VAULT_MAX_SEATS=4) la sala arranca");
  const roomId = v.roomId;
  assert.ok(v.you, "la respuesta del join ya es la vista privada");

  // Vista pública vs privada: sin pase no hay `you`; con el pase del SDK, sí.
  const pub = await agents[0].client.vaultView(roomId);
  assert.equal(pub.you, undefined);
  const mine = await agents[0].vaultView(roomId);
  assert.equal(mine.you!.status, "alive");
  // Un pase firmado por OTRA wallet para mi asiento no abre la vista privada.
  const stranger = randomWallet();
  const forged = await signVaultView({
    roomId,
    address: agents[0].address,
    privateKey: stranger.privateKey,
  });
  const spied = await agents[0].client.vaultView(roomId, { address: agents[0].address, ...forged });
  assert.equal(spied.you, undefined, "un pase ajeno da la vista pública");

  // Jugar hasta el final con acciones firmadas por el SDK.
  let said = false;
  let settled: VaultRoomView | undefined;
  for (let guard = 0; guard < 400 && !settled; guard++) {
    const probe = await agents[0].client.vaultView(roomId);
    if (probe.status === "settled") {
      settled = probe;
      break;
    }
    for (const a of agents) {
      const view = await a.vaultView(roomId);
      const you = view.you;
      if (view.status !== "playing" || !you || you.status !== "alive" || you.decided || you.ready)
        continue;
      const at = { stage: view.stage!.index, phase: view.stage!.phase };
      if (!said) {
        said = true;
        await a.vaultAct(roomId, { type: "say", text: "gm table" }, at);
      }
      await a.vaultAct(roomId, policy(view, a.address.toLowerCase()), at);
    }
  }
  assert.ok(settled, "la sala terminó");
  assert.equal(
    Object.values(settled!.payouts!).reduce((x, y) => x + y, 0),
    4000,
  );
  // La vista privada final trae el rating del asiento.
  const done = await agents[1].vaultView(roomId);
  assert.ok(done.rating, "rating en la vista del asiento que consulta con pase");
  assert.equal(typeof done.rating!.after, "number");

  // El registro público verifica como lo haría un tercero (mismo phaseMs que este árbitro).
  const { verifyVaultLog } = await import("../../../scripts/vault-verify.mjs");
  const log = await agents[0].client.vaultLog(roomId);
  const { ok, checks } = await verifyVaultLog(log, V.VAULT_PHASE_MS);
  assert.equal(ok, true, JSON.stringify(checks));
});

test("una acción de una fase vieja se rechaza con el motivo del árbitro en el error", async () => {
  V.__resetVaultForTest();
  const agents = Array.from({ length: 4 }, () => createAgent({ arbiterUrl: BASE }));
  let v!: VaultRoomView;
  for (const a of agents) v = await a.vaultJoin(0);
  await assert.rejects(
    () => agents[0].vaultAct(v.roomId, { type: "keep" }, { stage: 7, phase: "decide" }),
    /400.*stage or phase mismatch/,
  );
  // Un mensaje de más de 280 caracteres lo rechaza el árbitro (forma), no el SDK.
  await assert.rejects(
    () =>
      agents[0].vaultAct(
        v.roomId,
        { type: "say", text: "x".repeat(281) },
        { stage: 0, phase: "decide" },
      ),
    /400.*invalid action/,
  );
});
