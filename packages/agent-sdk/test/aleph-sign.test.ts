// Las dos firmas de Aleph las recupera la wallet del agente sobre el
// mensaje canónico del game-sdk (sin drift con el árbitro).
// Correr: node --import tsx --test packages/agent-sdk/test/aleph-sign.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverMessageAddress } from "viem";
import { alephActionAuthMessage, alephViewAuthMessage } from "@arcade1v1/game-sdk/auth";
import { actionLine } from "@arcade1v1/game-sdk/aleph";
import { randomWallet, signAlephAction, signAlephView } from "../src/sign.ts";

const ROOM = "0x" + "cd".repeat(32);
const T0 = 1_800_000_000_000;

test("signAlephAction: firma la línea canónica y la recupera la wallet; ts fresco por defecto", async () => {
  const w = randomWallet();
  const action = { type: "whisper" as const, to: "0x" + "A".repeat(40), text: "mi dígito es 7" };
  const { signature, ts } = await signAlephAction({
    roomId: ROOM,
    stage: 3,
    phase: "talk",
    action,
    privateKey: w.privateKey,
  });
  assert.ok(Math.abs(Date.now() - ts) < 5_000, "ts fresco por defecto");
  const signer = await recoverMessageAddress({
    message: alephActionAuthMessage(ROOM, 3, "talk", actionLine(action), ts),
    signature,
  });
  assert.equal(signer.toLowerCase(), w.address.toLowerCase());
});

test("signAlephAction: con ts explícito la firma es reproducible", async () => {
  const w = randomWallet();
  const opts = {
    roomId: ROOM,
    stage: 0,
    phase: "decide" as const,
    action: { type: "keep" as const },
    privateKey: w.privateKey,
    ts: T0,
  };
  const a = await signAlephAction(opts);
  const b = await signAlephAction(opts);
  assert.equal(a.ts, T0);
  assert.equal(a.signature, b.signature);
});

test("signAlephView: el pase de vista lo recupera la wallet del asiento", async () => {
  const w = randomWallet();
  const { signature, ts } = await signAlephView({
    roomId: ROOM,
    address: w.address,
    privateKey: w.privateKey,
  });
  const signer = await recoverMessageAddress({
    message: alephViewAuthMessage(ROOM, w.address, ts),
    signature,
  });
  assert.equal(signer.toLowerCase(), w.address.toLowerCase());
});
