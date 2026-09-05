// LA BÓVEDA — salas del formato multi-agente (4 a 8 asientos, pozo único).
// Una sala de La Bóveda de punta a punta, in-process: 4 agentes guionados con
// firmas reales juegan hasta `settled`; después se verifica lo mismo que
// verificaría un tercero (compromiso, firmas, re-simulación). Más: firmas
// inválidas, plazos con reloj inyectado y persistencia a mitad de sala.
// Correr: node --import tsx --test apps/server/test/vault-game.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { keccak256, recoverMessageAddress, type Hex } from "viem";
import { vaultActionAuthMessage, vaultViewAuthMessage } from "@arcade1v1/game-sdk/auth";
import {
  actionLine,
  createVault,
  replayVault,
  type StageKind,
  type VaultAction,
  type VaultEvent,
} from "@arcade1v1/game-sdk/vault";
import { getRating } from "../src/ratings.js";
import type { VaultRoomView } from "../src/vault.js";

// Fase de UNA HORA para este archivo: la sala se juega con el reloj real y no
// tiene por qué terminar dentro de los 2 minutos del default. El knob se lee al
// importar, así que va antes del import dinámico. Las aserciones de plazo usan
// `V.VAULT_PHASE_MS` simbólicamente y siguen valiendo.
process.env.VAULT_PHASE_MS = String(60 * 60_000);
const V = await import("../src/vault.js");

const T0 = 1_800_000_000_000;
const accounts = (n: number) =>
  Array.from({ length: n }, () => privateKeyToAccount(generatePrivateKey()));
const low = (a: PrivateKeyAccount) => a.address.toLowerCase();

async function actSigned(
  roomId: string,
  acc: PrivateKeyAccount,
  stage: number,
  phase: "talk" | "decide",
  action: VaultAction,
  opts: { signer?: PrivateKeyAccount; ts?: number; now?: number; address?: string } = {},
) {
  const ts = opts.ts ?? opts.now ?? Date.now();
  const signature = await (opts.signer ?? acc).signMessage({
    message: vaultActionAuthMessage(roomId, stage, phase, actionLine(action), ts),
  });
  return V.actVault(
    roomId,
    opts.address ?? low(acc),
    { stage, phase, action, signature, ts },
    opts.now,
  );
}

/** Sala de 4 que arranca "ahora" (el lobby nació hace más de VAULT_LOBBY_MS). */
async function startRoom(accs: PrivateKeyAccount[], now = Date.now()) {
  const born = now - V.VAULT_LOBBY_MS - 1;
  let v;
  for (const a of accs) v = await V.joinVault(0, low(a), undefined, born);
  V.settleDue(now);
  const started = (await V.getVaultRoom(v!.roomId, low(accs[0]), now))!;
  assert.equal(started.status, "playing");
  return started.roomId;
}

/** Sala en juego restaurada a mano, con una semilla ELEGIDA para que la
 *  SEGUNDA etapa sea `kind`: al vencer el Reparto inicial la sala entra en esa
 *  etapa sin depender del sorteo. Plazo de la primera fase: T0 + VAULT_PHASE_MS. */
function seededRoom(kind: StageKind, accs: PrivateKeyAccount[], id: string): string {
  const seats = accs.map(low);
  let secretSeed = "";
  for (let i = 1; i < 5000 && !secretSeed; i++) {
    const cand = "0x" + i.toString(16).padStart(8, "0") + "0".repeat(56);
    if (createVault(cand, seats).deck[0] === kind) secretSeed = cand;
  }
  assert.ok(secretSeed, `no se encontró semilla con ${kind} al tope del mazo`);
  V.restoreVaultFrom(
    JSON.stringify([
      {
        id,
        stake: 0,
        status: "playing",
        seats,
        createdAt: T0,
        startedAt: T0,
        commit: keccak256(secretSeed as Hex),
        secretSeed,
        events: [],
        phaseDeadline: T0 + V.VAULT_PHASE_MS,
      },
    ]),
  );
  return id;
}

/** Política guionada y determinística: el primer vivo guarda, el resto aporta;
 *  nadie acepta ofertas; todos votan al primer vivo que no sean ellos; nadie
 *  intenta la Cerradura; en la Final dividen. */
function policy(v: VaultRoomView, me: string): VaultAction {
  const st = v.stage!;
  if (st.phase === "talk") return { type: "ready" };
  const alive = v.seats.filter((s) => s.status === "alive");
  switch (st.kind) {
    case "share":
      return { type: me === alive[0].address ? "keep" : "contribute" };
    case "offer":
      return { type: "decline" };
    case "vote":
      return { type: "vote", target: (alive.find((s) => s.address !== me) ?? alive[0]).address };
    case "lock":
      return { type: "ready" };
    default:
      return { type: "split" };
  }
}

async function playOut(roomId: string, accs: PrivateKeyAccount[]): Promise<VaultRoomView> {
  let said = false;
  for (let guard = 0; guard < 400; guard++) {
    const pub = (await V.getVaultRoom(roomId))!;
    if (pub.status === "settled") return pub;
    for (const acc of accs) {
      const v = (await V.getVaultRoom(roomId, low(acc)))!;
      if (v.status !== "playing" || v.you!.status !== "alive" || v.you!.decided || v.you!.ready)
        continue;
      const { index, phase } = v.stage!;
      if (!said) {
        said = true;
        await actSigned(roomId, acc, index, phase, { type: "say", text: "arranquemos" });
      }
      await actSigned(roomId, acc, index, phase, policy(v, low(acc)));
    }
  }
  throw new Error("la sala no terminó");
}

test("sala completa: 4 agentes firmando hasta settled; pagos, ELO, semilla revelada y registro verificable", async () => {
  V.__resetVaultForTest();
  const accs = accounts(4);
  const roomId = await startRoom(accs);
  const done = await playOut(roomId, accs);
  assert.equal(done.status, "settled");
  assert.equal(done.over, true);
  const payouts = done.payouts!;
  assert.equal(
    Object.values(payouts).reduce((a, b) => a + b, 0),
    4000,
  );
  assert.match(String(done.secretSeed), /^0x[0-9a-f]{64}$/);
  assert.equal(keccak256(done.secretSeed as Hex), done.commit);

  // ELO propio de vault, aplicado a los 4, y visible en la vista de cada asiento.
  for (const a of accs) {
    const mine = (await V.getVaultRoom(roomId, low(a)))!;
    assert.ok(mine.rating, "rating en la vista del asiento");
    assert.equal(mine.rating!.after, getRating(low(a), "vault"));
  }
  assert.ok(
    accs.some((a) => getRating(low(a), "vault") !== 1000),
    "alguien movió su ELO",
  );
  assert.ok(
    accs.every((a) => getRating(low(a), "2048") === 1000),
    "no toca otros juegos",
  );

  // Registro público: lo que verificaría un tercero.
  const log = V.vaultLog(roomId);
  assert.equal(log.commit, done.commit);
  assert.deepEqual(replayVault(log.secretSeed!, log.seats, log.events).payouts, payouts);
  const first = log.events.find(
    (e): e is Extract<VaultEvent, { type: "action" }> => e.type === "action",
  )!;
  const signer = await recoverMessageAddress({
    message: vaultActionAuthMessage(
      roomId,
      first.stage,
      first.phase,
      actionLine(first.action),
      first.ts,
    ),
    signature: first.signature as Hex,
  });
  assert.equal(signer.toLowerCase(), first.address);
  assert.ok(log.events.some((e) => e.type === "phase_end" && e.reason === "all_acted"));
  assert.ok(
    log.events.some((e) => e.type === "phase_end" && e.reason === "all_ready"),
    "una charla cerrada porque todos mandaron ready queda en el registro",
  );
  assert.ok(log.events.some((e) => e.type === "action" && e.action.type === "say"));
  assert.equal(V.recentVaultRooms(5)[0].roomId, roomId);
  assert.equal(V.recentVaultRooms(5)[0].stages, done.results!.length);
  // `stages` queda GUARDADO en la sala: listar no re-simula ni un registro
  // (tras restaurar, el estado derivado no existe y el número sigue estando).
  const raw = V.serializeVault();
  V.__resetVaultForTest();
  V.restoreVaultFrom(raw);
  assert.equal(V.recentVaultRooms(5)[0].stages, done.results!.length);
  // Antes de terminar, el registro está cerrado (se prueba en la sala del test de plazos).
});

test("firmas y forma: firmante ajeno, ts vencido, etapa vieja, no asiento, acción inválida, cuerpo incompleto", async () => {
  V.__resetVaultForTest();
  const accs = accounts(4);
  const roomId = await startRoom(accs);
  const [a, b] = accs;
  await assert.rejects(
    () => actSigned(roomId, a, 0, "decide", { type: "keep" }, { signer: b }),
    /bad signature/,
  );
  await assert.rejects(
    () => actSigned(roomId, a, 0, "decide", { type: "keep" }, { ts: Date.now() - 11 * 60_000 }),
    /auth expired/,
  );
  await assert.rejects(
    () => actSigned(roomId, a, 5, "decide", { type: "keep" }),
    /stage or phase mismatch/,
  );
  await assert.rejects(
    () => actSigned(roomId, a, 0, "talk", { type: "ready" }),
    /stage or phase mismatch/,
  );
  const stranger = accounts(1)[0];
  await assert.rejects(
    () => actSigned(roomId, stranger, 0, "decide", { type: "keep" }),
    /not a seat/,
  );
  await assert.rejects(
    () => V.actVault(roomId, low(a), { stage: 0, phase: "decide", action: { type: "explode" } }),
    /invalid action/,
  );
  await assert.rejects(
    () => V.actVault(roomId, low(a), { stage: 0, phase: "later", action: { type: "keep" } }),
    /invalid phase/,
  );
  await assert.rejects(
    () => V.actVault("0xnope", low(a), { stage: 0, phase: "decide", action: { type: "keep" } }),
    /room not found/,
  );
  // Una acción válida sí entra, y el asiento la ve como decidida.
  const ok = await actSigned(roomId, a, 0, "decide", { type: "keep" });
  assert.equal(ok.you!.decided, true);
  assert.deepEqual(ok.stage!.acted, [low(a)]);
  await assert.rejects(
    () => actSigned(roomId, a, 0, "decide", { type: "keep" }),
    /already decided/,
  );
});

test("firma repetida: el mismo cuerpo firmado no entra dos veces", async () => {
  V.__resetVaultForTest();
  const accs = accounts(4);
  const roomId = await startRoom(accs);
  const ts = Date.now();
  const action: VaultAction = { type: "say", text: "hola dos veces" };
  const signature = await accs[0].signMessage({
    message: vaultActionAuthMessage(roomId, 0, "decide", actionLine(action), ts),
  });
  const body = { stage: 0, phase: "decide", action, signature, ts };
  const first = await V.actVault(roomId, low(accs[0]), body);
  assert.equal(first.messages!.length, 1);
  await assert.rejects(() => V.actVault(roomId, low(accs[0]), body), /duplicate action/);
  assert.equal((await V.getVaultRoom(roomId, low(accs[0])))!.messages!.length, 1);
});

test("plazos: las fases vencen con el reloj del árbitro, los ausentes deciden por defecto y varias fases vencen de una", async () => {
  V.__resetVaultForTest();
  const accs = accounts(4);
  const S = T0;
  const roomId = await startRoom(accs, S);
  const me = low(accs[0]);
  assert.throws(() => V.vaultLog(roomId, S), /not settled/);
  assert.equal((await V.getVaultRoom(roomId, me, S + V.VAULT_PHASE_MS - 1))!.stage!.index, 0);
  const after = (await V.getVaultRoom(roomId, me, S + V.VAULT_PHASE_MS))!;
  assert.equal(after.stage!.index, 1);
  assert.deepEqual(after.results![0].contributed, accs.map(low));
  assert.equal(after.results![0].kept!.length, 0);
  assert.equal(after.deadline, S + 2 * V.VAULT_PHASE_MS);
  // Nadie juega nunca: al cabo de muchas fases todos abandonan y la caja se reparte.
  const end = (await V.getVaultRoom(roomId, me, S + 100 * V.VAULT_PHASE_MS))!;
  assert.equal(end.status, "settled");
  for (const a of accs) assert.equal(end.payouts![low(a)], 1000);
  const log = V.vaultLog(roomId, S + 100 * V.VAULT_PHASE_MS);
  const ends = log.events.filter(
    (e): e is Extract<VaultEvent, { type: "phase_end" }> => e.type === "phase_end",
  );
  assert.ok(ends.every((e) => e.reason === "deadline"));
  for (let i = 1; i < ends.length; i++)
    assert.equal(
      ends[i].at - ends[i - 1].at,
      V.VAULT_PHASE_MS,
      "cada cierre lleva la hora de su plazo",
    );
  assert.equal(ends[0].at, S + V.VAULT_PHASE_MS);
  await assert.rejects(
    () =>
      actSigned(
        roomId,
        accs[0],
        0,
        "decide",
        { type: "keep" },
        { now: S + 100 * V.VAULT_PHASE_MS },
      ),
    /room not open/,
  );
});

test("persistencia a mitad de sala: serializar, restaurar y seguir hasta el final", async () => {
  V.__resetVaultForTest();
  const accs = accounts(4);
  const roomId = await startRoom(accs);
  await actSigned(roomId, accs[0], 0, "decide", { type: "keep" });
  await actSigned(roomId, accs[1], 0, "decide", { type: "say", text: "hola" });
  const raw = V.serializeVault();
  V.__resetVaultForTest();
  V.restoreVaultFrom(raw);
  const back = (await V.getVaultRoom(roomId, low(accs[0])))!;
  assert.equal(back.you!.decided, true);
  assert.equal(back.messages!.length, 1);
  const done = await playOut(roomId, accs);
  assert.equal(done.status, "settled");
  assert.equal(
    Object.values(done.payouts!).reduce((a, b) => a + b, 0),
    4000,
  );
});

test("pase de vista: en la Cerradura, un pase ajeno no muestra el fragmento del asiento", async () => {
  V.__resetVaultForTest();
  const accs = accounts(4);
  const seats = accs.map(low);
  const roomId = seededRoom("lock", accs, "0x" + "1".repeat(64));
  const now = T0 + V.VAULT_PHASE_MS; // vence el Reparto: entra la Cerradura
  // Sin firma y con AUTH_REQUIRED apagado (este archivo corre así) sigue
  // valiendo la vista privada: es el atajo documentado para dev y tests.
  const mine = (await V.getVaultRoom(roomId, seats[0], now))!;
  assert.equal(mine.stage!.kind, "lock");
  assert.ok(mine.you!.fragment, "el propio asiento ve su fragmento");
  // Un pase firmado por OTRA wallet no abre la vista privada de ese asiento.
  const intruso = accounts(1)[0];
  const signature = await intruso.signMessage({
    message: vaultViewAuthMessage(roomId, seats[0], now),
  });
  const spied = (await V.getVaultRoom(roomId, seats[0], now, { signature, ts: now }))!;
  assert.equal(spied.you, undefined, "un pase ajeno no abre la vista privada");
  assert.ok(!JSON.stringify(spied).includes("fragment"));
  // El propio asiento, con su pase, sí.
  const own = await accs[0].signMessage({ message: vaultViewAuthMessage(roomId, seats[0], now) });
  const ok = (await V.getVaultRoom(roomId, seats[0], now, { signature: own, ts: now }))!;
  assert.ok(ok.you!.fragment, "con su propio pase, el asiento ve su fragmento");
});

test("un asiento eliminado puede sentarse en otro lobby sin esperar a su sala", async () => {
  V.__resetVaultForTest();
  const accs = accounts(4);
  const roomId = seededRoom("offer", accs, "0x" + "2".repeat(64));
  const now = T0 + V.VAULT_PHASE_MS; // vence el Reparto: entra la Oferta
  assert.equal((await V.getVaultRoom(roomId, undefined, now))!.stage!.kind, "offer");
  // Uno acepta (se va con su parte) y los otros tres declinan.
  await actSigned(roomId, accs[0], 1, "decide", { type: "accept" }, { now, ts: now });
  for (const a of accs.slice(1)) {
    await actSigned(roomId, a, 1, "decide", { type: "decline" }, { now, ts: now });
  }
  const after = (await V.getVaultRoom(roomId, undefined, now))!;
  assert.equal(after.status, "playing", "la sala sigue con los tres que quedaron");
  assert.equal(after.seats.find((x) => x.address === low(accs[0]))!.status, "left");
  // El que se fue pide mesa y consigue un lobby NUEVO en el acto.
  const fresh = await V.joinVault(0, low(accs[0]), undefined, now);
  assert.notEqual(fresh.roomId, roomId);
  assert.equal(fresh.status, "lobby");
  // Los que siguen vivos, no: su sala sigue siendo la de siempre.
  const still = await V.joinVault(0, low(accs[1]), undefined, now);
  assert.equal(still.roomId, roomId);
});

test("recentVaultRooms: lee las etapas guardadas, no re-simula el registro", async () => {
  V.__resetVaultForTest();
  const accs = accounts(4);
  const roomId = await startRoom(accs);
  const done = await playOut(roomId, accs);
  // Registro adulterado a mano: si listar re-simulara, esto lanzaría. Lo que
  // se publica es el `stages` que quedó guardado al liquidar.
  const rooms = JSON.parse(V.serializeVault()) as { id: string; events: unknown[] }[];
  const room = rooms.find((r) => r.id === roomId)!;
  room.events = [{ type: "phase_end", stage: 99, phase: "decide", at: 0, reason: "deadline" }];
  V.__resetVaultForTest();
  V.restoreVaultFrom(JSON.stringify(rooms));
  const recent = V.recentVaultRooms(5);
  assert.equal(recent[0].roomId, roomId);
  assert.equal(recent[0].stages, done.results!.length);
});

test("settleDue: una sala rota se disuelve sola y no arrastra a las sanas", async () => {
  V.__resetVaultForTest();
  const seats = accounts(4).map(low);
  const sane = accounts(4).map(low);
  const seed = "0x" + "7".repeat(64);
  const room = (id: string, addrs: string[], events: unknown[]) => ({
    id,
    stake: 0,
    status: "playing",
    seats: addrs,
    createdAt: T0,
    startedAt: T0,
    commit: keccak256(seed as Hex),
    secretSeed: seed,
    events,
    phaseDeadline: T0 + V.VAULT_PHASE_MS,
  });
  const brokenId = "0x" + "b".repeat(64);
  const saneId = "0x" + "5".repeat(64);
  // La rota va PRIMERA: sin aislamiento, su excepción se lleva puesta a la sana.
  V.restoreVaultFrom(
    JSON.stringify([
      // Evento imposible de re-simular: actúa una address que no es asiento.
      room(brokenId, seats, [
        {
          type: "action",
          address: "0x" + "9".repeat(40),
          stage: 0,
          phase: "decide",
          action: { type: "keep" },
          ts: T0,
        },
      ]),
      room(saneId, sane, []),
    ]),
  );
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  const now = T0 + V.VAULT_PHASE_MS;
  try {
    assert.doesNotThrow(() => V.settleDue(now));
  } finally {
    console.error = realError;
  }
  assert.equal(logged.length, 1, "la sala rota se loguea UNA vez");
  assert.match(logged[0], /sala rota/);
  const broken = (await V.getVaultRoom(brokenId, undefined, now))!;
  assert.equal(broken.status, "dissolved");
  assert.equal(broken.settledAt, now);
  const ok = (await V.getVaultRoom(saneId, undefined, now))!;
  assert.equal(ok.status, "playing", "la sala sana siguió su curso");
  assert.equal(ok.stage!.index, 1, "y cerró su fase por plazo");
});

test("scripts/vault-verify: da OK con el registro real y detecta una tabla adulterada", async () => {
  const { verifyVaultLog } = await import("../../../scripts/vault-verify.mjs");
  V.__resetVaultForTest();
  const accs = accounts(4);
  const roomId = await startRoom(accs);
  await playOut(roomId, accs);
  const log = JSON.parse(JSON.stringify(V.vaultLog(roomId))); // como llega por HTTP
  const good = await verifyVaultLog(log);
  assert.equal(good.ok, true, JSON.stringify(good.checks));
  const forged = {
    ...log,
    payouts: { ...log.payouts, [log.seats[0]]: log.payouts[log.seats[0]] + 1 },
  };
  const bad = await verifyVaultLog(forged);
  assert.equal(bad.ok, false);
  assert.ok(
    bad.checks.some((c: { name: string; ok: boolean }) => /re-simulación/.test(c.name) && !c.ok),
  );
  // Versión de reglas adulterada.
  const otherRules = await verifyVaultLog({ ...log, rulesV: log.rulesV + 1 });
  assert.equal(otherRules.ok, false);
  assert.ok(
    otherRules.checks.some(
      (c: { name: string; ok: boolean }) => /versión de reglas/.test(c.name) && !c.ok,
    ),
  );

  // Sala jugada SOLO por plazos: los cierres son legítimos con su phaseMs...
  V.__resetVaultForTest();
  const idle = accounts(4);
  const S = T0;
  const idleRoom = await startRoom(idle, S);
  V.getVaultRoom(idleRoom, undefined, S + 100 * V.VAULT_PHASE_MS);
  const byDeadline = JSON.parse(JSON.stringify(V.vaultLog(idleRoom, S + 100 * V.VAULT_PHASE_MS)));
  const fine = await verifyVaultLog(byDeadline, V.VAULT_PHASE_MS);
  assert.equal(fine.ok, true, JSON.stringify(fine.checks));
  // ...y un cierre por plazo disfrazado de cierre anticipado NO lo es (nadie
  // actuó en esa fase).
  const faked = {
    ...byDeadline,
    events: byDeadline.events.map((e: { type: string }, i: number) =>
      i === 0 ? { ...e, reason: "all_acted" } : e,
    ),
  };
  const caught = await verifyVaultLog(faked, V.VAULT_PHASE_MS);
  assert.equal(caught.ok, false);
  assert.ok(
    caught.checks.some(
      (c: { name: string; ok: boolean }) => /cierres de fase/.test(c.name) && !c.ok,
    ),
  );
});
