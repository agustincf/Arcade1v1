// Vocabulario de Aleph: la forma canónica de cada acción (lo que se firma)
// tiene que ser estable byte a byte, y la validación tiene que rechazar todo lo
// que el motor no sabría aplicar. Correr:
//   node --import tsx --test packages/game-sdk/test/aleph-rules.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionLine, validateAction, ALEPH_RULES, ALEPH_RULES_V } from "@arcade1v1/game-sdk/aleph";
import { alephActionAuthMessage, alephViewAuthMessage } from "@arcade1v1/game-sdk/auth";
import { RULES_V } from "@arcade1v1/game-sdk/rules";

const ADDR = "0xABCDef0000000000000000000000000000000001";

test("actionLine: forma canónica, addresses en minúsculas", () => {
  assert.equal(actionLine({ type: "keep" }), "keep");
  assert.equal(actionLine({ type: "vote", target: ADDR }), `vote:${ADDR.toLowerCase()}`);
  assert.equal(actionLine({ type: "submit", code: "0417", intent: "me" }), "submit:0417:me");
  assert.equal(actionLine({ type: "say", text: "hola" }), "say:hola");
  assert.equal(
    actionLine({ type: "whisper", to: ADDR, text: "te doy mi 7" }),
    `whisper:${ADDR.toLowerCase()}:te doy mi 7`,
  );
});

test("validateAction: acepta lo válido y normaliza addresses", () => {
  assert.deepEqual(validateAction({ type: "contribute" }), { type: "contribute" });
  assert.deepEqual(validateAction({ type: "vote", target: ADDR }), {
    type: "vote",
    target: ADDR.toLowerCase(),
  });
  assert.deepEqual(validateAction({ type: "submit", code: "12345678", intent: "all" }), {
    type: "submit",
    code: "12345678",
    intent: "all",
  });
  assert.deepEqual(validateAction({ type: "say", text: "x".repeat(ALEPH_RULES.MAX_MSG_LEN) }), {
    type: "say",
    text: "x".repeat(ALEPH_RULES.MAX_MSG_LEN),
  });
});

test("validateAction: rechaza forma inválida", () => {
  const bad: unknown[] = [
    null,
    "keep",
    { type: "explode" },
    { type: "vote", target: "0x123" },
    { type: "submit", code: "12a4", intent: "all" },
    { type: "submit", code: "123456789", intent: "all" },
    { type: "submit", code: "1234", intent: "maybe" },
    { type: "say", text: "" },
    { type: "say", text: "x".repeat(ALEPH_RULES.MAX_MSG_LEN + 1) },
    { type: "say", text: "linea1\nlinea2" },
    { type: "whisper", to: ADDR, text: "tab\tno" },
    { type: "whisper", to: "nope", text: "hola" },
  ];
  for (const b of bad) assert.throws(() => validateAction(b), /invalid action/, JSON.stringify(b));
});

test("alephActionAuthMessage: formato estable, room en minúsculas", () => {
  const room = "0xAB" + "cd".repeat(31);
  assert.equal(
    alephActionAuthMessage(room, 3, "decide", "vote:0xabc", 1730000000000),
    [
      "Arcade1v1: actúo en la sala",
      `room: ${room.toLowerCase()}`,
      "stage: 3",
      "phase: decide",
      "action: vote:0xabc",
      "ts: 1730000000000",
    ].join("\n"),
  );
});

test("alephViewAuthMessage: formato estable, room y player en minúsculas", () => {
  const room = "0xAB" + "cd".repeat(31);
  assert.equal(
    alephViewAuthMessage(room, ADDR, 1730000000000),
    [
      "Arcade1v1: miro mi sala",
      `room: ${room.toLowerCase()}`,
      `player: ${ADDR.toLowerCase()}`,
      "ts: 1730000000000",
    ].join("\n"),
  );
});

test("RULES_V conoce a aleph y coincide con ALEPH_RULES_V", () => {
  assert.equal(RULES_V.aleph, ALEPH_RULES_V);
  assert.equal(ALEPH_RULES.MIN_SEATS, 4);
  assert.equal(ALEPH_RULES.MAX_SEATS, 8);
});
