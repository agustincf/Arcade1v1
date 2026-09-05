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
import { vaultActionAuthMessage } from "@arcade1v1/game-sdk/auth";
import {
  actionLine,
  replayVault,
  type VaultAction,
  type VaultEvent,
} from "@arcade1v1/game-sdk/vault";
import { getRating } from "../src/ratings.js";
import * as V from "../src/vault.js";

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
  const started = V.getVaultRoom(v!.roomId, low(accs[0]), now)!;
  assert.equal(started.status, "playing");
  return started.roomId;
}

/** Política guionada y determinística: el primer vivo guarda, el resto aporta;
 *  nadie acepta ofertas; todos votan al primer vivo que no sean ellos; nadie
 *  intenta la Cerradura; en la Final dividen. */
function policy(v: V.VaultRoomView, me: string): VaultAction {
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

async function playOut(roomId: string, accs: PrivateKeyAccount[]): Promise<V.VaultRoomView> {
  let said = false;
  for (let guard = 0; guard < 400; guard++) {
    const pub = V.getVaultRoom(roomId)!;
    if (pub.status === "settled") return pub;
    for (const acc of accs) {
      const v = V.getVaultRoom(roomId, low(acc))!;
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
    const mine = V.getVaultRoom(roomId, low(a))!;
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
  assert.ok(log.events.some((e) => e.type === "action" && e.action.type === "say"));
  assert.equal(V.recentVaultRooms(5)[0].roomId, roomId);
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

test("plazos: las fases vencen con el reloj del árbitro, los ausentes deciden por defecto y varias fases vencen de una", async () => {
  V.__resetVaultForTest();
  const accs = accounts(4);
  const S = T0;
  const roomId = await startRoom(accs, S);
  const me = low(accs[0]);
  assert.throws(() => V.vaultLog(roomId, S), /not settled/);
  assert.equal(V.getVaultRoom(roomId, me, S + V.VAULT_PHASE_MS - 1)!.stage!.index, 0);
  const after = V.getVaultRoom(roomId, me, S + V.VAULT_PHASE_MS)!;
  assert.equal(after.stage!.index, 1);
  assert.deepEqual(after.results![0].contributed, accs.map(low));
  assert.equal(after.results![0].kept!.length, 0);
  assert.equal(after.deadline, S + 2 * V.VAULT_PHASE_MS);
  // Nadie juega nunca: al cabo de muchas fases todos abandonan y la caja se reparte.
  const end = V.getVaultRoom(roomId, me, S + 100 * V.VAULT_PHASE_MS)!;
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
  const back = V.getVaultRoom(roomId, low(accs[0]))!;
  assert.equal(back.you!.decided, true);
  assert.equal(back.messages!.length, 1);
  const done = await playOut(roomId, accs);
  assert.equal(done.status, "settled");
  assert.equal(
    Object.values(done.payouts!).reduce((a, b) => a + b, 0),
    4000,
  );
});
