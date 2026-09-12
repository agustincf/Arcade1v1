// Las firmas del árbitro para EscrowAleph: recuperan a SU address con el mismo
// dominio y los mismos tipos que verifica el contrato; el pase cambia con cada
// campo (sala, lista, stake, plazos, jugador). Los typehashes también se cruzan
// contra el string literal del .sol (sin nodo). La igualdad bit a bit del
// dominio y las dos firmas la prueba el e2e en anvil (aleph-onchain-e2e.ts).
// Correr: node --import tsx --test apps/server/test/aleph-sign.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAddress, recoverTypedDataAddress, type Hex } from "viem";

process.env.ALEPH_ESCROW_ADDRESS = "0x" + "e".repeat(40);
process.env.CHAIN_ID = "84532";
const S = await import("../src/sign.js");

const ROOM = ("0x" + "ab".repeat(32)) as Hex;
// Direcciones con letras a-f (no dígitos): así "mayúscula vs. minúscula" es una
// diferencia real de string y no una prueba que compara un valor consigo mismo.
const SEATS = ["a", "b", "c", "d"].map((c) => ("0x" + c.repeat(40)) as Hex);
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

test("alephSeatsHash/alephTableHash no truenan con direcciones en formato checksum EIP-55, y dan el mismo hash", () => {
  const checksummed = SEATS.map((a) => getAddress(a));
  // Ninguna es igual a su original en minúsculas: si lo fuera, esta prueba
  // compararía un valor consigo mismo (el mismo defecto del Hallazgo 1).
  for (const [i, c] of checksummed.entries()) assert.notEqual(c, SEATS[i]);
  assert.equal(S.alephSeatsHash(checksummed), S.alephSeatsHash(SEATS));

  const amounts = [1_000_000n, 2_000_000n, 3_000_000n, 4_000_000n];
  assert.equal(S.alephTableHash(checksummed, amounts), S.alephTableHash(SEATS, amounts));
});

test("ALEPH_SEAT_TYPES/ALEPH_PAYOUT_TYPES coinciden con los typehashes del .sol, sin nodo", () => {
  // Los tres tests de arriba solo prueban autoconsistencia: firman y recuperan
  // con los mismos `S.alephDomain()`/`S.ALEPH_*_TYPES`, así que un uint256 donde
  // el contrato dice uint64, un campo cambiado de orden o encodePacked en vez de
  // abi.encode pasarían igual de verdes. Esto ata los tipos exportados al string
  // del contrato (el e2e en anvil de la Tarea 7 cubre la igualdad on-chain real,
  // pero corre en otro job de CI). `fileURLToPath(new URL(..., import.meta.url))`
  // es el mismo patrón que ya usa apps/mcp/test/manifest.test.ts.
  const sol = readFileSync(
    fileURLToPath(new URL("../../../packages/contracts/src/EscrowAleph.sol", import.meta.url)),
    "utf8",
  );
  const typeString = (name: string, fields: readonly { name: string; type: string }[]) =>
    `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;

  const seatMatch = sol.match(/SEAT_TYPEHASH\s*=\s*keccak256\(\s*"([^"]+)"/);
  assert.ok(
    seatMatch,
    "no encontré SEAT_TYPEHASH en EscrowAleph.sol (¿cambió el nombre o la forma?)",
  );
  assert.equal(seatMatch[1], typeString("Seat", S.ALEPH_SEAT_TYPES.Seat));

  const payoutMatch = sol.match(/PAYOUT_TYPEHASH\s*=\s*keccak256\(\s*"([^"]+)"/);
  assert.ok(
    payoutMatch,
    "no encontré PAYOUT_TYPEHASH en EscrowAleph.sol (¿cambió el nombre o la forma?)",
  );
  assert.equal(payoutMatch[1], typeString("Payout", S.ALEPH_PAYOUT_TYPES.Payout));
});
