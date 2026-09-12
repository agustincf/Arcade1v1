// La guarda de escrow del árbitro, en su PROPIO proceso: con mesas de plata
// configuradas pero SIN contrato, sentarse en una de ellas se rechaza.
//
// Va en un archivo aparte a propósito. `aleph-chain.ts` captura
// ALEPH_ESCROW_ADDRESS en una constante de módulo al importarse, y `node --test`
// corre un proceso por ARCHIVO: dentro de aleph-funding.test.ts —que la necesita
// seteada para todo lo demás— esta rama no se puede ejercitar. Hoy esta línea es
// la ÚNICA defensa: sin ella el árbitro abriría salas de plata que nadie puede
// fondear (config-guard todavía no chequea las ALEPH_*).
// Correr: node --import tsx --test apps/server/test/aleph-funding-no-escrow.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

process.env.ALEPH_STAKES = "0,2";
// Explícito, no "confío en que no esté": offline-env limpia ESCROW_ADDRESS y
// CHAIN_ID del 1v1, pero todavía no esta (queda para la tarea de config-guard),
// así que una variable exportada en la shell haría pasar el test por la razón
// equivocada.
delete process.env.ALEPH_ESCROW_ADDRESS;
const V = await import("../src/aleph.js");

const T0 = 1_800_000_000_000;
const addr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();

test("sin ALEPH_ESCROW_ADDRESS, la mesa de plata se rechaza aunque esté en ALEPH_STAKES", async () => {
  V.__resetAlephForTest();
  assert.deepEqual(V.ALEPH_STAKES, [0, 2], "la mesa de 2 está configurada...");
  await assert.rejects(
    () => V.joinAleph(2, addr(), undefined, T0),
    /money tables are not enabled/,
    "...pero sin contrato no se abre",
  );
  // Y no quedó ninguna sala a medio armar.
  assert.deepEqual(V.listAlephLobbies(T0), []);
  // La mesa gratis, en cambio, funciona igual que siempre: la guarda es SOLO
  // para las de plata.
  const v = await V.joinAleph(0, addr(), undefined, T0);
  assert.equal(v.status, "lobby");
  assert.equal(v.stake, 0);
  assert.equal(v.deposit, undefined);
  assert.equal(v.escrow, undefined);
});
