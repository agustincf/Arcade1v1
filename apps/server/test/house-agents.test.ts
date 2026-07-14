// Agentes de la casa (v4.1 Frente 1): las wallets listadas en HOUSE_WALLETS
// quedan exentas del tope por owner, y sus agentes llevan house:true en las
// vistas públicas (toView y resolveDisplay). Derivado de config del server:
// un tercero no puede marcarse "CASA" a sí mismo.
//
// Correr: node --import tsx --test apps/server/test/house-agents.test.ts

import "../src/offline-env.js"; // corre offline con clave de prueba (ver el módulo)
import { test, after } from "node:test";
import assert from "node:assert/strict";

import {
  createHostedAgent,
  deleteAgent,
  toView,
  isHouseWallet,
  MAX_AGENTS_PER_OWNER,
} from "../src/agents.js";
import { resolveDisplay } from "../src/profiles.js";

// Dueños únicos por corrida: el store persiste en disco entre corridas locales.
const suffix = Date.now().toString(16).slice(-10);
const HOUSE = "0x" + ("caa" + suffix).padStart(40, "0");
const OTHER = "0x" + ("bbb" + suffix).padStart(40, "0");

// Con mayúsculas y espacios a propósito: el parser tiene que normalizar.
process.env.HOUSE_WALLETS = ` ${HOUSE.toUpperCase()} , 0x${"f".repeat(40)} `;

const created: string[] = [];
function make(owner: string, name: string) {
  const a = createHostedAgent({
    owner,
    name,
    avatar: "👾",
    game: "2048",
    strategyId: "2048.priority",
    params: {},
  });
  created.push(a.id);
  return a;
}

after(() => {
  for (const id of created) {
    try {
      deleteAgent(id);
    } catch {
      /* ya borrado en el test */
    }
  }
});

test("isHouseWallet: normaliza mayúsculas y espacios del env", () => {
  assert.equal(isHouseWallet(HOUSE), true);
  assert.equal(isHouseWallet(HOUSE.toUpperCase()), true);
  assert.equal(isHouseWallet(OTHER), false);
  assert.equal(isHouseWallet(""), false);
});

test("la casa queda exenta del tope por owner; un dueño común sigue topado", () => {
  for (let i = 0; i < MAX_AGENTS_PER_OWNER + 1; i++) make(HOUSE, `Casa ${i}`);
  // La casa pasó el tope sin error. Un dueño común sigue topado:
  for (let i = 0; i < MAX_AGENTS_PER_OWNER - 1; i++) make(OTHER, `Bot ${i}`);
  const ultimo = make(OTHER, "Bot lleno"); // 3er agente: todavía entra
  assert.throws(() => make(OTHER, "Bot extra"), /max .* agents per owner/);
  deleteAgent(ultimo.id); // libera un lugar para el test siguiente
});

test("toView marca house:true solo para agentes de la casa", () => {
  const casa = make(HOUSE, "Etiquetado Casa");
  const ajeno = make(OTHER, "Etiquetado Ajeno");
  assert.equal(toView(casa).house, true);
  assert.equal(toView(ajeno).house, undefined);
});

test("resolveDisplay propaga house:true (ranking, replays e historial lo heredan)", () => {
  const agente = make(HOUSE, "Display Casa");
  const d = resolveDisplay(agente.address);
  assert.equal(d.name, "Display Casa");
  assert.equal(d.house, true);
});
