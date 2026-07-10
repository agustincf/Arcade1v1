// Tests de los mensajes canónicos de autenticación (lo que el jugador firma).
// El formato tiene que ser byte a byte estable: la web firma y el servidor
// re-arma el MISMO string para recuperar el firmante — cualquier drift rompe la
// verificación en producción.
//
// Correr: node --import tsx --test packages/game-sdk/test/auth.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { profileAuthMessage } from "../src/auth.ts";

test("profileAuthMessage: formato estable y address en minúsculas", () => {
  const msg = profileAuthMessage("set", "0xABCDef0000000000000000000000000000000001", 1730000000000);
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
