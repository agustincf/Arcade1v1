// packages/agent-sdk/test/aleph-llm.test.ts
// El loop del ejemplo LLM, sin red ni API key: 4 agentes con un cerebro doble
// juegan una sala entera contra un árbitro falso montado sobre el MOTOR REAL.
// Además: parseo tolerante de la respuesta, acciones por defecto y el texto
// que ve el modelo.
// Correr: node --import tsx --test packages/agent-sdk/test/aleph-llm.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyEvent,
  createAleph,
  phaseComplete,
  viewFor,
  ALEPH_RULES_V,
  type StageResult,
  type AlephState,
} from "@arcade1v1/game-sdk/aleph";
import {
  ArbiterClient,
  createAgent,
  type AlephActBody,
  type AlephRoomView,
  type AlephViewPass,
} from "../src/index.js";
import {
  defaultAction,
  describeAlephView,
  isFatalBrainError,
  parseBrainReply,
  playAlephRoom,
  type Brain,
} from "../examples/play-aleph-llm.js";

/** Árbitro falso sobre el motor real: una sala de 4 que arranca con el cuarto
 *  asiento y cierra cada fase cuando todos actuaron. Sin firmas ni reloj: eso lo
 *  cubre el E2E contra el router real (apps/server/test/aleph-sdk-e2e.test.ts). */
class FakeAlephArbiter extends ArbiterClient {
  readonly roomId = "0x" + "ab".repeat(32);
  seats: string[] = [];
  state?: AlephState;
  acts = 0;
  /** Intentos de mensaje que LLEGARON al árbitro (los filtrados no cuentan). */
  msgAttempts = 0;
  whisperAttempts = 0;
  /** El plazo de la fase. Inyectable: los tests del guard de plazo necesitan
   *  uno corto (o atado a un reloj falso), y el árbitro real da ~2 minutos. */
  private readonly deadlineAt: () => number;
  constructor(opts: { deadline?: () => number } = {}) {
    super("http://fake");
    this.deadlineAt = opts.deadline ?? (() => Date.now() + 120_000);
  }
  private room(address?: string): AlephRoomView {
    const base = {
      roomId: this.roomId,
      stake: 0,
      rulesV: ALEPH_RULES_V,
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
      deadline: this.deadlineAt(),
      ...v,
    };
  }
  /** `alephJoin` del SDK mira las mesas abiertas antes de sentarse (guard de
   *  versión de reglas). Sin esto la clase base saldría a la red de verdad
   *  contra http://fake en cada join: lento y ruidoso. Lista vacía = no hay
   *  mesa que mirar, el guard sigue de largo. */
  async alephLobbies() {
    return [];
  }
  async alephJoin(_stake: number, address: string) {
    const a = address.toLowerCase();
    if (!this.seats.includes(a)) this.seats.push(a);
    if (this.seats.length === 4 && !this.state) {
      this.state = createAleph("0x" + "11".repeat(32), this.seats);
    }
    return this.room(a);
  }
  async alephView(_roomId: string, pass?: AlephViewPass) {
    return this.room(pass?.address.toLowerCase());
  }
  async alephAct(_roomId: string, address: string, body: AlephActBody) {
    const a = address.toLowerCase();
    if (body.action.type === "say" || body.action.type === "whisper") this.msgAttempts++;
    if (body.action.type === "whisper") this.whisperAttempts++;
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

test("playAlephRoom: 4 agentes con cerebro guionado juegan una sala entera contra el motor real", async () => {
  const fake = new FakeAlephArbiter();
  const agents = Array.from({ length: 4 }, () => createAgent({ client: fake }));
  const results = await Promise.all(agents.map((a) => playAlephRoom(a, scripted, FAST)));
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

test("playAlephRoom: un cerebro que devuelve basura juega igual, con las acciones por defecto", async () => {
  const fake = new FakeAlephArbiter();
  const agents = Array.from({ length: 4 }, () => createAgent({ client: fake }));
  const garbage: Brain = async () => "I will not answer in JSON, sorry.";
  const results = await Promise.all(agents.map((a) => playAlephRoom(a, garbage, FAST)));
  assert.ok(results.every((r) => r.status === "settled"));
  // Todo por defecto: nadie guardó, nadie aceptó, nadie intentó la Cerradura.
  assert.ok(
    fake.state!.results.every((r) => !r.kept?.length && !r.accepted?.length && !r.solvers?.length),
  );
  assert.equal(fake.state!.messages.length, 0, "sin respuesta válida no se manda ningún mensaje");
});

test("playAlephRoom: `wait` en la charla vuelve a consultar y cae a ready al agotar los turnos", async () => {
  const fake = new FakeAlephArbiter();
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
    agents.map((a) => playAlephRoom(a, waiter, { ...FAST, maxTalkTurns: 1 })),
  );
  assert.ok(results.every((r) => r.status === "settled"));
  assert.ok(waits >= 8, "cada charla consultó al menos dos veces por asiento");
});

test("playAlephRoom: un error de credenciales aborta la sala en vez de jugarla a ciegas", async () => {
  const fake = new FakeAlephArbiter();
  const agents = Array.from({ length: 4 }, () => createAgent({ client: fake }));
  let calls = 0;
  // El texto exacto del SDK de Anthropic cuando no hay ANTHROPIC_API_KEY (la
  // resolución de credenciales pasa por PEDIDO, no en el constructor: el fallo
  // aparece recién acá, ya sentados).
  const noKey: Brain = async () => {
    calls++;
    throw new Error("Could not resolve authentication method. Expected either apiKey or authToken");
  };
  const settled = await Promise.allSettled([
    playAlephRoom(agents[0], noKey, FAST),
    ...agents.slice(1).map((a) => playAlephRoom(a, scripted, { ...FAST, maxPolls: 40 })),
  ]);
  assert.equal(settled[0].status, "rejected");
  assert.match((settled[0] as PromiseRejectedResult).reason.message, /authentication/);
  assert.equal(calls, 1, "no gasta la sala entera reintentando contra una key que no existe");
});

test("playAlephRoom: una racha de fallos del modelo corta en vez de jugar de defaults", async () => {
  const fake = new FakeAlephArbiter();
  const agents = Array.from({ length: 4 }, () => createAgent({ client: fake }));
  let calls = 0;
  // Un 529 suelto se aguanta; una racha es el mismo daño que no tener key.
  const overloaded: Brain = async () => {
    calls++;
    throw Object.assign(new Error("overloaded_error"), { status: 529 });
  };
  const settled = await Promise.allSettled([
    playAlephRoom(agents[0], overloaded, { ...FAST, maxBrainFails: 3 }),
    ...agents.slice(1).map((a) => playAlephRoom(a, scripted, { ...FAST, maxPolls: 40 })),
  ]);
  assert.equal(settled[0].status, "rejected");
  assert.match((settled[0] as PromiseRejectedResult).reason.message, /3 veces seguidas/);
  assert.equal(calls, 3, "tolera fallos sueltos y corta a los 3 seguidos");
});

/** Árbitro que tropieza en los GET de la vista de UN asiento: `fails` vistas
 *  seguidas fallan y después responde normal. Es el reinicio del árbitro por un
 *  deploy, el free tier que se despierta o un 502 del proxy. */
class FlakyViewArbiter extends FakeAlephArbiter {
  victim = "";
  fails = 0;
  seen = 0;
  async alephView(roomId: string, pass?: AlephViewPass) {
    if (pass && pass.address.toLowerCase() === this.victim && this.seen < this.fails) {
      this.seen++;
      throw new Error(`arbiter /aleph/${this.roomId} 503: Service Unavailable`);
    }
    return super.alephView(roomId, pass);
  }
}

test("playAlephRoom: un tropiezo del árbitro no mata al asiento (sigue sondeando y termina la sala)", async () => {
  const fake = new FlakyViewArbiter();
  const agents = Array.from({ length: 4 }, () => createAgent({ client: fake }));
  fake.victim = agents[0].address.toLowerCase();
  fake.fails = 2; // dos vistas seguidas caídas, después el árbitro vuelve
  const lines: string[] = [];
  const results = await Promise.all(
    agents.map((a, i) =>
      playAlephRoom(a, scripted, i === 0 ? { ...FAST, log: (l) => lines.push(l) } : FAST),
    ),
  );
  assert.ok(
    results.every((r) => r.status === "settled"),
    "la sala terminó igual: el asiento no quedó mudo",
  );
  assert.equal(fake.seen, 2, "los dos fallos ocurrieron de verdad");
  assert.ok(
    lines.some((l) => /el árbitro no respondió \(1\/6\)/.test(l)),
    "el fallo quedó registrado en el log, no tragado",
  );
});

test("playAlephRoom: una racha de fallos del árbitro sí corta, con el motivo", async () => {
  // Si el árbitro no vuelve, el asiento ya está mudo de hecho: es mejor decirlo
  // que fingir que se está jugando.
  const fake = new FlakyViewArbiter();
  const agents = Array.from({ length: 4 }, () => createAgent({ client: fake }));
  fake.victim = agents[0].address.toLowerCase();
  fake.fails = Infinity;
  const settled = await Promise.allSettled([
    playAlephRoom(agents[0], scripted, { ...FAST, maxArbiterFails: 3 }),
    ...agents.slice(1).map((a) => playAlephRoom(a, scripted, { ...FAST, maxPolls: 40 })),
  ]);
  assert.equal(settled[0].status, "rejected");
  assert.match(
    (settled[0] as PromiseRejectedResult).reason.message,
    /el árbitro falló 3 veces seguidas/,
  );
});

test("isFatalBrainError: credenciales y cuota son irrecuperables; 429 y 529 no", () => {
  assert.equal(isFatalBrainError(new Error("Could not resolve authentication method")), true);
  assert.equal(isFatalBrainError(Object.assign(new Error("nope"), { status: 401 })), true);
  assert.equal(isFatalBrainError(Object.assign(new Error("nope"), { status: 403 })), true);
  assert.equal(isFatalBrainError(new Error("invalid x-api-key")), true);
  assert.equal(isFatalBrainError(new Error("Your credit balance is too low")), true);
  assert.equal(
    isFatalBrainError(Object.assign(new Error("rate_limit_error"), { status: 429 })),
    false,
  );
  assert.equal(
    isFatalBrainError(Object.assign(new Error("overloaded_error"), { status: 529 })),
    false,
  );
  assert.equal(isFatalBrainError(new Error("fetch failed")), false);
});

test("playAlephRoom: con el plazo encima no se consulta al modelo", async () => {
  // Menos que el margen de 20 s: una respuesta que llega con la fase cerrada
  // vale lo mismo que una ausencia, así que ni se pide.
  const fake = new FakeAlephArbiter({ deadline: () => Date.now() + 5_000 });
  const agents = Array.from({ length: 4 }, () => createAgent({ client: fake }));
  let calls = 0;
  const counted: Brain = async (p, v, me) => {
    calls++;
    return scripted(p, v, me);
  };
  const results = await Promise.all(agents.map((a) => playAlephRoom(a, counted, FAST)));
  assert.ok(results.every((r) => r.status === "settled"));
  assert.equal(calls, 0, "no se gasta una llamada al modelo que no va a llegar a tiempo");
  assert.equal(fake.msgAttempts, 0);
});

test("playAlephRoom: una respuesta lenta no se postea con la vista vieja", async () => {
  // Reloj falso: el plazo va siempre 60 s por delante y el cerebro tarda 60 s
  // en pensar, así que TODA respuesta llega con el plazo encima.
  let t = 1_800_000_000_000;
  const fake = new FakeAlephArbiter({ deadline: () => t + 60_000 });
  const agents = Array.from({ length: 4 }, () => createAgent({ client: fake }));
  const slow: Brain = async (p, v, me) => {
    t += 60_000;
    return scripted(p, v, me);
  };
  const lines: string[] = [];
  const results = await Promise.all(
    agents.map((a) => playAlephRoom(a, slow, { ...FAST, now: () => t, log: (l) => lines.push(l) })),
  );
  assert.ok(results.every((r) => r.status === "settled"));
  assert.ok(
    lines.some((l) => /refresco la vista/.test(l)),
    "detectó que la respuesta llegó tarde y refrescó antes de decidir",
  );
  assert.equal(fake.msgAttempts, 0, "con el plazo encima se resigna la charla, no la decisión");
  assert.ok(
    fake.state!.results.some((r: StageResult) => r.kind === "share" && r.kept!.length === 1),
    "la decisión del cerebro llegó igual (uno guardó en el Reparto)",
  );
});

test("playAlephRoom: un mensaje rechazado no se lleva puesta la decisión de la etapa", async () => {
  // El árbitro rechaza TODO mensaje (como el rate limit de 12 POST/10 s) y
  // acepta las decisiones: la sala tiene que terminar igual.
  class NoMessagesArbiter extends FakeAlephArbiter {
    async alephAct(roomId: string, address: string, body: AlephActBody) {
      if (body.action.type === "say" || body.action.type === "whisper") {
        this.msgAttempts++;
        throw new Error("HTTP 429: rate limited");
      }
      return super.alephAct(roomId, address, body);
    }
  }
  const fake = new NoMessagesArbiter();
  const agents = Array.from({ length: 4 }, () => createAgent({ client: fake }));
  const results = await Promise.all(agents.map((a) => playAlephRoom(a, scripted, FAST)));
  assert.ok(results.every((r) => r.status === "settled"));
  assert.ok(fake.msgAttempts > 0, "hubo mensajes rechazados de verdad");
  assert.equal(fake.state!.messages.length, 0);
  assert.ok(
    fake.state!.results.some((r: StageResult) => r.kind === "share" && r.kept!.length === 1),
    "la decisión se mandó igual (uno guardó en el Reparto)",
  );
});

test("playAlephRoom: un susurro a un asiento que no está vivo se filtra antes de mandarlo", async () => {
  const fake = new FakeAlephArbiter();
  const agents = Array.from({ length: 4 }, () => createAgent({ client: fake }));
  const stray = "0x" + "de".repeat(20); // nadie de esta mesa: el motor tiraría "invalid whisper target"
  const strayWhisper: Brain = async (p, v, me) => {
    const j = JSON.parse(await scripted(p, v, me));
    return JSON.stringify({ ...j, whisper: { to: stray, text: "psst" } });
  };
  const results = await Promise.all(agents.map((a) => playAlephRoom(a, strayWhisper, FAST)));
  assert.ok(results.every((r) => r.status === "settled"));
  assert.equal(fake.whisperAttempts, 0, "el susurro imposible ni se intentó");
  assert.ok(
    fake.state!.messages.some((m) => !m.to && m.text === "hello table"),
    "los mensajes públicos siguieron saliendo",
  );
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
  const base = (kind: StageResult["kind"], phase: "talk" | "decide" = "decide"): AlephRoomView => ({
    roomId: "0x" + "ab".repeat(32),
    stake: 0,
    status: "playing",
    rulesV: ALEPH_RULES_V,
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

test("describeAlephView: cuenta la etapa, el fragmento propio, los mensajes y las acciones legales", () => {
  const me = "0x" + "1".repeat(40);
  const other = "0x" + "2".repeat(40);
  const now = 1_800_000_000_000;
  const v: AlephRoomView = {
    roomId: "0x" + "ab".repeat(32),
    stake: 0,
    status: "playing",
    rulesV: ALEPH_RULES_V,
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
  const t = describeAlephView(v, me, now);
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
  const settled = describeAlephView({ ...v, status: "settled", stage: undefined }, me, now);
  assert.match(settled, /status: settled/);
});
