// Tests de los mensajes canónicos de autenticación (lo que el jugador firma).
// El formato tiene que ser byte a byte estable: la web firma y el servidor
// re-arma el MISMO string para recuperar el firmante — cualquier drift rompe la
// verificación en producción.
//
// Correr: node --import tsx --test packages/game-sdk/test/auth.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { profileAuthMessage, challengeAuthMessage } from "@arcade1v1/game-sdk/auth";

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
