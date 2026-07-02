import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverMessageAddress } from "viem";
import { scoreAuthMessage } from "@arcade1v1/game-sdk/auth";
import { randomWallet, signScore } from "../src/sign.js";

test("la firma del score la recupera la wallet del agente", async () => {
  const w = randomWallet();
  const matchId = "0x" + "ab".repeat(32);
  const score = 1234;
  const signature = await signScore({
    matchId,
    address: w.address,
    score,
    privateKey: w.privateKey,
  });
  const signer = await recoverMessageAddress({
    message: scoreAuthMessage(matchId, w.address, score),
    signature,
  });
  assert.equal(signer.toLowerCase(), w.address.toLowerCase());
});
