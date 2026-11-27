// La ventana de "tu wallet está en otra red": qué muestra en cada momento.
//
// Antes, con la wallet en otra red, el encabezado abría la ventana de red de
// RainbowKit, que decía "Confirmar en la cartera" para siempre cuando el pedido
// no llegaba al celular (conectado con el QR de MetaMask). Ahora, pasado un
// rato sin respuesta, la ventana explica cómo cambiar la red a mano.
//
// Correr: node --import tsx --test apps/web/test/cambio-de-red.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRequestSwitch,
  nextSwitchPhase,
  showsManualHelp,
  SWITCH_STUCK_MS,
  type SwitchPhase,
} from "../app/lib/cambio-de-red.js";

test("pedir el cambio deja la ventana esperando a la wallet", () => {
  assert.equal(nextSwitchPhase("idle", "start"), "waiting");
  // Reintentar después de cancelar o de un fallo vuelve a esperar.
  assert.equal(nextSwitchPhase("rejected", "start"), "waiting");
  assert.equal(nextSwitchPhase("failed", "start"), "waiting");
});

test("sin respuesta a tiempo, explica cómo hacerlo a mano", () => {
  const stuck = nextSwitchPhase("waiting", "timeout");
  assert.equal(stuck, "stuck");
  assert.equal(showsManualHelp(stuck), true);
  // No antes: mientras espera, solo dice dónde confirmar.
  assert.equal(showsManualHelp("waiting"), false);
  assert.ok(SWITCH_STUCK_MS >= 10_000 && SWITCH_STUCK_MS <= 30_000);
});

test("un tope viejo no pisa una respuesta que ya llegó", () => {
  assert.equal(nextSwitchPhase("rejected", "timeout"), "rejected");
  assert.equal(nextSwitchPhase("failed", "timeout"), "failed");
  assert.equal(nextSwitchPhase("idle", "timeout"), "idle");
});

test("la respuesta de la wallet vale aunque llegue después del tope", () => {
  assert.equal(nextSwitchPhase("stuck", "rejected"), "rejected");
  assert.equal(nextSwitchPhase("stuck", "failed"), "failed");
  assert.equal(nextSwitchPhase("waiting", "rejected"), "rejected");
  // Sin nada pendiente, una respuesta suelta no cambia nada.
  assert.equal(nextSwitchPhase("idle", "failed"), "idle");
});

test("si la wallet no pudo, también explica cómo hacerlo a mano; si canceló, no", () => {
  assert.equal(showsManualHelp("failed"), true);
  assert.equal(showsManualHelp("rejected"), false);
  assert.equal(showsManualHelp("idle"), false);
});

test("no se pide otro cambio mientras uno está pendiente (la wallet atiende de a uno)", () => {
  const pending: SwitchPhase[] = ["waiting", "stuck"];
  for (const p of pending) assert.equal(canRequestSwitch(p), false, p);
  const free: SwitchPhase[] = ["idle", "rejected", "failed"];
  for (const p of free) assert.equal(canRequestSwitch(p), true, p);
});

test("cerrar la ventana la deja como nueva", () => {
  for (const p of ["waiting", "stuck", "rejected", "failed"] as SwitchPhase[]) {
    assert.equal(nextSwitchPhase(p, "reset"), "idle");
  }
});
