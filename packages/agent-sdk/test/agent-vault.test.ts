// packages/agent-sdk/test/agent-vault.test.ts
// createAgent en La Bóveda: firma con su wallet lo que el árbitro exige, no pide
// mesas de plata, corta ante otra versión de reglas y reutiliza el pase de
// vista mientras sirve (renovándolo antes de que venza).
// Correr: node --import tsx --test packages/agent-sdk/test/agent-vault.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverMessageAddress, type Hex } from "viem";
import {
  matchmakeAuthMessage,
  vaultActionAuthMessage,
  vaultViewAuthMessage,
} from "@arcade1v1/game-sdk/auth";
import { actionLine, VAULT_RULES_V, type VaultAction } from "@arcade1v1/game-sdk/vault";
import {
  ArbiterClient,
  type VaultActBody,
  type VaultRoomView,
  type VaultViewPass,
} from "../src/client.ts";
import { createAgent, VIEW_PASS_MAX_AGE_MS } from "../src/agent.ts";

const ROOM = "0x" + "ee".repeat(32);
const T0 = 1_800_000_000_000;

/** Árbitro falso: captura lo que manda el agente y devuelve una vista fija. */
class FakeVault extends ArbiterClient {
  joins: { stake: number; address: string; auth?: { signature: string; ts: number } }[] = [];
  views: (VaultViewPass | undefined)[] = [];
  acts: { address: string; body: VaultActBody }[] = [];
  rulesV = VAULT_RULES_V;
  stage: VaultRoomView["stage"] = { index: 2, kind: "vote", phase: "decide", acted: [] };
  constructor() {
    super("http://fake");
  }
  private view(): VaultRoomView {
    return {
      roomId: ROOM,
      stake: 0,
      status: "playing",
      rulesV: this.rulesV,
      min: 4,
      max: 8,
      createdAt: 0,
      seats: [],
      stage: this.stage,
    };
  }
  async vaultJoin(stake: number, address: string, auth?: { signature: string; ts: number }) {
    this.joins.push({ stake, address, auth });
    return this.view();
  }
  async vaultView(_roomId: string, pass?: VaultViewPass) {
    this.views.push(pass);
    return this.view();
  }
  async vaultAct(_roomId: string, address: string, body: VaultActBody) {
    this.acts.push({ address, body });
    return this.view();
  }
}

test("vaultJoin: firma matchmakeAuthMessage('vault', 0, address, ts) con la wallet del agente", async () => {
  const fake = new FakeVault();
  const agent = createAgent({ client: fake });
  const v = await agent.vaultJoin(0);
  assert.equal(v.roomId, ROOM);
  const j = fake.joins[0];
  assert.equal(j.stake, 0);
  assert.equal(j.address, agent.address);
  const signer = await recoverMessageAddress({
    message: matchmakeAuthMessage("vault", 0, agent.address, j.auth!.ts),
    signature: j.auth!.signature as Hex,
  });
  assert.equal(signer.toLowerCase(), agent.address.toLowerCase());
  // Sin argumento, la mesa gratis.
  await agent.vaultJoin();
  assert.equal(fake.joins[1].stake, 0);
});

test("vaultJoin: rechaza mesas de plata sin pedir asiento, y otra versión de reglas", async () => {
  const fake = new FakeVault();
  const agent = createAgent({ client: fake });
  await assert.rejects(() => agent.vaultJoin(1), /no deposita on-chain/);
  assert.equal(fake.joins.length, 0, "no llegó a pedir asiento");
  fake.rulesV = VAULT_RULES_V + 1;
  await assert.rejects(
    () => agent.vaultJoin(0),
    (e: Error) => /rules version mismatch/.test(e.message) && /update/.test(e.message),
  );
});

test("vaultView: pide la vista privada con un pase firmado, lo reutiliza y lo renueva al envejecer", async () => {
  let now = T0;
  const fake = new FakeVault();
  const agent = createAgent({ client: fake, clock: () => now });
  await agent.vaultView(ROOM);
  now += 60_000;
  await agent.vaultView(ROOM);
  const [p1, p2] = fake.views;
  assert.ok(p1 && p2);
  assert.equal(p1.address, agent.address);
  assert.equal(p1.ts, T0);
  assert.equal(p2.signature, p1.signature, "dentro de la ventana se reutiliza el mismo pase");
  const signer = await recoverMessageAddress({
    message: vaultViewAuthMessage(ROOM, agent.address, p1.ts),
    signature: p1.signature as Hex,
  });
  assert.equal(signer.toLowerCase(), agent.address.toLowerCase());
  now = T0 + VIEW_PASS_MAX_AGE_MS; // el árbitro acepta 10 min; renovamos antes
  await agent.vaultView(ROOM);
  const p3 = fake.views[2]!;
  assert.equal(p3.ts, now);
  assert.notEqual(p3.signature, p1.signature, "el pase viejo se renueva antes de vencer");
});

test("vaultAct: firma vaultActionAuthMessage con la etapa/fase dadas; sin `at` las toma de la vista", async () => {
  const fake = new FakeVault();
  const agent = createAgent({ client: fake });
  const target = "0x" + "2".repeat(40);
  const action: VaultAction = { type: "vote", target };
  await agent.vaultAct(ROOM, action, { stage: 2, phase: "decide" });
  const a = fake.acts[0];
  assert.equal(a.address, agent.address);
  assert.deepEqual(a.body.action, action);
  assert.equal(a.body.stage, 2);
  assert.equal(a.body.phase, "decide");
  assert.equal(fake.views.length, 0, "con `at` no consulta la vista");
  const signer = await recoverMessageAddress({
    message: vaultActionAuthMessage(ROOM, 2, "decide", actionLine(action), a.body.ts),
    signature: a.body.signature as Hex,
  });
  assert.equal(signer.toLowerCase(), agent.address.toLowerCase());
  // Sin `at`: consulta la vista (con pase) y usa su etapa/fase.
  fake.stage = { index: 5, kind: "lock", phase: "talk", acted: [] };
  await agent.vaultAct(ROOM, { type: "ready" });
  assert.equal(fake.views.length, 1, "consultó la vista una vez");
  assert.ok(fake.views[0], "y lo hizo con pase");
  assert.equal(fake.acts[1].body.stage, 5);
  assert.equal(fake.acts[1].body.phase, "talk");
});

test("vaultAct sin `at` falla claro si la sala no está en juego", async () => {
  const fake = new FakeVault();
  fake.stage = undefined;
  const agent = createAgent({ client: fake });
  await assert.rejects(() => agent.vaultAct(ROOM, { type: "ready" }), /not playing/);
  assert.equal(fake.acts.length, 0);
});
