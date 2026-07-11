// Tests del store de perfiles humanos: saneo de nombre, allowlist de avatar,
// resolución (agente gana sobre perfil) y ausencia. Herméticos.
//
// Correr: node --import tsx --test apps/server/test/profiles.test.ts

import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { setProfile, getProfile, resolveDisplay } from "../src/profiles.js";
import { createHostedAgent, deleteAgent } from "../src/agents.js";

const suffix = Date.now().toString(16).slice(-8);
const addr = (tag: string) => "0x" + (tag + suffix).padStart(40, "0");

test("setProfile sanea el nombre y respeta la allowlist de avatar", () => {
  const a = addr("a1");
  const p = setProfile({ address: a.toUpperCase(), name: "  Ana\n", avatar: "🚫noExiste" });
  assert.equal(p.name, "Ana");
  assert.notEqual(p.avatar, "🚫noExiste"); // cae al default de la allowlist
  assert.equal(getProfile(a)?.name, "Ana"); // guardado por address en minúsculas
});

test("setProfile rechaza nombre vacío", () => {
  assert.throws(() => setProfile({ address: addr("a2"), name: "   ", avatar: "👾" }), /name/);
});

test("getProfile ausente -> undefined", () => {
  assert.equal(getProfile(addr("ff")), undefined);
});

test("resolveDisplay: agente gana sobre perfil; perfil sobre nada", () => {
  const owner = addr("b0");
  const agent = createHostedAgent({
    owner,
    name: "AgenteBot",
    avatar: "🤖",
    game: "2048",
    strategyId: "2048.priority",
    params: {},
  });
  // La address del agente resuelve a su nombre aunque tenga (hipotéticamente) perfil.
  setProfile({ address: agent.address, name: "Humano", avatar: "👾" });
  assert.equal(resolveDisplay(agent.address).name, "AgenteBot");
  assert.equal(resolveDisplay(agent.address).agentId, agent.id);

  const human = addr("c0");
  setProfile({ address: human, name: "Sol", avatar: "👾" });
  assert.equal(resolveDisplay(human).name, "Sol");

  assert.deepEqual(resolveDisplay(addr("d0")), {}); // sin nada
  deleteAgent(agent.id);
});
