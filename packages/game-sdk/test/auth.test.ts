// Tests de los mensajes canónicos de autenticación (lo que el jugador firma).
// El formato tiene que ser byte a byte estable: la web firma y el servidor
// re-arma el MISMO string para recuperar el firmante — cualquier drift rompe la
// verificación en producción.
//
// Correr: node --import tsx --test packages/game-sdk/test/auth.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  profileAuthMessage,
  challengeAuthMessage,
  liveStartAuthMessage,
  matchmakeAuthMessage,
  normalizeModel,
  MODEL_MAX_LEN,
} from "@arcade1v1/game-sdk/auth";

test("profileAuthMessage: formato estable y address en minúsculas", () => {
  const msg = profileAuthMessage(
    "set",
    "0xABCDef0000000000000000000000000000000001",
    1730000000000,
  );
  assert.equal(
    msg,
    [
      "Arcade1v1: edito mi perfil",
      "action: set",
      "player: 0xabcdef0000000000000000000000000000000001",
      "ts: 1730000000000",
    ].join("\n"),
  );
});

test("challengeAuthMessage: formato estable y addresses en minúsculas", () => {
  const msg = challengeAuthMessage(
    "0xAAA0000000000000000000000000000000000001",
    "0xBBB0000000000000000000000000000000000002",
    1730000000000,
  );
  assert.equal(
    msg,
    [
      "Arcade1v1: desafío a un rival",
      "challenger: 0xaaa0000000000000000000000000000000000001",
      "target: 0xbbb0000000000000000000000000000000000002",
      "ts: 1730000000000",
    ].join("\n"),
  );
});

test("liveStartAuthMessage: formato estable y address en minúsculas", () => {
  const msg = liveStartAuthMessage(
    "0x" + "ab".repeat(32),
    "0xABCDef0000000000000000000000000000000001",
    1730000000000,
  );
  assert.equal(
    msg,
    [
      "Arcade1v1: empiezo mi partida en vivo",
      `match: 0x${"ab".repeat(32)}`,
      "player: 0xabcdef0000000000000000000000000000000001",
      "ts: 1730000000000",
    ].join("\n"),
  );
});

test("matchmakeAuthMessage: sin modelo, el formato de siempre (compatibilidad)", () => {
  const msg = matchmakeAuthMessage(
    "aleph",
    0,
    "0xABCDef0000000000000000000000000000000001",
    1730000000000,
  );
  assert.equal(
    msg,
    [
      "Arcade1v1: quiero emparejar",
      "game: aleph",
      "stake: 0",
      "player: 0xabcdef0000000000000000000000000000000001",
      "ts: 1730000000000",
    ].join("\n"),
  );
  // Un modelo vacío o que no normaliza a nada es lo mismo que no mandarlo.
  assert.equal(
    matchmakeAuthMessage("aleph", 0, "0xabc", 1, "  "),
    matchmakeAuthMessage("aleph", 0, "0xabc", 1),
  );
  assert.equal(
    matchmakeAuthMessage("aleph", 0, "0xabc", 1, "¿¡"),
    matchmakeAuthMessage("aleph", 0, "0xabc", 1),
  );
});

test("matchmakeAuthMessage: el modelo declarado va firmado, ya normalizado", () => {
  const msg = matchmakeAuthMessage(
    "aleph",
    2,
    "0xABCDef0000000000000000000000000000000001",
    1730000000000,
    "Claude Sonnet 5",
  );
  assert.equal(
    msg,
    [
      "Arcade1v1: quiero emparejar",
      "game: aleph",
      "stake: 2",
      "player: 0xabcdef0000000000000000000000000000000001",
      "model: claude-sonnet-5",
      "ts: 1730000000000",
    ].join("\n"),
  );
});

test("normalizeModel: minúsculas, guiones, sin basura y con tope de largo", () => {
  assert.equal(normalizeModel("Claude Sonnet 5"), "claude-sonnet-5");
  assert.equal(normalizeModel("  GPT-5.1  "), "gpt-5.1");
  assert.equal(normalizeModel("openai/gpt-5"), "openai/gpt-5");
  assert.equal(
    normalizeModel("meta-llama/llama-4-maverick:free"),
    "meta-llama/llama-4-maverick:free",
  );
  assert.equal(normalizeModel("claude - sonnet"), "claude-sonnet");
  assert.equal(normalizeModel("Claude (Opus) 5.5!"), "claude-opus-5.5");
  assert.equal(normalizeModel("modèle"), "mod-le");
  // Sin `<`, `>`, comillas ni paréntesis: se muestra en público. (La `/` queda:
  // es parte de nombres como openai/gpt-5.)
  assert.equal(normalizeModel("<script>alert(1)</script>"), "script-alert-1-/script");
  assert.equal(normalizeModel(""), undefined);
  assert.equal(normalizeModel("   "), undefined);
  assert.equal(normalizeModel("¿¡"), undefined);
  assert.equal(normalizeModel(undefined), undefined);
  assert.equal(normalizeModel(42), undefined);
  const largo = normalizeModel("a".repeat(100) + " b")!;
  assert.equal(largo.length, MODEL_MAX_LEN);
  // El tope no deja un guion colgando al final.
  assert.equal(normalizeModel("a".repeat(MODEL_MAX_LEN - 1) + " b"), "a".repeat(MODEL_MAX_LEN - 1));
  // Idempotente: normalizar lo normalizado no cambia nada (el árbitro vuelve a
  // normalizar lo que recibe y tiene que llegar al mismo string firmado).
  for (const m of ["Claude Sonnet 5", "openai/gpt-5", "x".repeat(200)]) {
    assert.equal(normalizeModel(normalizeModel(m)), normalizeModel(m));
  }
});
