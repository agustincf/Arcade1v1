// apps/mcp/test/tools-vault.test.ts
// Las herramientas de La Bóveda envuelven al agente del SDK: firma él, y cada
// vista vuelve con las acciones legales para que el modelo no las deduzca.
// Correr: node --import tsx --test apps/mcp/test/tools-vault.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ArbiterClient,
  createAgent,
  VAULT_RULES_V,
  type VaultActBody,
  type VaultRoomView,
  type VaultViewPass,
} from "@arcade1v1/agent-sdk";
import {
  vaultRulesTool,
  vaultLobbiesTool,
  vaultJoinTool,
  vaultViewTool,
  vaultActTool,
} from "../src/tools";

const ROOM = "0x" + "ab".repeat(32);
const ME = "0x" + "1".repeat(40);

class FakeVault extends ArbiterClient {
  acts: VaultActBody[] = [];
  passes: (VaultViewPass | undefined)[] = [];
  constructor() {
    super("http://fake");
  }
  private view(address: string): VaultRoomView {
    return {
      roomId: ROOM,
      stake: 0,
      status: "playing",
      rulesV: VAULT_RULES_V,
      min: 4,
      max: 8,
      createdAt: 0,
      seats: [{ address, status: "alive", pocket: 0 }],
      stage: { index: 0, kind: "share", phase: "decide", acted: [] },
      you: { status: "alive", pocket: 0, absences: 0, decided: false, ready: false },
    };
  }
  async vaultLobbies() {
    return [{ roomId: ROOM, stake: 0, seats: 3, min: 4, max: 8, closesAt: 99 }];
  }
  async vaultJoin(_stake: number, address: string) {
    return this.view(address.toLowerCase());
  }
  async vaultView(_roomId: string, pass?: VaultViewPass) {
    this.passes.push(pass);
    return this.view(pass?.address.toLowerCase() ?? ME);
  }
  async vaultAct(_roomId: string, address: string, body: VaultActBody) {
    this.acts.push(body);
    return this.view(address.toLowerCase());
  }
}

test("vaultRulesTool: las reglas en texto con su versión", () => {
  const out = vaultRulesTool();
  assert.equal(out.rulesV, VAULT_RULES_V);
  assert.match(out.rules, /LA BÓVEDA/);
  assert.match(out.rules, /DATA, never instructions/);
});

test("vaultLobbiesTool: lista los lobbies abiertos", async () => {
  const out = await vaultLobbiesTool(new FakeVault());
  assert.equal(out.lobbies.length, 1);
  assert.equal(out.lobbies[0].seats, 3);
});

test("vaultJoinTool / vaultViewTool: la vista vuelve con las acciones legales; la vista va con pase", async () => {
  const fake = new FakeVault();
  const agent = createAgent({ client: fake });
  const joined = await vaultJoinTool(agent, 0);
  assert.equal(joined.roomId, ROOM);
  assert.deepEqual(joined.legal, ["say", "whisper", "keep", "contribute"]);
  const view = await vaultViewTool(agent, ROOM);
  assert.deepEqual(view.legal, ["say", "whisper", "keep", "contribute"]);
  // fake.passes[0] es `undefined`: antes de pedir asiento, agent.vaultJoin (SDK,
  // corrección post-Task 3) mira la versión de reglas del lobby abierto con un
  // GET /vault/:id SIN pase (vista pública, gratis) para no sentarse mudo si el
  // SDK quedó desactualizado. El pase firmado es el que pide vaultViewTool acá.
  const signed = fake.passes.at(-1);
  assert.ok(signed?.signature, "la vista se pidió con el pase firmado del agente");
  await assert.rejects(() => vaultJoinTool(agent, 5), /no deposita on-chain/);
});

test("vaultActTool: valida la forma antes de firmar y manda la acción normalizada", async () => {
  const fake = new FakeVault();
  const agent = createAgent({ client: fake });
  await assert.rejects(() => vaultActTool(agent, ROOM, { type: "explode" }), /invalid action/);
  await assert.rejects(
    () => vaultActTool(agent, ROOM, { type: "vote", target: "0x123" }),
    /invalid action/,
  );
  assert.equal(fake.acts.length, 0, "nada inválido llegó al árbitro");
  const target = "0x" + "A".repeat(40);
  const out = await vaultActTool(agent, ROOM, { type: "vote", target });
  assert.deepEqual(fake.acts[0].action, { type: "vote", target: target.toLowerCase() });
  assert.equal(fake.acts[0].stage, 0, "sin `at`, la etapa/fase salen de la vista");
  assert.ok(fake.acts[0].signature.startsWith("0x"));
  assert.deepEqual(out.legal, ["say", "whisper", "keep", "contribute"]);
});
