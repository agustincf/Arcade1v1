// Clasificación de fallos en acciones firmadas (deploy de agentes, pausar,
// perfil): separar "el usuario canceló la firma" (no es un error) de "el server
// lo rechazó" (mostrar el motivo REAL, nunca el genérico falso de conexión).
// Nace del bug "DESPLEGAR AGENTE no anda": con 3 agentes el árbitro respondía
// "max 3 agents per owner" y la UI decía "no pudimos conectar con el servidor".

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isSignCancelled,
  isChainSwitchError,
  classifySignError,
  classifyArbiterError,
  failureText,
} from "../app/lib/errors.js";

test("isSignCancelled: código EIP-1193 4001 (rechazo del usuario)", () => {
  assert.equal(isSignCancelled({ code: 4001, message: "whatever" }), true);
});

test("isSignCancelled: mensajes típicos de wallets", () => {
  assert.equal(isSignCancelled(new Error("User rejected the request.")), true);
  assert.equal(isSignCancelled(new Error("MetaMask Tx Signature: User denied")), true);
  assert.equal(isSignCancelled(new Error("user canceled request")), true);
});

test("isSignCancelled: encuentra el rechazo enterrado en la cadena de causas", () => {
  const deep = new Error("wrapped", { cause: { code: 4001 } });
  assert.equal(isSignCancelled(deep), true);
});

test("isSignCancelled: otros fallos de firma NO son cancelación", () => {
  assert.equal(isSignCancelled(new Error("Connector not connected.")), false);
  assert.equal(isSignCancelled(new Error("chain mismatch")), false);
  assert.equal(isSignCancelled(undefined), false);
});

test("isSignCancelled: no se cuelga con causas circulares", () => {
  const e: { code: number; cause?: unknown } = { code: 0 };
  e.cause = e;
  assert.equal(isSignCancelled(e), false);
});

test("classifyArbiterError: límite de agentes por wallet (con el n del server)", () => {
  assert.deepEqual(classifyArbiterError(new Error("max 3 agents per owner")), {
    kind: "agent-limit",
    max: 3,
  });
  assert.deepEqual(classifyArbiterError(new Error("max 10 agents per owner")), {
    kind: "agent-limit",
    max: 10,
  });
});

test("classifyArbiterError: red caída/timeout es 'network' (ahí sí vale el genérico)", () => {
  assert.deepEqual(classifyArbiterError(new TypeError("Failed to fetch")), { kind: "network" });
  assert.deepEqual(classifyArbiterError(new Error("The operation timed out.")), {
    kind: "network",
  });
  const abort = new Error("This operation was aborted");
  abort.name = "AbortError";
  assert.deepEqual(classifyArbiterError(abort), { kind: "network" });
});

test("classifyArbiterError: cualquier otro rechazo conserva el motivo real", () => {
  assert.deepEqual(classifyArbiterError(new Error("unknown strategy for 2048: x")), {
    kind: "server",
    reason: "unknown strategy for 2048: x",
  });
  assert.deepEqual(classifyArbiterError("boom"), { kind: "server", reason: "boom" });
});

test("isChainSwitchError: el error de wagmi 'wallet en otra red' (por nombre o mensaje)", () => {
  // Lo que llegaba a la UI con la wallet conectada en Ethereum: SwitchChainError
  // envolviendo ChainNotConfiguredError ("Chain not configured").
  const inner = new Error("Chain not configured.");
  inner.name = "ChainNotConfiguredError";
  const outer = new Error("An error occurred when attempting to switch chain.", { cause: inner });
  outer.name = "SwitchChainError";
  assert.equal(isChainSwitchError(outer), true);
  assert.equal(isChainSwitchError(new Error("chain mismatch")), true);
  assert.equal(isChainSwitchError(new Error("Connector not connected.")), false);
  assert.equal(isChainSwitchError(undefined), false);
});

test("classifySignError: cancelar > red equivocada > motivo tal cual", () => {
  assert.deepEqual(classifySignError({ code: 4001 }), { kind: "sign-cancelled" });
  const sw = new Error("An error occurred when attempting to switch chain.");
  sw.name = "SwitchChainError";
  assert.deepEqual(classifySignError(sw), { kind: "wrong-network" });
  // Rechazar el CAMBIO DE RED también es cancelación (aviso suave, no error).
  const rejectedSwitch = new Error("wrap", { cause: { code: 4001 } });
  rejectedSwitch.name = "SwitchChainError";
  assert.deepEqual(classifySignError(rejectedSwitch), { kind: "sign-cancelled" });
  assert.deepEqual(classifySignError(new Error("Connector not connected.")), {
    kind: "sign-failed",
    reason: "Connector not connected.",
  });
});

test("failureText: cada fallo mapea a una clave i18n con sus variables", () => {
  assert.deepEqual(failureText("sign", { code: 4001 }), { key: "err.signCancelled" });
  // Falló la WALLET (no el server): clave propia, sin culpar al servidor.
  assert.deepEqual(failureText("sign", new Error("Connector not connected.")), {
    key: "err.signFailed",
    vars: { reason: "Connector not connected." },
  });
  const sw = new Error("Chain not configured.");
  sw.name = "SwitchChainError";
  assert.deepEqual(failureText("sign", sw), {
    key: "err.wrongNetwork",
    vars: { chain: "Base Sepolia" },
  });
  assert.deepEqual(failureText("server", new TypeError("Failed to fetch")), {
    key: "match.error",
  });
  assert.deepEqual(failureText("server", new Error("max 3 agents per owner")), {
    key: "build.limit",
    vars: { n: 3 },
  });
  assert.deepEqual(failureText("server", new Error("agent not found")), {
    key: "err.rejected",
    vars: { reason: "agent not found" },
  });
});
