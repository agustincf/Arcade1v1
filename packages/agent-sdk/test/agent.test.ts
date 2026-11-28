import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverMessageAddress } from "viem";
import { scoreAuthMessage } from "@arcade1v1/game-sdk/auth";
import { verify2048, type Replay2048 } from "@arcade1v1/game-sdk/g2048";
import { ArbiterClient } from "../src/client.ts";
import { createAgent } from "../src/agent.ts";

// ArbiterClient falso: devuelve una semilla fija al emparejar y captura el envío.
class FakeArbiter extends ArbiterClient {
  public submitted?: {
    id: string;
    address: string;
    score: number;
    replay: unknown;
    signature?: string;
  };
  constructor() {
    super("http://fake");
  }
  async matchmake(game: string, stake: number, _address: string) {
    return {
      matchId: "0x" + "cd".repeat(32),
      game,
      stake,
      seed: 777,
      status: "waiting",
      scores: {},
    } as any;
  }
  async submitScore(
    id: string,
    address: string,
    score: number,
    replay?: unknown,
    signature?: string,
  ) {
    this.submitted = { id, address, score, replay, signature };
    return {
      matchId: id,
      game: "2048",
      stake: 0,
      seed: 777,
      status: "settled",
      scores: { [address]: score },
    } as any;
  }
}

test("playAndSubmit juega la semilla de la partida, firma y envía un score verificable", async () => {
  const fake = new FakeArbiter();
  const agent = createAgent({ client: fake });
  await agent.playAndSubmit({ game: "2048", stake: 0 });

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

// Una clave de prueba (la #2 de anvil, pública y sin valor) y una configuración
// de mesa de plata válida: alcanza para crear el agente sin tocar la red.
const KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const PAID = {
  rpcUrl: "http://127.0.0.1:9",
  escrow: ("0x" + "e".repeat(40)) as `0x${string}`,
  chainId: 31337,
  maxStake: 2,
} as const;

/** Un árbitro falso que cuenta los pedidos de emparejamiento y la vista. */
class CountingArbiter extends FakeArbiter {
  public matchmakes = 0;
  public gets: { id: string; address?: string }[] = [];
  async matchmake(game: string, stake: number, address: string) {
    this.matchmakes++;
    return super.matchmake(game, stake, address);
  }
  async getMatch(id: string, address?: string) {
    this.gets.push({ id, address });
    return { matchId: id, game: "2048", stake: 0, status: "waiting", scores: {} } as any;
  }
}

test("matchmake con stake > 0 se rechaza aunque haya paid1v1", async () => {
  const fake = new CountingArbiter();
  const agent = createAgent({ client: fake, privateKey: KEY, paid1v1: PAID });
  // Un asiento de plata sin depósito deja a una persona esperando: las mesas de
  // plata se juegan solo con playAndSubmit, que deposita.
  await assert.rejects(
    () => agent.matchmake("racing", 1),
    (e: Error) =>
      /matchmake only takes free seats/.test(e.message) && /playAndSubmit/.test(e.message),
  );
  assert.equal(fake.matchmakes, 0);
});

test("playAndSubmit con stake > 0 sin paid1v1 se rechaza sin emparejar", async () => {
  const fake = new CountingArbiter();
  const agent = createAgent({ client: fake });
  await assert.rejects(
    () => agent.playAndSubmit({ game: "racing", stake: 1 }),
    (e: Error) => /needs paid1v1/.test(e.message) && /not taking a seat/.test(e.message),
  );
  assert.equal(fake.matchmakes, 0);
});

test("createAgent con paid1v1 y sin privateKey no arranca", () => {
  assert.throws(
    () => createAgent({ client: new CountingArbiter(), paid1v1: PAID }),
    /paid1v1 needs privateKey/,
  );
});

test("getResult pide la vista con la propia dirección", async () => {
  const fake = new CountingArbiter();
  const agent = createAgent({ client: fake, privateKey: KEY });
  await agent.getResult("0x" + "ab".repeat(32));
  assert.deepEqual(fake.gets, [{ id: "0x" + "ab".repeat(32), address: agent.address }]);
});

test("matchmake firma con el reloj del agente", async () => {
  let got: { signature: string; ts: number } | undefined;
  class AuthArbiter extends FakeArbiter {
    async matchmake(game: string, stake: number, address: string, auth?: any) {
      got = auth;
      return super.matchmake(game, stake, address);
    }
  }
  const agent = createAgent({ client: new AuthArbiter(), clock: () => 1_700_000_000_000 });
  await agent.matchmake("2048", 0);
  assert.equal(got?.ts, 1_700_000_000_000);
});
