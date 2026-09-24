// apps/mcp/test/tools-aleph.test.ts
// Las herramientas de Aleph envuelven al agente del SDK: firma él, y cada
// vista vuelve con las acciones legales para que el modelo no las deduzca. La
// plata falla cerrada: sin el pin de escrow del operador, ni asiento en una
// mesa de plata ni depósito.
// Correr: node --import tsx --test apps/mcp/test/tools-aleph.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey } from "viem/accounts";
import {
  ArbiterClient,
  createAgent,
  ALEPH_RULES_V,
  type AlephActBody,
  type AlephDeposit,
  type AlephRoomStatus,
  type AlephRoomView,
  type AlephViewPass,
} from "@arcade1v1/agent-sdk";
import {
  alephRulesTool,
  alephLobbiesTool,
  alephJoinTool,
  alephViewTool,
  alephActTool,
  alephDepositTool,
  alephWithdrawTool,
} from "../src/tools";
// El mismo RPC falso de los tests del SDK: llega hasta `eth_sendRawTransaction`
// y anota lo que la wallet transmitiría.
import { fakeRpc } from "../../../packages/agent-sdk/test/fake-rpc";

const ROOM = "0x" + "ab".repeat(32);
const ME = "0x" + "1".repeat(40);
/** El escrow que el operador clavaría con ARCADE_ALEPH_ESCROW_ADDRESS. */
const PIN = "0x" + "e".repeat(40);
// Deadline fijo en el futuro: permite comprobar `msLeft` con la fórmula exacta
// (deadline - `now`, el propio campo que devuelve la herramienta) sin
// depender de cuándo corre el assert.
const DEADLINE = Date.now() + 90_000;

class FakeAleph extends ArbiterClient {
  acts: AlephActBody[] = [];
  passes: (AlephViewPass | undefined)[] = [];
  // Etapa 4 (mesa de plata): los tests que no los tocan quedan en el default
  // de siempre (jugando, sin nada pendiente de depósito).
  status: AlephRoomStatus = "playing";
  stake = 0;
  deposited: string[] = [];
  deposit?: AlephDeposit;
  /** Cuántas veces se pidió asiento: "no se sentó" tiene que poder fallar. */
  joins = 0;
  constructor() {
    super("http://fake");
  }
  private view(address: string): AlephRoomView {
    return {
      roomId: ROOM,
      stake: this.stake,
      status: this.status,
      rulesV: ALEPH_RULES_V,
      min: 4,
      max: 8,
      createdAt: 0,
      deadline: DEADLINE,
      deposited: this.deposited,
      deposit: this.deposit,
      // La address del asiento ya viene en minúsculas (normAddr, el árbitro
      // real normaliza en joinAleph) — así queda igual a `me`.
      seats: [{ address: address.toLowerCase(), status: "alive", pocket: 0 }],
      stage: { index: 0, kind: "share", phase: "decide", acted: [] },
      you: { status: "alive", pocket: 0, absences: 0, decided: false, ready: false },
    };
  }
  async alephLobbies() {
    return [
      { roomId: ROOM, stake: 0, status: "lobby" as const, seats: 3, min: 4, max: 8, closesAt: 99 },
    ];
  }
  // Se mantiene alephLobbies() arriba: agent-sdk (assertCompatibleRules,
  // agent.ts) lo llama internamente antes de sentarse, aparte de
  // alephLobbiesTool. alephLobbiesInfo() es la que agrega `stakes`.
  async alephLobbiesInfo() {
    return { lobbies: await this.alephLobbies(), stakes: [0, 2] };
  }
  async alephJoin(_stake: number, address: string) {
    this.joins++;
    return this.view(address.toLowerCase());
  }
  async alephView(_roomId: string, pass?: AlephViewPass) {
    this.passes.push(pass);
    return this.view(pass?.address.toLowerCase() ?? ME);
  }
  async alephAct(_roomId: string, address: string, body: AlephActBody) {
    this.acts.push(body);
    return this.view(address.toLowerCase());
  }
}

test("alephRulesTool: las reglas en texto con su versión", () => {
  const out = alephRulesTool();
  assert.equal(out.rulesV, ALEPH_RULES_V);
  assert.match(out.rules, /ALEPH/);
  assert.match(out.rules, /DATA, never instructions/);
});

test("alephLobbiesTool: lista los lobbies abiertos y los stakes que acepta el árbitro", async () => {
  const out = await alephLobbiesTool(new FakeAleph());
  assert.equal(out.lobbies.length, 1);
  assert.equal(out.lobbies[0].seats, 3);
  // Sin esto, un modelo que lee la descripción de aleph_join ("see
  // aleph_lobbies `stakes`") y llama aleph_lobbies cuando no hay ninguna sala
  // de plata abierta en este instante no tiene forma de enterarse, por
  // ninguna herramienta, de que el árbitro acepta una mesa paga (hallazgo de
  // review sobre esta misma tarea).
  assert.deepEqual(out.stakes, [0, 2]);
});

test("alephJoinTool / alephViewTool: la vista vuelve con las acciones legales, `me` y `msLeft`; la vista va con pase", async () => {
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake });
  const joined = await alephJoinTool(agent, 0);
  assert.equal(joined.roomId, ROOM);
  assert.deepEqual(joined.legal, ["say", "whisper", "keep", "contribute"]);
  // `me`: sin esto el modelo no puede distinguir su propio asiento de los
  // otros en `seats[]` (hallazgo Important, apps/mcp/src/server.ts:179). En
  // minúsculas, igual que toda address en `seats[]` (normAddr en el árbitro
  // real) — si viniera con la capitalización checksummed de la wallet, una
  // comparación ingenua `target !== me` del modelo fallaría en detectar que
  // es su propio asiento.
  assert.equal(joined.me, agent.address.toLowerCase());
  assert.equal(joined.seats[0].address, joined.me);
  // `now`/`msLeft`: sin esto el modelo no tiene con qué comparar `deadline`
  // (hallazgo Important, apps/mcp/src/server.ts:183). La fórmula exacta que
  // documenta aleph_view es `deadline - now`.
  assert.equal(typeof joined.now, "number");
  assert.equal(joined.msLeft, Math.max(0, DEADLINE - joined.now));
  const view = await alephViewTool(agent, ROOM);
  assert.deepEqual(view.legal, ["say", "whisper", "keep", "contribute"]);
  assert.equal(view.me, agent.address.toLowerCase());
  assert.equal(view.msLeft, Math.max(0, DEADLINE - view.now));
  // fake.passes[0] es `undefined`: antes de pedir asiento, agent.alephJoin (SDK,
  // corrección post-Task 3) mira la versión de reglas del lobby abierto con un
  // GET /aleph/:id SIN pase (vista pública, gratis) para no sentarse mudo si el
  // SDK quedó desactualizado. El pase firmado es el que pide alephViewTool acá.
  const signed = fake.passes.at(-1);
  assert.ok(signed?.signature, "la vista se pidió con el pase firmado del agente");
  // Sin la config de plata del operador (el default de buildServer), una mesa
  // de plata se rechaza antes de sentarse, y el motivo dice qué configurar.
  await assert.rejects(
    () => alephJoinTool(agent, 5),
    /money tables are off.*ARCADE_ALEPH_ESCROW_ADDRESS/,
  );
  // Con el pin en la config del servidor pero este agente sin wallet que
  // deposite (sin rpcUrl, privateKey ni escrow), el que se niega es el SDK,
  // también antes de sentarse.
  await assert.rejects(
    () => alephJoinTool(agent, 5, { escrow: PIN }),
    /needs a wallet that can deposit/,
  );
  assert.equal(fake.joins, 1, "solo el asiento de la mesa gratis de arriba");
});

test("alephViewTool: sin `deadline` en la vista (sala en lobby o terminada), `msLeft` es undefined", async () => {
  class FakeAlephNoDeadline extends ArbiterClient {
    constructor() {
      super("http://fake");
    }
    async alephView(_roomId: string, pass?: AlephViewPass): Promise<AlephRoomView> {
      const address = (pass?.address ?? ME).toLowerCase();
      return {
        roomId: ROOM,
        stake: 0,
        status: "playing",
        rulesV: ALEPH_RULES_V,
        min: 4,
        max: 8,
        createdAt: 0,
        // sin `deadline`: por ejemplo la Cerradura recién resuelta, antes de
        // que la próxima fase le asigne una nueva.
        seats: [{ address, status: "alive", pocket: 0 }],
        stage: { index: 0, kind: "share", phase: "decide", acted: [] },
        you: { status: "alive", pocket: 0, absences: 0, decided: false, ready: false },
      };
    }
  }
  const agent = createAgent({ client: new FakeAlephNoDeadline() });
  const view = await alephViewTool(agent, ROOM);
  assert.equal(view.deadline, undefined);
  assert.equal(view.msLeft, undefined, "sin deadline no hay msLeft que calcular");
  assert.equal(typeof view.now, "number", "`now` siempre viaja, tenga o no deadline la fase");
});

const AT = { stage: 0, phase: "decide" } as const;

test("alephActTool: valida la forma antes de firmar y manda la acción normalizada", async () => {
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake });
  await assert.rejects(() => alephActTool(agent, ROOM, { type: "explode" }, AT), /invalid action/);
  await assert.rejects(
    () => alephActTool(agent, ROOM, { type: "vote", target: "0x123" }, AT),
    /invalid action/,
  );
  assert.equal(fake.acts.length, 0, "nada inválido llegó al árbitro");
  const target = "0x" + "A".repeat(40);
  const out = await alephActTool(agent, ROOM, { type: "vote", target }, AT);
  assert.deepEqual(fake.acts[0].action, { type: "vote", target: target.toLowerCase() });
  assert.equal(fake.acts[0].stage, 0);
  assert.ok(fake.acts[0].signature.startsWith("0x"));
  assert.deepEqual(out.legal, ["say", "whisper", "keep", "contribute"]);
  assert.equal(out.me, agent.address.toLowerCase());
  assert.equal(out.msLeft, Math.max(0, DEADLINE - out.now));
});

test("alephActTool: firma para la etapa/fase que vio el modelo, no para la que esté abierta", async () => {
  // La fase se le vino encima al modelo: el árbitro ya está en la etapa 0 /
  // decide (lo que devuelve FakeAleph), pero el modelo decidió mirando la
  // charla de la etapa 2. Sin `at`, el SDK re-leía la vista y firmaba
  // `ready` para 0/decide — en la Cerradura eso convierte un "terminé de
  // hablar" en un PASE que quema el intento de la etapa, y el modelo nunca ve
  // el "stage or phase mismatch" que la herramienta le promete.
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake });
  const seen = { stage: 2, phase: "talk" } as const;
  await alephActTool(agent, ROOM, { type: "ready" }, seen);
  assert.equal(fake.acts.length, 1);
  assert.equal(fake.acts[0].stage, 2, "la etapa firmada es la que vio el modelo");
  assert.equal(fake.acts[0].phase, "talk", "la fase firmada es la que vio el modelo");
  assert.equal(
    fake.passes.length,
    0,
    "con el ancla no hace falta releer la vista: se ahorra un GET del presupuesto",
  );
});

test("aleph_view marca mustDeposit cuando la sala fondea y este asiento no depositó", async () => {
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake, rpcUrl: "http://127.0.0.1:1" });
  fake.status = "funding";
  fake.deposited = [];
  fake.deposit = {
    chainId: 31337,
    escrow: "0x" + "e".repeat(40),
    usdc: "0x" + "1".padStart(40, "0"),
    stake: "2000000",
    seats: [agent.address.toLowerCase()],
    seatsHash: "0x" + "0".repeat(64),
    fundDeadline: 1,
    playDeadline: 2,
    seatSig: "0x" + "0".repeat(130),
  };
  const v = await alephViewTool(agent, ROOM);
  assert.equal(v.mustDeposit, true);
  assert.deepEqual(v.legal, [], "sin acciones del motor mientras fondea");
  fake.deposited = [agent.address.toLowerCase()];
  assert.equal((await alephViewTool(agent, ROOM)).mustDeposit, false);
});

test("aleph_deposit: sin pin se niega y dice qué configurar; con pin, sin rpcUrl explica qué falta; con la sala en juego no manda nada", async () => {
  const fake = new FakeAleph();
  await assert.rejects(
    () => alephDepositTool(createAgent({ client: fake }), ROOM),
    /money tables are off.*ARCADE_ALEPH_ESCROW_ADDRESS.*ARCADE_PRIVATE_KEY.*RPC_URL/,
  );
  const money = { escrow: PIN, maxStake: 2 };
  await assert.rejects(
    () => alephDepositTool(createAgent({ client: fake }), ROOM, money),
    /rpcUrl/,
  );
  await assert.rejects(
    () =>
      alephDepositTool(
        createAgent({ client: fake, rpcUrl: "http://127.0.0.1:1", escrow: PIN }),
        ROOM,
        money,
      ),
    /not funding/,
  );
});

test("aleph_deposit: un error de RPC con la URL adentro no la deja pasar, sea cual sea el esquema", async () => {
  // Lo que tira el transporte de viem cuando el RPC del operador (RPC_URL)
  // está caído, limitado o mal configurado: interpola la URL completa en el
  // mensaje — a veces con una API key en el path, como arman las suyas
  // Alchemy o Infura. No hace falta red real ni un rpcUrl de verdad: al
  // agente le alcanza con que `alephDeposit` tire ese mensaje (fix de review
  // sobre esta misma tarea; ver informe).
  const schemes = [
    "https", // el caso obvio: el RPC normal.
    // Alchemy e Infura emiten endpoints wss:// junto a los https://: un
    // RPC_URL wss:// es una config real (no un esquema inventado para el
    // test), y como `createAgent` arma sus clientes con `http(opts.rpcUrl)`
    // sin mirar el esquema, TODO pedido falla (fetch nativo no abre `wss:`)
    // y viem envuelve el fallo con la URL entera en el mensaje igual. La
    // ronda 1 de este fix solo enmascaraba `https?`, así que esto se le
    // escapaba (hallazgo de review, ronda 2).
    "wss",
  ];
  for (const scheme of schemes) {
    const fakeAgent = {
      alephDeposit: async () => {
        throw new Error(
          `HTTP request failed. URL: ${scheme}://eth-sepolia.g.alchemy.com/v2/super-secreta Details: fetch failed`,
        );
      },
    } as unknown as Parameters<typeof alephDepositTool>[0];
    let caught: unknown;
    try {
      await alephDepositTool(fakeAgent, ROOM, { escrow: PIN });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof Error, `(${scheme}) sigue siendo un error: no se traga el fallo`);
    const msg = (caught as Error).message;
    // Sin enumerar esquemas acá tampoco: cualquier "://" que sobreviva es una
    // URL que se coló.
    assert.doesNotMatch(msg, /:\/\//, `(${scheme}) ninguna URL sobrevive al resultado`);
    assert.doesNotMatch(msg, /super-secreta/, `(${scheme}) tampoco la key embebida en la URL`);
    assert.match(msg, /HTTP request failed/, `(${scheme}) el resto del motivo sigue llegando`);
  }
});

test("aleph_deposit: después de depositar, `mustDeposit` vuelve en false aunque la vista leída antes diga lo contrario", async () => {
  // La vista que devuelve aleph_deposit es la de ANTES del depósito: la sala en
  // fondeo y este asiento todavía fuera de `deposited`. Calculado sobre ella,
  // `mustDeposit` diría "depositá ya" justo después de haberlo hecho.
  const fake = new FakeAleph();
  fake.status = "funding";
  fake.stake = 2;
  fake.deposit = {
    chainId: 31337,
    escrow: PIN,
    usdc: "0x" + "1".padStart(40, "0"),
    stake: "2000000",
    seats: [ME],
    seatsHash: "0x" + "0".repeat(64),
    fundDeadline: 1,
    playDeadline: 2,
    seatSig: "0x" + "0".repeat(130),
  };
  const before = await fake.alephView(ROOM);
  for (const step of ["open", "deposit", "already"] as const) {
    const fakeAgent = {
      address: ME,
      alephView: async () => before,
      alephDeposit: async () => ({
        step,
        txHash: step === "already" ? undefined : "0x" + "cd".repeat(32),
        view: before,
      }),
    } as unknown as Parameters<typeof alephDepositTool>[0];
    assert.equal(
      (await alephViewTool(fakeAgent, ROOM)).mustDeposit,
      true,
      "esa misma vista, por aleph_view, todavía pide depositar",
    );
    const out = await alephDepositTool(fakeAgent, ROOM, { escrow: PIN });
    assert.equal(out.step, step);
    assert.equal(out.mustDeposit, false, `(${step}) no invita a depositar de nuevo`);
  }
});

// ---- La prueba del review, del lado del MCP ---------------------------------
// El MCP armaba su agente con clave + RPC y SIN pin de escrow, y un árbitro que
// miente se llevaba el stake a un contrato suyo. Hoy fallan cerradas las dos
// capas: las herramientas, que sin ARCADE_ALEPH_ESCROW_ADDRESS no se sientan a
// una mesa de plata ni depositan (con el motivo para el operador), y el
// agent-sdk, que sin `escrow` en createAgent tampoco. El RPC falso llega hasta
// `eth_sendRawTransaction`, así que "no se transmitió nada" puede fallar de
// verdad: el último test es el control positivo por la misma herramienta.

const ATTACKER = "0x" + "a7".repeat(20);
const WHOLE_BALANCE = 750_000_000n; // 750 USDC: el saldo de una wallet es público

/** Pone la sala en fondeo con el bloque `deposit` que se le pida. */
function funding(fake: FakeAleph, deposit: { stake: bigint; escrow: string }): void {
  fake.status = "funding";
  fake.stake = Number(deposit.stake / 1_000_000n);
  fake.deposited = [];
  fake.deposit = {
    chainId: 31337,
    escrow: deposit.escrow,
    usdc: "0x" + "1".padStart(40, "0"),
    stake: deposit.stake.toString(),
    seats: [],
    seatsHash: "0x" + "0".repeat(64),
    fundDeadline: 1,
    playDeadline: 2,
    seatSig: "0x" + "0".repeat(130),
  };
}

/** Corre una herramienta que tiene que fallar y devuelve el error. Los tests
 *  miran PRIMERO qué se transmitió: si una defensa se cae, el fallo tiene que
 *  mostrar el approve que salió, no un mensaje distinto. */
async function toolError(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (e) {
    return e as Error;
  }
  return assert.fail("la herramienta no tenía que terminar bien");
}

test("aleph_deposit sin pin: un árbitro que miente no hace transmitir nada, falte el pin en el servidor, en el agente o en los dos", async () => {
  const rpc = await fakeRpc("0x7a69", { balance: WHOLE_BALANCE });
  try {
    // `{}` es la config exacta de la prueba del review (sin pin ni tope), con el
    // agente que armaba el MCP antes del arreglo (clave + RPC, sin pin); la
    // segunda suma el tope del operador. Frenan las dos capas, y el motivo que
    // llega es el del operador.
    for (const money of [{}, { maxStake: 750 }]) {
      const fake = new FakeAleph();
      funding(fake, { stake: WHOLE_BALANCE, escrow: ATTACKER });
      const agent = createAgent({
        client: fake,
        privateKey: generatePrivateKey(),
        rpcUrl: rpc.url,
      });
      const e = await toolError(() => alephDepositTool(agent, ROOM, money));
      assert.deepEqual(rpc.broadcasts, [], "la wallet no firmó ni transmitió nada");
      assert.deepEqual(rpc.calls, [], "ni una lectura de la cadena");
      assert.match(e.message, /money tables are off.*ARCADE_ALEPH_ESCROW_ADDRESS/);
    }

    // El guard del servidor, aislado: el agente SÍ podría depositar (trae pin, y
    // el tope le da ancla contra un árbitro que apunta a ese mismo escrow), pero
    // la plata del servidor está apagada. Sin el guard, saldría el approve.
    const able = new FakeAleph();
    funding(able, { stake: 2_000_000n, escrow: PIN });
    const pinnedAgent = createAgent({
      client: able,
      privateKey: generatePrivateKey(),
      rpcUrl: rpc.url,
      escrow: PIN,
    });
    const off = await toolError(() => alephDepositTool(pinnedAgent, ROOM, { maxStake: 2 }));
    assert.deepEqual(rpc.broadcasts, [], "con la plata apagada no se firma nada");
    assert.deepEqual(rpc.calls, [], "ni una lectura de la cadena");
    assert.match(off.message, /money tables are off.*ARCADE_ALEPH_ESCROW_ADDRESS/);

    // Y al revés, como si se borrara el cableado del pin hacia createAgent en
    // index.ts: el servidor tiene pin, el agente no. Falla cerrado igual, porque
    // el agent-sdk exige `escrow` antes de tocar la red.
    const liar = new FakeAleph();
    funding(liar, { stake: 2_000_000n, escrow: ATTACKER });
    const unwired = createAgent({
      client: liar,
      privateKey: generatePrivateKey(),
      rpcUrl: rpc.url,
    });
    const sdk = await toolError(() =>
      alephDepositTool(unwired, ROOM, { escrow: PIN, maxStake: 2 }),
    );
    assert.deepEqual(rpc.broadcasts, [], "sin pin en el agente tampoco se firma nada");
    assert.deepEqual(rpc.calls, [], "ni una lectura de la cadena");
    assert.equal(liar.passes.length, 0, "ni un pedido de vista al árbitro");
    assert.match(sdk.message, /missing: escrow;/);
  } finally {
    rpc.close();
  }
});

test("aleph_join sin pin en el servidor: una mesa de plata se rechaza antes de sentarse, aunque el agente pueda depositar; con pin, respeta el tope", async () => {
  const fake = new FakeAleph();
  // El agente trae clave, RPC y pin propios: si el guard del servidor faltara,
  // el agent-sdk lo dejaría sentarse. Así el test aísla la config del servidor.
  const agent = createAgent({
    client: fake,
    privateKey: generatePrivateKey(),
    rpcUrl: "http://127.0.0.1:1",
    escrow: PIN,
  });
  await assert.rejects(
    () => alephJoinTool(agent, 2, { maxStake: 2 }),
    /money tables are off.*ARCADE_ALEPH_ESCROW_ADDRESS/,
  );
  assert.equal(fake.joins, 0, "sin pin no pidió asiento");
  await assert.rejects(
    () => alephJoinTool(agent, 5, { escrow: PIN, maxStake: 2 }),
    /caps a table at 2 USDC \(ARCADE_ALEPH_MAX_STAKE\)/,
  );
  assert.equal(fake.joins, 0, "por encima del tope del operador tampoco");
  await alephJoinTool(agent, 2, { escrow: PIN, maxStake: 2 });
  assert.equal(fake.joins, 1, "con pin y dentro del tope, sí se sienta");
});

test("aleph_deposit con pin y tope: sin haberse sentado en esta sesión, paga exactamente el stake al escrow clavado (control positivo)", async () => {
  const rpc = await fakeRpc("0x7a69", { balance: WHOLE_BALANCE });
  try {
    const fake = new FakeAleph();
    funding(fake, { stake: 2_000_000n, escrow: PIN });
    // Como después de un reinicio del servidor: sin aleph_join en este
    // proceso, el ancla es el tope del operador.
    const agent = createAgent({
      client: fake,
      privateKey: generatePrivateKey(),
      rpcUrl: rpc.url,
      escrow: PIN,
    });
    await toolError(() => alephDepositTool(agent, ROOM, { escrow: PIN, maxStake: 2 })); // nunca se mina
    assert.equal(rpc.broadcasts.length, 1, "el approve sí se transmitió");
    const [approve] = rpc.broadcasts;
    assert.equal(approve.functionName, "approve");
    assert.equal(String(approve.args[0]).toLowerCase(), PIN, "al escrow clavado");
    assert.equal(approve.args[1], 2_000_000n, "exactamente un stake");
  } finally {
    rpc.close();
  }
});

// ---- aleph_withdraw ----------------------------------------------------------

test("aleph_withdraw: sin pin se niega y dice qué configurar, sin tocar la wallet", async () => {
  let touched = false;
  const fakeAgent = {
    alephWithdraw: async () => {
      touched = true;
      return { amount: 0n };
    },
  } as unknown as Parameters<typeof alephWithdrawTool>[0];
  await assert.rejects(
    () => alephWithdrawTool(fakeAgent),
    /not withdrawing: money tables are off.*ARCADE_ALEPH_ESCROW_ADDRESS/,
  );
  assert.equal(touched, false, "se cortó antes de la wallet");
});

test("aleph_withdraw: devuelve el monto en micro-USDC como string (JSON no lleva bigint)", async () => {
  const hash = "0x" + "cd".repeat(32);
  const fakeAgent = {
    alephWithdraw: async () => ({ amount: 1_700_000n, txHash: hash }),
  } as unknown as Parameters<typeof alephWithdrawTool>[0];
  const out = await alephWithdrawTool(fakeAgent, { escrow: PIN });
  assert.deepEqual(out, { amount: "1700000", txHash: hash });
  assert.doesNotThrow(() => JSON.stringify(out));
  const none = {
    alephWithdraw: async () => ({ amount: 0n }),
  } as unknown as Parameters<typeof alephWithdrawTool>[0];
  assert.deepEqual(await alephWithdrawTool(none, { escrow: PIN }), {
    amount: "0",
    txHash: undefined,
  });
});

test("aleph_withdraw: un error de RPC con la URL adentro no la deja pasar", async () => {
  const fakeAgent = {
    alephWithdraw: async () => {
      throw new Error(
        "HTTP request failed. URL: https://base-mainnet.g.alchemy.com/v2/super-secreta Details: fetch failed",
      );
    },
  } as unknown as Parameters<typeof alephWithdrawTool>[0];
  let caught: unknown;
  try {
    await alephWithdrawTool(fakeAgent, { escrow: PIN });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, "sigue siendo un error: no se traga el fallo");
  const msg = (caught as Error).message;
  assert.doesNotMatch(msg, /:\/\//, "ninguna URL sobrevive al resultado");
  assert.doesNotMatch(msg, /super-secreta/, "tampoco la key embebida en la URL");
  assert.match(msg, /HTTP request failed/, "el resto del motivo sigue llegando");
  assert.equal((caught as Error).cause, undefined, "sin `cause`: la URL no queda colgada ahí");
});
