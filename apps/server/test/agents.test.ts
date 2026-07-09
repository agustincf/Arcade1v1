// Tests de agentes hosteados: alta validada, vista pública sin secretos, y el
// ciclo completo del runner (encolar -> jugar -> liquidar -> registrar) usando
// las funciones in-process reales de matchmaking (mismas reglas que producción,
// firmas incluidas).
//
// Correr: node --import tsx --test apps/server/test/agents.test.ts

import "../src/offline-env.js"; // corre offline con clave de prueba (ver el módulo)
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createHostedAgent,
  deleteAgent,
  getAgent,
  listAgents,
  setAgentActive,
  toView,
  MAX_AGENTS_PER_OWNER,
} from "../src/agents.js";
import { runAgentsTick } from "../src/agent-runner.js";
import { getRating } from "../src/ratings.js";

// Dueños únicos por corrida: el store persiste en disco entre corridas locales.
const suffix = Date.now().toString(16).slice(-10);
const mkOwner = (tag: string) => "0x" + (tag + suffix).padStart(40, "0");
const OWNER_A = mkOwner("a");
const OWNER_B = mkOwner("b");

const created: string[] = [];
function make(owner: string, params: Record<string, unknown>, name = "Bot") {
  const a = createHostedAgent({
    owner,
    name,
    avatar: "👾",
    game: "2048",
    strategyId: "2048.priority",
    params,
  });
  created.push(a.id);
  return a;
}

test("createHostedAgent valida juego, estrategia, nombre y params", () => {
  assert.throws(() => make(OWNER_A, {}, ""), /name/);
  assert.throws(
    () =>
      createHostedAgent({
        owner: OWNER_A,
        name: "x",
        avatar: "👾",
        game: "nope",
        strategyId: "2048.priority",
        params: {},
      }),
    /unknown game/,
  );
  assert.throws(
    () =>
      createHostedAgent({
        owner: OWNER_A,
        name: "x",
        avatar: "👾",
        game: "snake",
        strategyId: "2048.priority", // estrategia de OTRO juego
        params: {},
      }),
    /unknown strategy/,
  );
  assert.throws(
    () =>
      createHostedAgent({
        owner: "no-es-address",
        name: "x",
        avatar: "👾",
        game: "2048",
        strategyId: "2048.priority",
        params: {},
      }),
    /bad owner/,
  );

  const a = make(OWNER_A, { greed: 99, hack: true }, "  Mi Bot 2048  ");
  assert.equal(a.name, "Mi Bot 2048");
  assert.equal(a.params.greed, 1, "clampeado por validateParams");
  assert.ok(!("hack" in a.params), "clave desconocida descartada");
  assert.match(a.address, /^0x[0-9a-fA-F]{40}$/);
});

test("la vista pública jamás incluye la clave privada", () => {
  const a = getAgent(created[created.length - 1])!;
  const v = toView(a) as Record<string, unknown>;
  assert.ok(!("privateKey" in v));
  assert.ok(!JSON.stringify(v).includes(a.privateKey.slice(2, 12)));
});

test("tope de agentes por dueño", () => {
  // OWNER_A ya tiene 1; llenar hasta el tope y verificar el rechazo.
  for (let i = listAgents(OWNER_A).length; i < MAX_AGENTS_PER_OWNER; i++) {
    make(OWNER_A, {}, `Relleno ${i}`);
  }
  assert.throws(() => make(OWNER_A, {}, "Uno de más"), /max /);
  // Pausarlos: si quedan activos, el runner los empareja con los agentes del
  // test siguiente y ensucia sus asserts.
  for (const a of listAgents(OWNER_A)) setAgentActive(a.id, false);
});

test("runner: dos agentes de dueños distintos juegan y liquidan solos", async () => {
  const a = make(OWNER_B, { greed: 0, priority: ["down", "left", "right", "up"] }, "Abajo");
  // Segundo dueño distinto (address única) para que el anti-farming no lo salte.
  const ownerC = mkOwner("c");
  const c = createHostedAgent({
    owner: ownerC,
    name: "Codicioso",
    avatar: "🧠",
    game: "2048",
    strategyId: "2048.priority",
    params: { greed: 1, priority: ["up", "right", "left", "down"] },
  });
  created.push(c.id);

  // Tick 1: ambos se encolan (o se emparejan). Ticks siguientes: juegan y
  // registran. Damos algunos ticks de margen (el orden de la lista varía).
  for (let i = 0; i < 6; i++) await runAgentsTick();

  const A = getAgent(a.id)!;
  const C = getAgent(c.id)!;
  assert.equal(A.stats.matches, 1, "A jugó y registró su partida");
  assert.equal(C.stats.matches, 1, "C jugó y registró su partida");
  assert.equal(A.history.length, 1);
  assert.equal(A.history[0].matchId, C.history[0].matchId, "jugaron entre sí");
  assert.ok(["win", "loss", "draw"].includes(A.history[0].outcome));
  if (A.history[0].outcome !== "draw") {
    // ELO aplicado a las DOS identidades de la ladder.
    const rA = getRating(A.address.toLowerCase(), "2048");
    const rC = getRating(C.address.toLowerCase(), "2048");
    assert.notEqual(rA, 1000);
    assert.notEqual(rC, 1000);
    assert.equal(A.history[0].ratingDelta! + C.history[0].ratingDelta!, rA + rC - 2000);
  }
  assert.equal(A.pendingMatchId, undefined, "sin partida colgada");
});

test("anti ELO-farming: dos agentes del MISMO dueño no se emparejan", async () => {
  const ownerD = mkOwner("d");
  const d1 = createHostedAgent({
    owner: ownerD,
    name: "Gemelo 1",
    avatar: "🎲",
    game: "snake",
    strategyId: "snake.greedy",
    params: {},
  });
  const d2 = createHostedAgent({
    owner: ownerD,
    name: "Gemelo 2",
    avatar: "🎲",
    game: "snake",
    strategyId: "snake.greedy",
    params: { caution: 1 },
  });
  created.push(d1.id, d2.id);

  for (let i = 0; i < 4; i++) await runAgentsTick();

  const D1 = getAgent(d1.id)!;
  const D2 = getAgent(d2.id)!;
  assert.equal(D1.stats.matches + D2.stats.matches, 0, "no hubo partida entre gemelos");
  // Uno quedó esperando en la cola (eso está bien: puede venir un humano u
  // otro agente ajeno); el otro NI se encoló.
  assert.ok([D1, D2].filter((x) => x.pendingMatchId).length <= 1, "a lo sumo uno en cola");
});

test("limpieza: borrar los agentes creados por esta corrida", () => {
  for (const id of created) {
    if (getAgent(id)) deleteAgent(id);
  }
  assert.equal(listAgents(OWNER_A).length, 0);
});
