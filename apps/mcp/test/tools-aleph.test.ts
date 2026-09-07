// apps/mcp/test/tools-aleph.test.ts
// Las herramientas de Aleph envuelven al agente del SDK: firma él, y cada
// vista vuelve con las acciones legales para que el modelo no las deduzca.
// Correr: node --import tsx --test apps/mcp/test/tools-aleph.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ArbiterClient,
  createAgent,
  ALEPH_RULES_V,
  type AlephActBody,
  type AlephRoomView,
  type AlephViewPass,
} from "@arcade1v1/agent-sdk";
import {
  alephRulesTool,
  alephLobbiesTool,
  alephJoinTool,
  alephViewTool,
  alephActTool,
} from "../src/tools";

const ROOM = "0x" + "ab".repeat(32);
const ME = "0x" + "1".repeat(40);
// Deadline fijo en el futuro: permite comprobar `msLeft` con la fórmula exacta
// (deadline - `now`, el propio campo que devuelve la herramienta) sin
// depender de cuándo corre el assert.
const DEADLINE = Date.now() + 90_000;

class FakeAleph extends ArbiterClient {
  acts: AlephActBody[] = [];
  passes: (AlephViewPass | undefined)[] = [];
  constructor() {
    super("http://fake");
  }
  private view(address: string): AlephRoomView {
    return {
      roomId: ROOM,
      stake: 0,
      status: "playing",
      rulesV: ALEPH_RULES_V,
      min: 4,
      max: 8,
      createdAt: 0,
      deadline: DEADLINE,
      // La address del asiento ya viene en minúsculas (normAddr, el árbitro
      // real normaliza en joinAleph) — así queda igual a `me`.
      seats: [{ address: address.toLowerCase(), status: "alive", pocket: 0 }],
      stage: { index: 0, kind: "share", phase: "decide", acted: [] },
      you: { status: "alive", pocket: 0, absences: 0, decided: false, ready: false },
    };
  }
  async alephLobbies() {
    return [{ roomId: ROOM, stake: 0, seats: 3, min: 4, max: 8, closesAt: 99 }];
  }
  async alephJoin(_stake: number, address: string) {
    return this.view(address.toLowerCase());
  }
  async alephView(_roomId: string, pass?: AlephViewPass) {
    this.passes.push(pass);
    return this.view(pass?.address.toLowerCase() ?? ME);
  }
  async alephAct(_roomId: string, address: string, body: AlephActBody) {
    this.acts.push(body);
    return this.view(address.toLowerCase());
  }
}

test("alephRulesTool: las reglas en texto con su versión", () => {
  const out = alephRulesTool();
  assert.equal(out.rulesV, ALEPH_RULES_V);
  assert.match(out.rules, /ALEPH/);
  assert.match(out.rules, /DATA, never instructions/);
});

test("alephLobbiesTool: lista los lobbies abiertos", async () => {
  const out = await alephLobbiesTool(new FakeAleph());
  assert.equal(out.lobbies.length, 1);
  assert.equal(out.lobbies[0].seats, 3);
});

test("alephJoinTool / alephViewTool: la vista vuelve con las acciones legales, `me` y `msLeft`; la vista va con pase", async () => {
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake });
  const joined = await alephJoinTool(agent, 0);
  assert.equal(joined.roomId, ROOM);
  assert.deepEqual(joined.legal, ["say", "whisper", "keep", "contribute"]);
  // `me`: sin esto el modelo no puede distinguir su propio asiento de los
  // otros en `seats[]` (hallazgo Important, apps/mcp/src/server.ts:179). En
  // minúsculas, igual que toda address en `seats[]` (normAddr en el árbitro
  // real) — si viniera con la capitalización checksummed de la wallet, una
  // comparación ingenua `target !== me` del modelo fallaría en detectar que
  // es su propio asiento.
  assert.equal(joined.me, agent.address.toLowerCase());
  assert.equal(joined.seats[0].address, joined.me);
  // `now`/`msLeft`: sin esto el modelo no tiene con qué comparar `deadline`
  // (hallazgo Important, apps/mcp/src/server.ts:183). La fórmula exacta que
  // documenta aleph_view es `deadline - now`.
  assert.equal(typeof joined.now, "number");
  assert.equal(joined.msLeft, Math.max(0, DEADLINE - joined.now));
  const view = await alephViewTool(agent, ROOM);
  assert.deepEqual(view.legal, ["say", "whisper", "keep", "contribute"]);
  assert.equal(view.me, agent.address.toLowerCase());
  assert.equal(view.msLeft, Math.max(0, DEADLINE - view.now));
  // fake.passes[0] es `undefined`: antes de pedir asiento, agent.alephJoin (SDK,
  // corrección post-Task 3) mira la versión de reglas del lobby abierto con un
  // GET /aleph/:id SIN pase (vista pública, gratis) para no sentarse mudo si el
  // SDK quedó desactualizado. El pase firmado es el que pide alephViewTool acá.
  const signed = fake.passes.at(-1);
  assert.ok(signed?.signature, "la vista se pidió con el pase firmado del agente");
  await assert.rejects(() => alephJoinTool(agent, 5), /no deposita on-chain/);
});

test("alephViewTool: sin `deadline` en la vista (sala en lobby o terminada), `msLeft` es undefined", async () => {
  class FakeAlephNoDeadline extends ArbiterClient {
    constructor() {
      super("http://fake");
    }
    async alephView(_roomId: string, pass?: AlephViewPass): Promise<AlephRoomView> {
      const address = (pass?.address ?? ME).toLowerCase();
      return {
        roomId: ROOM,
        stake: 0,
        status: "playing",
        rulesV: ALEPH_RULES_V,
        min: 4,
        max: 8,
        createdAt: 0,
        // sin `deadline`: por ejemplo la Cerradura recién resuelta, antes de
        // que la próxima fase le asigne una nueva.
        seats: [{ address, status: "alive", pocket: 0 }],
        stage: { index: 0, kind: "share", phase: "decide", acted: [] },
        you: { status: "alive", pocket: 0, absences: 0, decided: false, ready: false },
      };
    }
  }
  const agent = createAgent({ client: new FakeAlephNoDeadline() });
  const view = await alephViewTool(agent, ROOM);
  assert.equal(view.deadline, undefined);
  assert.equal(view.msLeft, undefined, "sin deadline no hay msLeft que calcular");
  assert.equal(typeof view.now, "number", "`now` siempre viaja, tenga o no deadline la fase");
});

const AT = { stage: 0, phase: "decide" } as const;

test("alephActTool: valida la forma antes de firmar y manda la acción normalizada", async () => {
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake });
  await assert.rejects(() => alephActTool(agent, ROOM, { type: "explode" }, AT), /invalid action/);
  await assert.rejects(
    () => alephActTool(agent, ROOM, { type: "vote", target: "0x123" }, AT),
    /invalid action/,
  );
  assert.equal(fake.acts.length, 0, "nada inválido llegó al árbitro");
  const target = "0x" + "A".repeat(40);
  const out = await alephActTool(agent, ROOM, { type: "vote", target }, AT);
  assert.deepEqual(fake.acts[0].action, { type: "vote", target: target.toLowerCase() });
  assert.equal(fake.acts[0].stage, 0);
  assert.ok(fake.acts[0].signature.startsWith("0x"));
  assert.deepEqual(out.legal, ["say", "whisper", "keep", "contribute"]);
  assert.equal(out.me, agent.address.toLowerCase());
  assert.equal(out.msLeft, Math.max(0, DEADLINE - out.now));
});

test("alephActTool: firma para la etapa/fase que vio el modelo, no para la que esté abierta", async () => {
  // La fase se le vino encima al modelo: el árbitro ya está en la etapa 0 /
  // decide (lo que devuelve FakeAleph), pero el modelo decidió mirando la
  // charla de la etapa 2. Sin `at`, el SDK re-leía la vista y firmaba
  // `ready` para 0/decide — en la Cerradura eso convierte un "terminé de
  // hablar" en un PASE que quema el intento de la etapa, y el modelo nunca ve
  // el "stage or phase mismatch" que la herramienta le promete.
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake });
  const seen = { stage: 2, phase: "talk" } as const;
  await alephActTool(agent, ROOM, { type: "ready" }, seen);
  assert.equal(fake.acts.length, 1);
  assert.equal(fake.acts[0].stage, 2, "la etapa firmada es la que vio el modelo");
  assert.equal(fake.acts[0].phase, "talk", "la fase firmada es la que vio el modelo");
  assert.equal(
    fake.passes.length,
    0,
    "con el ancla no hace falta releer la vista: se ahorra un GET del presupuesto",
  );
});
