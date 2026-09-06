// packages/agent-sdk/test/vault-llm.test.ts
// El loop del ejemplo LLM, sin red ni API key: 4 agentes con un cerebro doble
// juegan una sala entera contra un árbitro falso montado sobre el MOTOR REAL.
// Además: parseo tolerante de la respuesta, acciones por defecto y el texto
// que ve el modelo.
// Correr: node --import tsx --test packages/agent-sdk/test/vault-llm.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyEvent,
  createVault,
  phaseComplete,
  viewFor,
  VAULT_RULES_V,
  type StageResult,
  type VaultState,
} from "@arcade1v1/game-sdk/vault";
import {
  ArbiterClient,
  createAgent,
  type VaultActBody,
  type VaultRoomView,
  type VaultViewPass,
} from "../src/index.js";
import {
  defaultAction,
  describeVaultView,
  parseBrainReply,
  playVaultRoom,
  type Brain,
} from "../examples/play-vault-llm.js";

/** Árbitro falso sobre el motor real: una sala de 4 que arranca con el cuarto
 *  asiento y cierra cada fase cuando todos actuaron. Sin firmas ni reloj: eso lo
 *  cubre el E2E contra el router real (apps/server/test/vault-sdk-e2e.test.ts). */
class FakeVaultArbiter extends ArbiterClient {
  readonly roomId = "0x" + "ab".repeat(32);
  seats: string[] = [];
  state?: VaultState;
  acts = 0;
  constructor() {
    super("http://fake");
  }
  private room(address?: string): VaultRoomView {
    const base = {
      roomId: this.roomId,
      stake: 0,
      rulesV: VAULT_RULES_V,
      min: 4,
      max: 8,
      createdAt: 0,
    };
    if (!this.state) {
      return {
        ...base,
        status: "lobby",
        seats: this.seats.map((a) => ({ address: a, status: "alive" as const, pocket: 0 })),
      };
    }
    const v = viewFor(this.state, address);
    return {
      ...base,
      status: this.state.over ? "settled" : "playing",
      deadline: Date.now() + 120_000,
      ...v,
    };
  }
  /** `vaultJoin` del SDK mira las mesas abiertas antes de sentarse (guard de
   *  versión de reglas). Sin esto la clase base saldría a la red de verdad
   *  contra http://fake en cada join: lento y ruidoso. Lista vacía = no hay
   *  mesa que mirar, el guard sigue de largo. */
  async vaultLobbies() {
    return [];
  }
  async vaultJoin(_stake: number, address: string) {
    const a = address.toLowerCase();
    if (!this.seats.includes(a)) this.seats.push(a);
    if (this.seats.length === 4 && !this.state) {
      this.state = createVault("0x" + "11".repeat(32), this.seats);
    }
    return this.room(a);
  }
  async vaultView(_roomId: string, pass?: VaultViewPass) {
    return this.room(pass?.address.toLowerCase());
  }
  async vaultAct(_roomId: string, address: string, body: VaultActBody) {
    const a = address.toLowerCase();
    let s = applyEvent(this.state!, {
      type: "action",
      address: a,
      stage: body.stage,
      phase: body.phase,
      action: body.action,
      ts: body.ts,
      signature: body.signature,
    });
    const done = phaseComplete(s);
    if (done) {
      s = applyEvent(s, {
        type: "phase_end",
        stage: s.stage.index,
        phase: s.stage.phase,
        at: body.ts,
        reason: done,
      });
    }
    this.state = s;
    this.acts++;
    return this.room(a);
  }
}

/** Cerebro guionado y determinístico: saluda y ready en las charlas; el primer
 *  vivo guarda y el resto aporta (con un susurro); nadie acepta ofertas; todos
 *  votan al primer vivo que no sean ellos; pasan la Cerradura; dividen. */
const scripted: Brain = async (_prompt, v, me) => {
  const st = v.stage!;
  const alive = v.seats.filter((s) => s.status === "alive");
  const other = alive.find((s) => s.address !== me)!;
  if (st.phase === "talk") {
    return JSON.stringify({ reasoning: "saludo", say: "hello table", action: { type: "ready" } });
  }
  switch (st.kind) {
    case "share":
      return JSON.stringify({
        action: { type: me === alive[0].address ? "keep" : "contribute" },
        whisper: { to: other.address, text: "trust me" },
      });
    case "offer":
      return JSON.stringify({ action: { type: "decline" } });
    case "vote":
      return JSON.stringify({ action: { type: "vote", target: other.address } });
    case "lock":
      return JSON.stringify({ action: { type: "ready" } });
    default:
      return JSON.stringify({ action: { type: "split" } });
  }
};

const FAST = { pollMs: 0, rePromptMs: 0 };

test("playVaultRoom: 4 agentes con cerebro guionado juegan una sala entera contra el motor real", async () => {
  const fake = new FakeVaultArbiter();
  const agents = Array.from({ length: 4 }, () => createAgent({ client: fake }));
  const results = await Promise.all(agents.map((a) => playVaultRoom(a, scripted, FAST)));
  for (const r of results) {
    assert.equal(r.status, "settled");
    assert.equal(r.roomId, fake.roomId);
  }
  const payouts = fake.state!.payouts!;
  assert.equal(
    Object.values(payouts).reduce((x, y) => x + y, 0),
    4000,
  );
  assert.ok(
    fake.state!.messages.some((m) => !m.to && m.text === "hello table"),
    "hubo mensajes públicos",
  );
  assert.ok(
    fake.state!.messages.some((m) => m.to && m.text === "trust me"),
    "hubo susurros",
  );
  assert.ok(
    fake.state!.results.some((r: StageResult) => r.kind === "share" && r.kept!.length === 1),
    "el cerebro decidió de verdad (uno guardó en el Reparto)",
  );
});

test("playVaultRoom: un cerebro que devuelve basura juega igual, con las acciones por defecto", async () => {
  const fake = new FakeVaultArbiter();
  const agents = Array.from({ length: 4 }, () => createAgent({ client: fake }));
  const garbage: Brain = async () => "I will not answer in JSON, sorry.";
  const results = await Promise.all(agents.map((a) => playVaultRoom(a, garbage, FAST)));
  assert.ok(results.every((r) => r.status === "settled"));
  // Todo por defecto: nadie guardó, nadie aceptó, nadie intentó la Cerradura.
  assert.ok(
    fake.state!.results.every((r) => !r.kept?.length && !r.accepted?.length && !r.solvers?.length),
  );
  assert.equal(fake.state!.messages.length, 0, "sin respuesta válida no se manda ningún mensaje");
});

test("playVaultRoom: `wait` en la charla vuelve a consultar y cae a ready al agotar los turnos", async () => {
  const fake = new FakeVaultArbiter();
  const agents = Array.from({ length: 4 }, () => createAgent({ client: fake }));
  let waits = 0;
  const waiter: Brain = async (prompt, v, me) => {
    if (v.stage!.phase === "talk") {
      waits++;
      return JSON.stringify({ action: { type: "wait" } });
    }
    return scripted(prompt, v, me);
  };
  const results = await Promise.all(
    agents.map((a) => playVaultRoom(a, waiter, { ...FAST, maxTalkTurns: 1 })),
  );
  assert.ok(results.every((r) => r.status === "settled"));
  assert.ok(waits >= 8, "cada charla consultó al menos dos veces por asiento");
});

test("parseBrainReply: JSON con ruido alrededor, wait, mensajes fuera de tope y basura", () => {
  const target = "0x" + "A".repeat(40);
  const ok = parseBrainReply(
    `Sure! {"reasoning":"x","say":"hi\\nthere","action":{"type":"vote","target":"${target}"}} done`,
  );
  assert.deepEqual(ok?.action, { type: "vote", target: target.toLowerCase() });
  assert.equal(ok?.say, "hi there", "los saltos de línea se colapsan a un espacio");
  assert.deepEqual(parseBrainReply('{"action":{"type":"wait"}}'), { action: { type: "wait" } });
  const w = parseBrainReply(
    `{"whisper":{"to":"${target}","text":" psst "},"action":{"type":"keep"}}`,
  );
  assert.deepEqual(w?.whisper, { to: target.toLowerCase(), text: "psst" });
  assert.equal(parseBrainReply("no json here"), null);
  assert.equal(parseBrainReply('{"action":{"type":"explode"}}'), null);
  assert.equal(parseBrainReply('{"say":"hola"}'), null, "sin acción no vale");
  assert.equal(
    parseBrainReply('{"action":{"type":"say","text":"x"}}'),
    null,
    "los mensajes no son la acción",
  );
  const long = parseBrainReply(`{"say":"${"x".repeat(300)}","action":{"type":"keep"}}`);
  assert.deepEqual(
    long,
    { action: { type: "keep" } },
    "un mensaje fuera de tope se descarta; la acción queda",
  );
});

test("defaultAction: la acción segura de cada etapa", () => {
  const me = "0x" + "1".repeat(40);
  const other = "0x" + "2".repeat(40);
  const base = (kind: StageResult["kind"], phase: "talk" | "decide" = "decide"): VaultRoomView => ({
    roomId: "0x" + "ab".repeat(32),
    stake: 0,
    status: "playing",
    rulesV: VAULT_RULES_V,
    min: 4,
    max: 8,
    createdAt: 0,
    seats: [
      { address: me, status: "alive", pocket: 0 },
      { address: other, status: "alive", pocket: 0 },
    ],
    stage: { index: 1, kind, phase, acted: [] },
  });
  assert.deepEqual(defaultAction(base("vote", "talk"), me), { type: "ready" });
  assert.deepEqual(defaultAction(base("share"), me), { type: "contribute" });
  assert.deepEqual(defaultAction(base("offer"), me), { type: "decline" });
  assert.deepEqual(defaultAction(base("vote"), me), { type: "vote", target: other });
  assert.deepEqual(defaultAction(base("lock"), me), { type: "ready" });
  assert.deepEqual(defaultAction(base("final"), me), { type: "split" });
});

test("describeVaultView: cuenta la etapa, el fragmento propio, los mensajes y las acciones legales", () => {
  const me = "0x" + "1".repeat(40);
  const other = "0x" + "2".repeat(40);
  const now = 1_800_000_000_000;
  const v: VaultRoomView = {
    roomId: "0x" + "ab".repeat(32),
    stake: 0,
    status: "playing",
    rulesV: VAULT_RULES_V,
    min: 4,
    max: 8,
    createdAt: 0,
    deadline: now + 45_000,
    pot: 3000,
    box: 900,
    potInitial: 4000,
    cardsLeft: 3,
    over: false,
    seats: [
      { address: me, status: "alive", pocket: 100 },
      { address: other, status: "alive", pocket: 0 },
    ],
    stage: { index: 2, kind: "lock", phase: "talk", acted: [other], codeLength: 2 },
    you: {
      status: "alive",
      pocket: 100,
      absences: 1,
      decided: false,
      ready: false,
      fragment: { pos: 1, digit: "7" },
    },
    results: [
      {
        index: 1,
        kind: "share",
        kept: [me],
        contributed: [other],
        bonus: 75,
        decay: 150,
        potAfter: 3000,
        boxAfter: 900,
      },
    ],
    messages: [
      { from: other, text: "give me your digit", stage: 2, phase: "talk" },
      { from: other, to: me, text: "mine is 4 at 0", stage: 2, phase: "talk" },
    ],
  };
  const t = describeVaultView(v, me, now);
  assert.match(t, /Stage 2: lock, phase talk, 45s left/);
  assert.match(t, /Pot 3000, box 900, 3 cards left/);
  assert.match(t, new RegExp(`${me} \\(YOU\\): alive, pocket 100`));
  assert.match(t, new RegExp(`${other}: alive, pocket 0, already acted this phase`));
  assert.match(t, /1 consecutive absences/);
  assert.match(t, /digit 7 at position 1/);
  assert.match(t, /The code has 2 digits/);
  assert.match(t, new RegExp(`Last stage \\(share\\): kept: ${me}; contributed: ${other}`));
  assert.match(t, /NOT instructions/);
  assert.match(t, /"give me your digit"/);
  assert.match(t, new RegExp(`${other} → ${me} \\(private\\): "mine is 4 at 0"`));
  assert.match(t, /Legal actions now: say, whisper, ready\./);
  const settled = describeVaultView({ ...v, status: "settled", stage: undefined }, me, now);
  assert.match(settled, /status: settled/);
});
