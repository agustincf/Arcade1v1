// La guarda de escrow del árbitro, en su PROPIO proceso: con mesas de plata
// configuradas pero SIN contrato, sentarse en una de ellas se rechaza.
//
// Va en un archivo aparte a propósito. `aleph-chain.ts` captura
// ALEPH_ESCROW_ADDRESS en una constante de módulo al importarse, y `node --test`
// corre un proceso por ARCHIVO: dentro de aleph-funding.test.ts —que la necesita
// seteada para todo lo demás— esta rama no se puede ejercitar.
//
// Son DOS defensas, y esta es la de adentro. La de afuera vive en
// config-guard.ts (`ALEPH_STAKES` con plata exige ALEPH_ESCROW_ADDRESS bien
// formada) y la fija config-guard.test.ts: en producción el servidor ni
// arranca. Pero esa guarda solo corre con NODE_ENV=production y solo al
// arrancar, así que fuera de producción —o si alguien saca la variable con el
// proceso vivo— lo único que impide abrir salas de plata que nadie puede
// fondear es este rechazo por llamada, que es lo que fija este archivo.
// Correr: node --import tsx --test apps/server/test/aleph-funding-no-escrow.test.ts
import "../src/offline-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

process.env.ALEPH_STAKES = "0,2";
// Explícito, aunque offline-env ya la limpie: esta línea es la PREMISA del
// test, no un detalle: si alguien la sacara de offline-env, una variable
// exportada en la shell haría pasar el test por la razón equivocada.
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
