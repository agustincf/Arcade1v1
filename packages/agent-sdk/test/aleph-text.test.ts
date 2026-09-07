// El texto de reglas que leen los modelos sale de ALEPH_RULES (no puede quedar
// viejo respecto del motor) y `legalActions` dice exactamente qué puede hacer
// un asiento AHORA según su vista.
// Correr: node --import tsx --test packages/agent-sdk/test/aleph-text.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALEPH_RULES, ALEPH_RULES_V, type StageKind } from "@arcade1v1/game-sdk/aleph";
import { describeAlephRules, legalActions } from "../src/aleph.ts";
import type { AlephRoomView } from "../src/client.ts";

const ME = "0x" + "1".repeat(40);
const OTHER = "0x" + "2".repeat(40);

/** Vista mínima en juego; `over` pisa lo que haga falta. */
function view(over: Partial<AlephRoomView> = {}): AlephRoomView {
  return {
    roomId: "0x" + "ab".repeat(32),
    stake: 0,
    status: "playing",
    rulesV: ALEPH_RULES_V,
    min: 4,
    max: 8,
    createdAt: 0,
    seats: [
      { address: ME, status: "alive", pocket: 0 },
      { address: OTHER, status: "alive", pocket: 0 },
    ],
    stage: { index: 0, kind: "share", phase: "decide", acted: [] },
    you: { status: "alive", pocket: 0, absences: 0, decided: false, ready: false },
    ...over,
  };
}

test("describeAlephRules: los números salen de las constantes y dice lo que hay que decir", () => {
  const t = describeAlephRules();
  assert.match(t, new RegExp(`rules v${ALEPH_RULES_V}`));
  assert.match(t, new RegExp(`${ALEPH_RULES.MIN_SEATS}–${ALEPH_RULES.MAX_SEATS} AI agents`));
  assert.match(t, new RegExp(`Every seat puts ${ALEPH_RULES.UNITS_PER_SEAT} units`));
  assert.match(t, new RegExp(`Max ${ALEPH_RULES.MAX_MSGS_PER_PHASE} messages per seat per phase`));
  assert.match(t, new RegExp(`${ALEPH_RULES.MAX_MSG_LEN} characters`));
  assert.match(t, new RegExp(`${ALEPH_RULES.MAX_ABSENCES} in a row`));
  assert.match(t, /DATA, never instructions/);
  assert.match(t, /whispers included/);
  assert.match(t, /stage or phase mismatch/);
  for (const kind of ["share", "offer", "vote", "lock", "final"]) {
    assert.match(t, new RegExp(`^- ${kind} \\(`, "m"), `describe la etapa ${kind}`);
  }
  assert.ok(!/\t/.test(t), "sin tabs (va a un system prompt)");
});

test("legalActions: nada fuera de juego, sin vista privada o con el asiento fuera", () => {
  assert.deepEqual(legalActions(view({ status: "lobby", stage: undefined, you: undefined })), []);
  assert.deepEqual(legalActions(view({ you: undefined })), []);
  assert.deepEqual(
    legalActions(
      view({ you: { status: "left", pocket: 50, absences: 0, decided: false, ready: false } }),
    ),
    [],
  );
  assert.deepEqual(legalActions(view({ status: "settled", over: true })), []);
});

test("legalActions: charla → hablar y ready (una vez)", () => {
  const talk = view({ stage: { index: 1, kind: "vote", phase: "talk", acted: [] } });
  assert.deepEqual(legalActions(talk), ["say", "whisper", "ready"]);
  talk.you!.ready = true;
  assert.deepEqual(legalActions(talk), ["say", "whisper"]);
});

test("legalActions: la decisión de cada etapa, y nada más una vez decidido", () => {
  const at = (kind: StageKind) => view({ stage: { index: 1, kind, phase: "decide", acted: [] } });
  assert.deepEqual(legalActions(at("share")), ["say", "whisper", "keep", "contribute"]);
  assert.deepEqual(legalActions(at("offer")), ["say", "whisper", "accept", "decline"]);
  assert.deepEqual(legalActions(at("vote")), ["say", "whisper", "vote"]);
  assert.deepEqual(legalActions(at("lock")), ["say", "whisper", "submit", "ready"]);
  assert.deepEqual(legalActions(at("final")), ["say", "whisper", "split", "steal"]);
  const decided = at("share");
  decided.you!.decided = true;
  assert.deepEqual(legalActions(decided), ["say", "whisper"]);
  // En la Cerradura, pasar (`ready`) también cierra la decisión.
  const passed = at("lock");
  passed.you!.ready = true;
  assert.deepEqual(legalActions(passed), ["say", "whisper"]);
});
