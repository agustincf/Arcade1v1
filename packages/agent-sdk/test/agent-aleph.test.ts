// packages/agent-sdk/test/agent-aleph.test.ts
// createAgent en Aleph: firma con su wallet lo que el árbitro exige, exige
// rpcUrl y privateKey para sentarse en una mesa de plata (donde su wallet SÍ
// deposita), deposita solo un stake que eligió el agente (nunca uno que nombra
// únicamente el árbitro), corta ante otra versión de reglas y reutiliza el pase
// de vista mientras sirve (renovándolo antes de que venza).
// Correr: node --import tsx --test packages/agent-sdk/test/agent-aleph.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverMessageAddress, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import {
  matchmakeAuthMessage,
  alephActionAuthMessage,
  alephViewAuthMessage,
} from "@arcade1v1/game-sdk/auth";
import { actionLine, ALEPH_RULES_V, type AlephAction } from "@arcade1v1/game-sdk/aleph";
import {
  ArbiterClient,
  type AlephActBody,
  type AlephDeposit,
  type AlephLobby,
  type AlephRoomStatus,
  type AlephRoomView,
  type AlephViewPass,
} from "../src/client.ts";
import { createAgent, VIEW_PASS_MAX_AGE_MS } from "../src/agent.ts";
import { fakeRpc } from "./fake-rpc.ts";

const ROOM = "0x" + "ee".repeat(32);
const T0 = 1_800_000_000_000;

/** El bloque `deposit` de la vista privada de un asiento en fondeo: mesa de 2
 *  USDC (2_000_000 micro) sobre anvil. `over` cambia solo lo que el test mira. */
function depositFixture(over: Partial<AlephDeposit> = {}): AlephDeposit {
  return {
    chainId: 31337,
    escrow: "0x" + "e".repeat(40),
    usdc: "0x" + "1".padStart(40, "0"),
    stake: "2000000",
    seats: [],
    seatsHash: "0x" + "0".repeat(64),
    fundDeadline: 1,
    playDeadline: 2,
    seatSig: "0x" + "0".repeat(130),
    ...over,
  };
}

/** Una sala de plata en fondeo, lista para que `alephDeposit` la mire. */
function fundingFake(deposit = depositFixture()): FakeAleph {
  const fake = new FakeAleph();
  fake.status = "funding";
  fake.stake = 2;
  fake.deposited = [];
  fake.deposit = deposit;
  return fake;
}

/** Árbitro falso: captura lo que manda el agente y devuelve una vista fija.
 *  `lobbies` vacío por default: así los tests que no lo tocan preservan el
 *  camino viejo (sin mesa abierta para mirar antes de sentarse). */
class FakeAleph extends ArbiterClient {
  joins: { stake: number; address: string; auth?: { signature: string; ts: number } }[] = [];
  views: (AlephViewPass | undefined)[] = [];
  acts: { address: string; body: AlephActBody }[] = [];
  rulesV = ALEPH_RULES_V;
  lobbies: AlephLobby[] = [];
  stage: AlephRoomView["stage"] = { index: 2, kind: "vote", phase: "decide", acted: [] };
  /** Estado de la sala; `playing` por default (el camino viejo). */
  status: AlephRoomStatus = "playing";
  /** La mesa: 0 (gratis) por default, como todo el camino viejo. */
  stake = 0;
  /** Solo en `funding`: quiénes ya depositaron y con qué depositar. */
  deposited?: string[];
  deposit?: AlephDeposit;
  constructor() {
    super("http://fake");
  }
  private view(): AlephRoomView {
    return {
      roomId: ROOM,
      stake: this.stake,
      status: this.status,
      rulesV: this.rulesV,
      min: 4,
      max: 8,
      createdAt: 0,
      seats: [],
      stage: this.stage,
      deposited: this.deposited,
      deposit: this.deposit,
    };
  }
  async alephLobbies() {
    return this.lobbies;
  }
  async alephJoin(stake: number, address: string, auth?: { signature: string; ts: number }) {
    this.joins.push({ stake, address, auth });
    return this.view();
  }
  async alephView(_roomId: string, pass?: AlephViewPass) {
    this.views.push(pass);
    return this.view();
  }
  async alephAct(_roomId: string, address: string, body: AlephActBody) {
    this.acts.push({ address, body });
    return this.view();
  }
}

test("alephJoin: firma matchmakeAuthMessage('aleph', 0, address, ts) con la wallet del agente", async () => {
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake });
  const v = await agent.alephJoin(0);
  assert.equal(v.roomId, ROOM);
  const j = fake.joins[0];
  assert.equal(j.stake, 0);
  assert.equal(j.address, agent.address);
  const signer = await recoverMessageAddress({
    message: matchmakeAuthMessage("aleph", 0, agent.address, j.auth!.ts),
    signature: j.auth!.signature as Hex,
  });
  assert.equal(signer.toLowerCase(), agent.address.toLowerCase());
  // Sin argumento, la mesa gratis.
  await agent.alephJoin();
  assert.equal(fake.joins[1].stake, 0);
});

test("alephJoin: una mesa de plata exige rpcUrl y privateKey (la wallet tiene que poder depositar); con las dos firma stake 2", async () => {
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake });
  await assert.rejects(() => agent.alephJoin(2), /rpcUrl/);
  // Con RPC pero sin privateKey la wallet es la efímera que se sortea al crear
  // el agente: nadie la fondeó, así que se sentaría para nada y la sala se
  // disolvería en fondeo para los otros asientos.
  const unfundable = createAgent({ client: fake, rpcUrl: "http://localhost:8545" });
  await assert.rejects(() => unfundable.alephJoin(2), /privateKey/);
  assert.equal(fake.joins.length, 0, "no llegó a pedir asiento");

  const paying = createAgent({
    client: fake,
    rpcUrl: "http://localhost:8545",
    privateKey: generatePrivateKey(),
  });
  await paying.alephJoin(2);
  assert.equal(fake.joins.length, 1);
  assert.equal(fake.joins[0].stake, 2);
  const j = fake.joins[0];
  assert.ok(j.auth?.signature, "firmado con stake 2 en el mensaje");
  // El árbitro verifica la firma sobre el stake QUE PIDIÓ: si el SDK firmara
  // con 0 y se sentara con 2, el asiento rebotaría recién allá.
  const signer = await recoverMessageAddress({
    message: matchmakeAuthMessage("aleph", 2, paying.address, j.auth!.ts),
    signature: j.auth!.signature as Hex,
  });
  assert.equal(signer.toLowerCase(), paying.address.toLowerCase());
});

// La red de contención de `alephJoin`: sin mesa abierta que mirar antes, la
// versión se compara contra la vista que devuelve el propio join (ya sentado).
// La variante que corta ANTES de pedir asiento es el test de más abajo.
test("alephJoin: otra versión de reglas corta la partida (red de contención, ya sentado)", async () => {
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake });
  fake.rulesV = ALEPH_RULES_V + 1;
  await assert.rejects(
    () => agent.alephJoin(0),
    (e: Error) => /rules version mismatch/.test(e.message) && /update/.test(e.message),
  );
  assert.equal(fake.joins.length, 1, "acá ya se había sentado: la contención salta después");
});

test("alephDeposit: sin rpcUrl falla claro; con la sala fuera de funding no toca la cadena", async () => {
  const fake = new FakeAleph(); // su vista es `playing`
  const agent = createAgent({ client: fake });
  await assert.rejects(() => agent.alephDeposit(ROOM), /rpcUrl/);
  const paying = createAgent({ client: fake, rpcUrl: "http://127.0.0.1:1" }); // nada escucha ahí
  await assert.rejects(() => paying.alephDeposit(ROOM, { maxStake: 2 }), /not funding \(playing\)/);
});

test("alephDeposit: si ya figuro entre los depositados, no manda nada", async () => {
  const fake = new FakeAleph();
  const paying = createAgent({ client: fake, rpcUrl: "http://127.0.0.1:1" });
  fake.status = "funding";
  fake.deposited = [paying.address.toLowerCase()];
  fake.deposit = {
    chainId: 31337,
    escrow: "0x" + "e".repeat(40),
    usdc: "0x" + "1".padStart(40, "0"),
    stake: "2000000",
    seats: [paying.address.toLowerCase()],
    seatsHash: "0x" + "0".repeat(64),
    fundDeadline: 1,
    playDeadline: 2,
    seatSig: "0x" + "0".repeat(130),
  };
  const r = await paying.alephDeposit(ROOM, { maxStake: 2 });
  assert.equal(r.step, "already");
  assert.equal(r.txHash, undefined);
  assert.equal(r.view.roomId, ROOM, "devuelve la vista que leyó");
});

// ---- Lo que el árbitro dice vs. lo que la wallet acepta gastar -------------
// `deposit` llega en un JSON por la red. Todo lo que decide PLATA (cuánto, a qué
// contrato, en qué red) se valida antes del approve: un árbitro comprometido,
// mal configurado o suplantado no puede mover esta wallet a su gusto.

test("alephDeposit: si el árbitro pide otro stake que el de alephJoin, no se aprueba nada", async () => {
  const fake = fundingFake(depositFixture({ stake: "50000000" })); // 50 USDC en una mesa de 2
  const paying = createAgent({
    client: fake,
    rpcUrl: "http://127.0.0.1:1",
    privateKey: generatePrivateKey(),
  });
  await paying.alephJoin(2); // la sala del fake es de 2 USDC: ese es el ancla
  await assert.rejects(
    () => paying.alephDeposit(ROOM),
    (e: Error) =>
      /deposit stake mismatch/.test(e.message) &&
      /50000000/.test(e.message) &&
      /joined it at 2 USDC/.test(e.message) &&
      /2000000/.test(e.message),
  );
});

test("alephDeposit: con el escrow clavado en createAgent, otro escrow no se aprueba", async () => {
  const fake = fundingFake();
  const pinned = "0x" + "a".repeat(40);
  const paying = createAgent({ client: fake, rpcUrl: "http://127.0.0.1:1", escrow: pinned });
  await assert.rejects(
    () => paying.alephDeposit(ROOM, { maxStake: 2 }),
    (e: Error) => /escrow mismatch/.test(e.message) && e.message.includes(pinned),
  );
  // Con el escrow que sí corresponde (y otra capitalización) el control no
  // estorba: el depósito sigue de largo hasta la cadena, que acá no existe.
  const ok = createAgent({
    client: fake,
    rpcUrl: "http://127.0.0.1:1",
    escrow: fake.deposit!.escrow.toUpperCase(),
  });
  await assert.rejects(
    () => ok.alephDeposit(ROOM, { maxStake: 2 }),
    (e: Error) => !/escrow mismatch/.test(e.message),
  );
});

test("alephDeposit: un chainId que el SDK no conoce se rechaza (no cae a una red por defecto)", async () => {
  const fake = fundingFake(depositFixture({ chainId: 12345 }));
  const paying = createAgent({ client: fake, rpcUrl: "http://127.0.0.1:1" });
  await assert.rejects(() => paying.alephDeposit(ROOM, { maxStake: 2 }), /unknown chainId 12345/);
});

test("alephDeposit: si el RPC está en otra red que el escrow del árbitro, corta antes de gastar", async () => {
  const fake = fundingFake(depositFixture({ chainId: 8453 })); // el árbitro dice base
  const rpc = await fakeRpc("0x1"); // y el RPC del operador contesta mainnet
  try {
    const paying = createAgent({ client: fake, rpcUrl: rpc.url });
    await assert.rejects(
      () => paying.alephDeposit(ROOM, { maxStake: 2 }),
      (e: Error) =>
        /chain mismatch/.test(e.message) &&
        /on chain 8453/.test(e.message) &&
        /rpcUrl is chain 1/.test(e.message),
    );
  } finally {
    rpc.close();
  }
});

/** Árbitro falso en FONDEO que modela el rechazo silencioso del pase de vista:
 *  la vista PÚBLICA de una sala en fondeo trae `status: "funding"` y la lista de
 *  asientos, pero NO el bloque `deposit` (withDeposit, apps/server/src/aleph.ts).
 *  `grantAt` controla desde qué llamada (1-based) el pase "sirve". */
class FlakyFundingAleph extends ArbiterClient {
  address = "";
  calls = 0;
  grantAt = 1;
  constructor() {
    super("http://fake");
  }
  async alephView(roomId: string): Promise<AlephRoomView> {
    this.calls++;
    const granted = this.calls >= this.grantAt;
    return {
      roomId,
      stake: 2,
      status: "funding",
      rulesV: ALEPH_RULES_V,
      min: 4,
      max: 8,
      createdAt: 0,
      deposited: [],
      seats: [{ address: this.address, status: "alive", pocket: 0 }],
      deposit: granted ? depositFixture({ seats: [this.address] }) : undefined,
    };
  }
}

test("alephView: en FONDEO un pase rechazado también se reintenta (ahí está la plata)", async () => {
  const fake = new FlakyFundingAleph();
  const agent = createAgent({ client: fake });
  fake.address = agent.address;
  fake.grantAt = 2; // la primera vuelta "falla" (reloj desfasado); la segunda sirve.
  const v = await agent.alephView(ROOM);
  assert.equal(fake.calls, 2, "reintentó una vez con un pase recién firmado");
  assert.ok(v.deposit, "la segunda vuelta sí trae con qué depositar");
});

test("alephDeposit: con el pase rechazado en fondeo, el error habla del PASE, no de la sala", async () => {
  const fake = new FlakyFundingAleph();
  const paying = createAgent({ client: fake, rpcUrl: "http://127.0.0.1:1" });
  fake.address = paying.address;
  fake.grantAt = 99; // nunca sirve dentro de este test
  await assert.rejects(() => paying.alephDeposit(ROOM, { maxStake: 2 }), /view pass rejected/);
  assert.equal(fake.calls, 2, "reintentó exactamente una vez antes de resignarse");
});

test("alephDeposit: sin pase de depósito y sin asiento, el error lo dice (no 'la sala no está fondeando')", async () => {
  const fake = fundingFake();
  fake.deposit = undefined; // sala en fondeo, pero esta address no tiene asiento
  const paying = createAgent({ client: fake, rpcUrl: "http://127.0.0.1:1" });
  await assert.rejects(
    () => paying.alephDeposit(ROOM, { maxStake: 2 }),
    (e: Error) => /no deposit pass/.test(e.message) && !/is not funding/.test(e.message),
  );
});

// ---- El ancla del stake: lo que la wallet aprueba lo elige el AGENTE -------
// La prueba del review final, hecha test: con la config exacta que tenía el MCP
// (clave + RPC, sin pin de escrow), un árbitro que miente COHERENTE (750 USDC en
// la vista y en `deposit`, con el escrow del atacante) y un RPC que reporta ese
// saldo hacían que la wallet firmara y transmitiera approve(atacante, 750 USDC)
// sin haberse sentado a ninguna mesa. El RPC falso llega hasta
// `eth_sendRawTransaction`, así que "no se transmitió nada" es una afirmación
// que puede fallar: el último test es el control positivo que lo demuestra.

const ATTACKER = "0x" + "a7".repeat(20);
const WHOLE_BALANCE = 750_000_000n; // 750 USDC: el saldo de una wallet es público

/** El árbitro mentiroso de la prueba: 750 en la vista Y en `deposit`, con el
 *  escrow del atacante. Coherente a propósito: así mentía la prueba. */
function lyingFake(): FakeAleph {
  const fake = fundingFake(depositFixture({ stake: WHOLE_BALANCE.toString(), escrow: ATTACKER }));
  fake.stake = 750;
  return fake;
}

/** Corre un depósito que tiene que fallar y devuelve el error. Los tests miran
 *  PRIMERO qué se transmitió y recién después el motivo: si una defensa se
 *  cae, el fallo tiene que mostrar el approve que salió, no un mensaje distinto. */
async function depositError(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (e) {
    return e as Error;
  }
  return assert.fail("el depósito no tenía que terminar bien");
}

test("alephDeposit: sin stake propio, un árbitro que miente no hace transmitir nada (la prueba del review)", async () => {
  const rpc = await fakeRpc("0x7a69", { balance: WHOLE_BALANCE });
  try {
    const agent = createAgent({
      client: lyingFake(),
      privateKey: generatePrivateKey(),
      rpcUrl: rpc.url,
    });
    const e = await depositError(() => agent.alephDeposit(ROOM)); // nunca se sentó
    assert.deepEqual(rpc.broadcasts, [], "la wallet no firmó ni transmitió nada");
    assert.deepEqual(rpc.calls, [], "ni una lectura: corta antes de tocar el RPC");
    assert.match(e.message, /no stake of your own/);
  } finally {
    rpc.close();
  }
});

test("alephDeposit: sentado a 2 USDC, un árbitro que después pide 750 no hace transmitir nada", async () => {
  const rpc = await fakeRpc("0x7a69", { balance: WHOLE_BALANCE });
  try {
    const fake = fundingFake(); // la mesa a la que se sienta es de 2
    const agent = createAgent({ client: fake, privateKey: generatePrivateKey(), rpcUrl: rpc.url });
    await agent.alephJoin(2);
    // ...y a la hora de depositar el árbitro miente coherente.
    fake.stake = 750;
    fake.deposit = depositFixture({ stake: WHOLE_BALANCE.toString(), escrow: ATTACKER });
    const e = await depositError(() => agent.alephDeposit(ROOM));
    assert.deepEqual(rpc.broadcasts, [], "la wallet no firmó ni transmitió nada");
    assert.deepEqual(rpc.calls, [], "ni una lectura de la cadena");
    assert.match(e.message, /deposit stake mismatch/);
  } finally {
    rpc.close();
  }
});

test("alephDeposit: con maxStake, un árbitro que pide más no hace transmitir nada; un maxStake inválido corta antes de la red", async () => {
  const rpc = await fakeRpc("0x7a69", { balance: WHOLE_BALANCE });
  try {
    const fake = lyingFake();
    const agent = createAgent({ client: fake, privateKey: generatePrivateKey(), rpcUrl: rpc.url });
    const e = await depositError(() => agent.alephDeposit(ROOM, { maxStake: 2 }));
    assert.deepEqual(rpc.broadcasts, [], "la wallet no firmó ni transmitió nada");
    assert.deepEqual(rpc.calls, [], "ni una lectura de la cadena");
    assert.match(e.message, /deposit over maxStake/);
    // Un tope que no es un número de USDC no se interpreta: ni 0 ("nunca"), ni
    // negativo, ni NaN (un Number() de una variable mal escrita).
    const views = fake.views.length;
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assert.rejects(
        () => agent.alephDeposit(ROOM, { maxStake: bad }),
        /maxStake must be a positive number/,
      );
    }
    assert.equal(fake.views.length, views, "ni siquiera le preguntó al árbitro");
  } finally {
    rpc.close();
  }
});

test("alephDeposit: con el ancla que corresponde sí llega a la cadena y aprueba exactamente el stake (control positivo)", async () => {
  const rpc = await fakeRpc("0x7a69", { balance: WHOLE_BALANCE });
  try {
    const fake = fundingFake();
    const agent = createAgent({
      client: fake,
      privateKey: generatePrivateKey(),
      rpcUrl: rpc.url,
      escrow: fake.deposit!.escrow,
    });
    await agent.alephJoin(2);
    // Un modelo que vuelve a buscar su sala con la mesa por defecto (0) recibe
    // del join idempotente la MISMA sala de 2 USDC: el ancla no se pisa.
    await agent.alephJoin(0);
    await depositError(() => agent.alephDeposit(ROOM)); // el RPC falso nunca mina
    assert.equal(rpc.broadcasts.length, 1, "el approve sí se transmitió");
    const [approve] = rpc.broadcasts;
    assert.equal(approve.functionName, "approve");
    assert.equal(
      approve.to?.toLowerCase(),
      fake.deposit!.usdc.toLowerCase(),
      "al contrato de USDC",
    );
    assert.equal(String(approve.args[0]).toLowerCase(), fake.deposit!.escrow.toLowerCase());
    assert.equal(approve.args[1], 2_000_000n, "exactamente un stake, nunca un permiso infinito");
  } finally {
    rpc.close();
  }
});

test("alephJoin: si hay mesa abierta con otra versión de reglas, corta ANTES de pedir asiento", async () => {
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake });
  fake.lobbies = [
    { roomId: ROOM, stake: 0, status: "lobby", seats: 3, min: 4, max: 8, closesAt: 0 },
  ];
  fake.rulesV = ALEPH_RULES_V + 1;
  await assert.rejects(
    () => agent.alephJoin(0),
    (e: Error) => /rules version mismatch/.test(e.message) && new RegExp(ROOM).test(e.message),
  );
  assert.equal(fake.joins.length, 0, "no ensució la mesa compartida pidiendo asiento");
  // La vista pública que lo detectó fue SIN pase (nadie tiene asiento todavía).
  assert.equal(fake.views.length, 1);
  assert.equal(fake.views[0], undefined);
});

test("alephJoin: sin mesa abierta para mirar, sigue de largo (nada que chequear todavía)", async () => {
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake });
  fake.lobbies = []; // primera sala de la vida del árbitro
  const v = await agent.alephJoin(0);
  assert.equal(v.roomId, ROOM);
  assert.equal(fake.joins.length, 1, "sí pidió asiento: no había nada que mirar antes");
});

test("alephView: pide la vista privada con un pase firmado, lo reutiliza y lo renueva al envejecer", async () => {
  let now = T0;
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake, clock: () => now });
  await agent.alephView(ROOM);
  now += 60_000;
  await agent.alephView(ROOM);
  const [p1, p2] = fake.views;
  assert.ok(p1 && p2);
  assert.equal(p1.address, agent.address);
  assert.equal(p1.ts, T0);
  assert.equal(p2.signature, p1.signature, "dentro de la ventana se reutiliza el mismo pase");
  const signer = await recoverMessageAddress({
    message: alephViewAuthMessage(ROOM, agent.address, p1.ts),
    signature: p1.signature as Hex,
  });
  assert.equal(signer.toLowerCase(), agent.address.toLowerCase());
  now = T0 + VIEW_PASS_MAX_AGE_MS; // el árbitro acepta 10 min; renovamos antes
  await agent.alephView(ROOM);
  const p3 = fake.views[2]!;
  assert.equal(p3.ts, now);
  assert.notEqual(p3.signature, p1.signature, "el pase viejo se renueva antes de vencer");
});

/** Árbitro falso que modela el rechazo silencioso del pase de vista: cuando
 *  `verifySigned` falla (p.ej. reloj del agente desfasado respecto del
 *  servidor), el árbitro real responde 200 con la vista PÚBLICA en vez de
 *  lanzar (getAlephRoom, apps/server/src/aleph.ts) — acá, sin `you` aunque la
 *  address SÍ tenga asiento. `grantAt` controla desde qué llamada (1-based)
 *  el pase "sirve". */
class FlakyPassAleph extends ArbiterClient {
  address = "";
  calls = 0;
  grantAt = 1;
  constructor() {
    super("http://fake");
  }
  async alephView(roomId: string): Promise<AlephRoomView> {
    this.calls++;
    const granted = this.calls >= this.grantAt;
    return {
      roomId,
      stake: 0,
      status: "playing",
      rulesV: ALEPH_RULES_V,
      min: 4,
      max: 8,
      createdAt: 0,
      seats: [{ address: this.address, status: "alive", pocket: 0 }],
      stage: { index: 1, kind: "vote", phase: "decide", acted: [] },
      you: granted
        ? { status: "alive", pocket: 0, absences: 0, decided: false, ready: false }
        : undefined,
    };
  }
}

test("alephView: si el árbitro rechaza el pase en silencio (200 sin `you`), reintenta con uno fresco", async () => {
  const fake = new FlakyPassAleph();
  const agent = createAgent({ client: fake });
  fake.address = agent.address;
  fake.grantAt = 2; // la primera vuelta "falla" (reloj desfasado); la segunda sirve.
  const v = await agent.alephView(ROOM);
  assert.equal(fake.calls, 2, "reintentó una vez con un pase recién firmado");
  assert.ok(v.you, "la segunda vuelta sí trae la vista privada");
});

test("alephView: si el pase sigue sin servir tras reintentar, falla claro (no juega a ciegas)", async () => {
  const fake = new FlakyPassAleph();
  const agent = createAgent({ client: fake });
  fake.address = agent.address;
  fake.grantAt = 99; // nunca sirve dentro de este test
  await assert.rejects(() => agent.alephView(ROOM), /view pass rejected/);
  assert.equal(fake.calls, 2, "reintentó exactamente una vez antes de resignarse");
});

test("alephAct: firma alephActionAuthMessage con la etapa/fase dadas; sin `at` las toma de la vista", async () => {
  const fake = new FakeAleph();
  const agent = createAgent({ client: fake });
  const target = "0x" + "2".repeat(40);
  const action: AlephAction = { type: "vote", target };
  await agent.alephAct(ROOM, action, { stage: 2, phase: "decide" });
  const a = fake.acts[0];
  assert.equal(a.address, agent.address);
  assert.deepEqual(a.body.action, action);
  assert.equal(a.body.stage, 2);
  assert.equal(a.body.phase, "decide");
  assert.equal(fake.views.length, 0, "con `at` no consulta la vista");
  const signer = await recoverMessageAddress({
    message: alephActionAuthMessage(ROOM, 2, "decide", actionLine(action), a.body.ts),
    signature: a.body.signature as Hex,
  });
  assert.equal(signer.toLowerCase(), agent.address.toLowerCase());
  // Sin `at`: consulta la vista (con pase) y usa su etapa/fase.
  fake.stage = { index: 5, kind: "lock", phase: "talk", acted: [] };
  await agent.alephAct(ROOM, { type: "ready" });
  assert.equal(fake.views.length, 1, "consultó la vista una vez");
  assert.ok(fake.views[0], "y lo hizo con pase");
  assert.equal(fake.acts[1].body.stage, 5);
  assert.equal(fake.acts[1].body.phase, "talk");
});

test("alephAct sin `at` falla claro si la sala no está en juego", async () => {
  const fake = new FakeAleph();
  fake.stage = undefined;
  const agent = createAgent({ client: fake });
  await assert.rejects(() => agent.alephAct(ROOM, { type: "ready" }), /not playing/);
  assert.equal(fake.acts.length, 0);
});
