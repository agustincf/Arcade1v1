// Lobby de La Bóveda: un lobby abierto por mesa, idempotente por address,
// arranca con 8 o al vencer con ≥4, se disuelve con <4, respeta el tope de
// salas y sobrevive a serializar/restaurar. Reloj SIEMPRE inyectado.
// Correr: node --import tsx --test apps/server/test/vault-lobby.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { matchmakeAuthMessage } from "@arcade1v1/game-sdk/auth";

process.env.VAULT_MAX_ROOMS = "2";
const V = await import("../src/vault.js");

const base = BigInt("0x" + Date.now().toString(16).padStart(12, "0") + "0a00");
let ctr = 0;
const addr = () => "0x" + (base + BigInt(++ctr)).toString(16).padStart(40, "0").slice(-40);
const T0 = 1_800_000_000_000;

test("un lobby por mesa, idempotente por address; arranca al vencer con ≥4", async () => {
  V.__resetVaultForTest();
  const a1 = addr();
  const v1 = await V.joinVault(0, a1, undefined, T0);
  assert.equal(v1.status, "lobby");
  assert.equal(v1.seats.length, 1);
  assert.equal(v1.closesAt, T0 + V.VAULT_LOBBY_MS);
  const again = await V.joinVault(0, a1.toUpperCase().replace("0X", "0x"), undefined, T0 + 1);
  assert.equal(again.roomId, v1.roomId);
  assert.equal(again.seats.length, 1);
  for (let i = 0; i < 3; i++) await V.joinVault(0, addr(), undefined, T0 + 2);
  assert.deepEqual(
    V.listVaultLobbies(T0 + 3).map((l) => [l.roomId, l.seats]),
    [[v1.roomId, 4]],
  );
  // No vence antes de tiempo.
  assert.equal((await V.getVaultRoom(v1.roomId, a1, T0 + V.VAULT_LOBBY_MS - 1))!.status, "lobby");
  const started = (await V.getVaultRoom(v1.roomId, a1, T0 + V.VAULT_LOBBY_MS))!;
  assert.equal(started.status, "playing");
  assert.match(String(started.commit), /^0x[0-9a-f]{64}$/);
  assert.equal(started.secretSeed, undefined, "la semilla no se revela hasta el final");
  assert.equal(started.startedAt, T0 + V.VAULT_LOBBY_MS);
  assert.equal(started.deadline, T0 + V.VAULT_LOBBY_MS + V.VAULT_PHASE_MS);
  assert.equal(started.stage!.kind, "share");
  assert.equal(started.you!.status, "alive");
  assert.equal(started.pot, 3200);
  assert.deepEqual(V.listVaultLobbies(T0 + V.VAULT_LOBBY_MS), []);
  // Sentado en una sala viva: volver a pedir asiento devuelve ESA sala.
  const same = await V.joinVault(0, a1, undefined, T0 + V.VAULT_LOBBY_MS + 5);
  assert.equal(same.roomId, v1.roomId);
  assert.equal(same.status, "playing");
});

test("con menos de 4 al vencer, el lobby se disuelve y el próximo pedido crea otro", async () => {
  V.__resetVaultForTest();
  const a1 = addr();
  const v1 = await V.joinVault(0, a1, undefined, T0);
  await V.joinVault(0, addr(), undefined, T0);
  const gone = (await V.getVaultRoom(v1.roomId, a1, T0 + V.VAULT_LOBBY_MS))!;
  assert.equal(gone.status, "dissolved");
  const v2 = await V.joinVault(0, a1, undefined, T0 + V.VAULT_LOBBY_MS + 1);
  assert.notEqual(v2.roomId, v1.roomId);
  assert.equal(v2.status, "lobby");
});

test("con 8 asientos arranca en el acto; el tope de salas vivas corta", async () => {
  V.__resetVaultForTest();
  let last;
  for (let i = 0; i < 8; i++) last = await V.joinVault(0, addr(), undefined, T0);
  assert.equal(last!.status, "playing");
  assert.equal(last!.seats.length, 8);
  for (let i = 0; i < 8; i++) last = await V.joinVault(0, addr(), undefined, T0);
  assert.equal(last!.status, "playing");
  await assert.rejects(() => V.joinVault(0, addr(), undefined, T0), /room limit/);
});

test("validaciones: mesa, address, kill switch y firma", async () => {
  V.__resetVaultForTest();
  await assert.rejects(() => V.joinVault(1, addr(), undefined, T0), /stake not allowed/);
  await assert.rejects(() => V.joinVault(0, "0x123", undefined, T0), /invalid address/);
  process.env.VAULT_ENABLED = "false";
  await assert.rejects(() => V.joinVault(0, addr(), undefined, T0), /vault disabled/);
  delete process.env.VAULT_ENABLED;

  const acc = privateKeyToAccount(generatePrivateKey());
  const me = acc.address.toLowerCase();
  const ts = T0;
  const signature = await acc.signMessage({ message: matchmakeAuthMessage("vault", 0, me, ts) });
  const ok = await V.joinVault(0, me, { signature, ts }, T0);
  assert.equal(ok.status, "lobby");
  const other = privateKeyToAccount(generatePrivateKey());
  const bad = await other.signMessage({ message: matchmakeAuthMessage("vault", 0, me, ts) });
  await assert.rejects(() => V.joinVault(0, addr(), { signature: bad, ts }, T0), /bad signature/);
  await assert.rejects(
    () => V.joinVault(0, me, { signature, ts }, T0 + 11 * 60_000),
    /auth expired/,
  );
  await assert.rejects(() => V.joinVault(0, me, { signature: "0x1234", ts }, T0), /bad signature/);
});

test("persistencia: serializar y restaurar conserva el lobby abierto y una sala en juego", async () => {
  V.__resetVaultForTest();
  const a1 = addr();
  const lobby = await V.joinVault(0, a1, undefined, T0);
  const seats8 = Array.from({ length: 8 }, () => addr());
  // Segunda mesa no existe (solo stake 0), así que armamos la sala en juego
  // llenando el lobby con 7 más.
  let playing;
  for (const a of seats8.slice(0, 7)) playing = await V.joinVault(0, a, undefined, T0);
  assert.equal(playing!.status, "playing");
  const roomId = playing!.roomId;
  assert.equal(roomId, lobby.roomId);
  const lobby2 = await V.joinVault(0, seats8[7], undefined, T0 + 1);
  assert.equal(lobby2.status, "lobby");

  const raw = V.serializeVault();
  V.__resetVaultForTest();
  assert.equal(await V.getVaultRoom(roomId, a1, T0 + 2), null);
  V.restoreVaultFrom(raw);
  const back = (await V.getVaultRoom(roomId, a1, T0 + 2))!;
  assert.equal(back.status, "playing");
  assert.equal(back.stage!.kind, "share");
  assert.equal(back.commit, playing!.commit);
  // El lobby restaurado vuelve a ser EL lobby abierto de la mesa: una address
  // NUEVA cae ahí (no crea otro lobby) y el asiento original sigue sentado.
  // (Re-unir a seats8[7] no probaría nada: la idempotencia por address lo
  // encuentra por pertenencia a la sala, sin pasar por el mapa de lobbies.)
  const newcomer = await V.joinVault(0, addr(), undefined, T0 + 3);
  assert.equal(newcomer.roomId, lobby2.roomId);
  assert.equal(newcomer.seats.length, 2);
  assert.deepEqual(
    V.listVaultLobbies(T0 + 4).map((l) => [l.roomId, l.seats]),
    [[lobby2.roomId, 2]],
  );
  assert.ok(!raw.includes('"states"'), "el estado no se persiste: se re-simula");
});
