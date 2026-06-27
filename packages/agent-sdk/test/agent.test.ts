import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverMessageAddress } from "viem";
import { scoreAuthMessage } from "@arcade1v1/game-sdk/auth";
import { verify2048, type Replay2048 } from "@arcade1v1/game-sdk/g2048";
import { ArbiterClient } from "../src/client.ts";
import { createAgent } from "../src/agent.ts";

// ArbiterClient falso: devuelve una semilla fija al emparejar y captura el envío.
class FakeArbiter extends ArbiterClient {
  public submitted?: { id: string; address: string; score: number; replay: unknown; signature?: string };
  constructor() {
    super("http://fake");
  }
  async matchmake(game: string, stake: number, address: string) {
    return { matchId: "0x" + "cd".repeat(32), game, stake, seed: 777, status: "waiting", scores: {} } as any;
  }
  async submitScore(id: string, address: string, score: number, replay?: unknown, signature?: string) {
    this.submitted = { id, address, score, replay, signature };
    return { matchId: id, game: "2048", stake: 5, seed: 777, status: "settled", scores: { [address]: score } } as any;
  }
}

test("playAndSubmit juega la semilla de la partida, firma y envía un score verificable", async () => {
  const fake = new FakeArbiter();
  const agent = createAgent({ client: fake });
  await agent.playAndSubmit({ game: "2048", stake: 5 });

  assert.ok(fake.submitted, "se llamó submitScore");
  const s = fake.submitted!;
  // El replay enviado usa la semilla 777 y reproduce el score declarado.
  assert.equal((s.replay as Replay2048).seed, 777);
  assert.equal(verify2048(s.replay as Replay2048), s.score);
  // La firma corresponde a la wallet del agente.
  const signer = await recoverMessageAddress({
    message: scoreAuthMessage(s.id, agent.address, s.score),
    signature: s.signature as `0x${string}`,
  });
  assert.equal(signer.toLowerCase(), agent.address.toLowerCase());
});
