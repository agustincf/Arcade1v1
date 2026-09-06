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
  type VaultLobby,
  type VaultRoomView,
  type VaultViewPass,
} from "../src/client.ts";
import { createAgent, VIEW_PASS_MAX_AGE_MS } from "../src/agent.ts";

const ROOM = "0x" + "ee".repeat(32);
const T0 = 1_800_000_000_000;

/** Árbitro falso: captura lo que manda el agente y devuelve una vista fija.
 *  `lobbies` vacío por default: así los tests que no lo tocan preservan el
 *  camino viejo (sin mesa abierta para mirar antes de sentarse). */
class FakeVault extends ArbiterClient {
  joins: { stake: number; address: string; auth?: { signature: string; ts: number } }[] = [];
  views: (VaultViewPass | undefined)[] = [];
  acts: { address: string; body: VaultActBody }[] = [];
  rulesV = VAULT_RULES_V;
  lobbies: VaultLobby[] = [];
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
  async vaultLobbies() {
    return this.lobbies;
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

test("vaultJoin: si hay mesa abierta con otra versión de reglas, corta ANTES de pedir asiento", async () => {
  const fake = new FakeVault();
  const agent = createAgent({ client: fake });
  fake.lobbies = [{ roomId: ROOM, stake: 0, seats: 3, min: 4, max: 8, closesAt: 0 }];
  fake.rulesV = VAULT_RULES_V + 1;
  await assert.rejects(
    () => agent.vaultJoin(0),
    (e: Error) => /rules version mismatch/.test(e.message) && new RegExp(ROOM).test(e.message),
  );
  assert.equal(fake.joins.length, 0, "no ensució la mesa compartida pidiendo asiento");
  // La vista pública que lo detectó fue SIN pase (nadie tiene asiento todavía).
  assert.equal(fake.views.length, 1);
  assert.equal(fake.views[0], undefined);
});

test("vaultJoin: sin mesa abierta para mirar, sigue de largo (nada que chequear todavía)", async () => {
  const fake = new FakeVault();
  const agent = createAgent({ client: fake });
  fake.lobbies = []; // primera sala de la vida del árbitro
  const v = await agent.vaultJoin(0);
  assert.equal(v.roomId, ROOM);
  assert.equal(fake.joins.length, 1, "sí pidió asiento: no había nada que mirar antes");
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

/** Árbitro falso que modela el rechazo silencioso del pase de vista: cuando
 *  `verifySigned` falla (p.ej. reloj del agente desfasado respecto del
 *  servidor), el árbitro real responde 200 con la vista PÚBLICA en vez de
 *  lanzar (getVaultRoom, apps/server/src/vault.ts) — acá, sin `you` aunque la
 *  address SÍ tenga asiento. `grantAt` controla desde qué llamada (1-based)
 *  el pase "sirve". */
class FlakyPassVault extends ArbiterClient {
  address = "";
  calls = 0;
  grantAt = 1;
  constructor() {
    super("http://fake");
  }
  async vaultView(roomId: string): Promise<VaultRoomView> {
    this.calls++;
    const granted = this.calls >= this.grantAt;
    return {
      roomId,
      stake: 0,
      status: "playing",
      rulesV: VAULT_RULES_V,
      min: 4,
      max: 8,
      createdAt: 0,
      seats: [{ address: this.address, status: "alive", pocket: 0 }],
      stage: { index: 1, kind: "vote", phase: "decide", acted: [] },
      you: granted
        ? { status: "alive", pocket: 0, absences: 0, decided: false, ready: false }
        : undefined,
    };
  }
}

test("vaultView: si el árbitro rechaza el pase en silencio (200 sin `you`), reintenta con uno fresco", async () => {
  const fake = new FlakyPassVault();
  const agent = createAgent({ client: fake });
  fake.address = agent.address;
  fake.grantAt = 2; // la primera vuelta "falla" (reloj desfasado); la segunda sirve.
  const v = await agent.vaultView(ROOM);
  assert.equal(fake.calls, 2, "reintentó una vez con un pase recién firmado");
  assert.ok(v.you, "la segunda vuelta sí trae la vista privada");
});

test("vaultView: si el pase sigue sin servir tras reintentar, falla claro (no juega a ciegas)", async () => {
  const fake = new FlakyPassVault();
  const agent = createAgent({ client: fake });
  fake.address = agent.address;
  fake.grantAt = 99; // nunca sirve dentro de este test
  await assert.rejects(() => agent.vaultView(ROOM), /view pass rejected/);
  assert.equal(fake.calls, 2, "reintentó exactamente una vez antes de resignarse");
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
