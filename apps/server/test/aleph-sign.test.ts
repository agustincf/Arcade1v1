// Las firmas del árbitro para EscrowAleph: recuperan a SU address con el mismo
// dominio y los mismos tipos que verifica el contrato; el pase cambia con cada
// campo (sala, lista, stake, plazos, jugador). La igualdad bit a bit con el
// contrato la prueba el e2e en anvil (aleph-onchain-e2e.ts).
// Correr: node --import tsx --test apps/server/test/aleph-sign.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverTypedDataAddress, type Hex } from "viem";

process.env.ALEPH_ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "84532";
const S = await import("../src/sign.js");

const ROOM = ("0x" + "ab".repeat(32)) as Hex;
const SEATS = [1, 2, 3, 4].map((i) => ("0x" + String(i).repeat(40)) as Hex);
const pass = {
  roomId: ROOM,
  seatsHash: S.alephSeatsHash(SEATS),
  stake: 2_000_000n,
  fundDeadline: 1_800_000_600n,
  playDeadline: 1_800_011_400n,
  player: SEATS[0],
};

test("el pase recupera a la address del árbitro con el dominio de Aleph", async () => {
  const sig = await S.signAlephSeat(pass);
  const who = await recoverTypedDataAddress({
    domain: S.alephDomain(),
    types: S.ALEPH_SEAT_TYPES,
    primaryType: "Seat",
    message: pass,
    signature: sig,
  });
  assert.equal(who.toLowerCase(), S.arbiterAddress().toLowerCase());
  assert.equal(S.alephDomain().name, "Arcade1v1EscrowAleph");
  assert.equal(S.alephDomain().verifyingContract, process.env.ALEPH_ESCROW_ADDRESS);
});

test("cada campo del pase cambia la firma; la capitalización del jugador no", async () => {
  const base = await S.signAlephSeat(pass);
  assert.notEqual(
    await S.signAlephSeat({ ...pass, roomId: ("0x" + "cd".repeat(32)) as Hex }),
    base,
  );
  assert.notEqual(
    await S.signAlephSeat({ ...pass, seatsHash: S.alephSeatsHash(SEATS.slice().reverse()) }),
    base,
  );
  assert.notEqual(await S.signAlephSeat({ ...pass, stake: 5_000_000n }), base);
  assert.notEqual(await S.signAlephSeat({ ...pass, fundDeadline: pass.fundDeadline + 1n }), base);
  assert.notEqual(await S.signAlephSeat({ ...pass, playDeadline: pass.playDeadline + 1n }), base);
  assert.notEqual(await S.signAlephSeat({ ...pass, player: SEATS[1] }), base);
  assert.equal(
    await S.signAlephSeat({ ...pass, player: SEATS[0].toUpperCase().replace("0X", "0x") as Hex }),
    base,
  );
});

test("la tabla se firma por su hash y recupera al árbitro", async () => {
  const amounts = [2_890_000n, 1_870_000n, 1_190_000n, 850_000n];
  const tableHash = S.alephTableHash(SEATS, amounts);
  assert.match(tableHash, /^0x[0-9a-f]{64}$/);
  assert.notEqual(S.alephTableHash(SEATS, [...amounts].reverse()), tableHash);
  const sig = await S.signAlephPayout(ROOM, tableHash);
  const who = await recoverTypedDataAddress({
    domain: S.alephDomain(),
    types: S.ALEPH_PAYOUT_TYPES,
    primaryType: "Payout",
    message: { roomId: ROOM, tableHash },
    signature: sig,
  });
  assert.equal(who.toLowerCase(), S.arbiterAddress().toLowerCase());
});
