import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverMessageAddress } from "viem";
import { scoreAuthMessage } from "@arcade1v1/game-sdk/auth";
import { verify2048, type Replay2048 } from "@arcade1v1/game-sdk/g2048";
import { ArbiterClient, createAgent } from "@arcade1v1/agent-sdk";
import { matchmakeTool, playAndSubmitTool, getResultTool } from "../src/tools";

class FakeArbiter extends ArbiterClient {
  public submitted?: { id: string; address: string; score: number; replay: unknown; signature?: string };
  constructor() {
    super("http://fake");
  }
  async matchmake(game: string, stake: number, address: string) {
    return { matchId: "0x" + "ab".repeat(32), game, stake, seed: 4242, status: "waiting", scores: {} } as any;
  }
  async submitScore(id: string, address: string, score: number, replay?: unknown, signature?: string) {
    this.submitted = { id, address, score, replay, signature };
    return { matchId: id, game: "2048", stake: 5, seed: 4242, status: "settled", scores: { [address]: score } } as any;
  }
  async getMatch(id: string) {
    return { matchId: id, game: "2048", stake: 5, seed: 4242, status: "settled", scores: {} } as any;
  }
}

test("matchmakeTool rechaza un juego desconocido", async () => {
  const agent = createAgent({ client: new FakeArbiter() });
  await assert.rejects(() => matchmakeTool(agent, "ajedrez", 5), /unknown game|juego/i);
});

test("playAndSubmitTool juega la semilla de la partida, firma y envía un score verificable", async () => {
  const fake = new FakeArbiter();
  const agent = createAgent({ client: fake });
  await playAndSubmitTool(agent, "2048", 5);
  const s = fake.submitted!;
  assert.equal((s.replay as Replay2048).seed, 4242);
  assert.equal(verify2048(s.replay as Replay2048), s.score);
  const signer = await recoverMessageAddress({
    message: scoreAuthMessage(s.id, agent.address, s.score),
    signature: s.signature as `0x${string}`,
  });
  assert.equal(signer.toLowerCase(), agent.address.toLowerCase());
});

test("getResultTool devuelve el estado de la partida", async () => {
  const client = new FakeArbiter();
  const out = await getResultTool(client, "0xabc");
  assert.equal(out.status, "settled");
});
