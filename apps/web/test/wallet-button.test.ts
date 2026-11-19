// El botón de la wallet del encabezado: qué hace al tocarlo.
//
// Con la wallet en una red que la app no usa (típico: MetaMask del celular por
// el QR, parada en Ethereum o en Base), RainbowKit deja el menú de la cuenta en
// un no-op: tocar la dirección no hacía nada y no había forma de desconectar.
// Ahí el botón tiene que abrir el menú de red, que permite cambiar de red y
// desconectar.
//
// Correr: node --import tsx --test apps/web/test/wallet-button.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { walletButtonMode } from "../app/lib/wallet-button.js";

test("sin wallet conectada, el botón conecta", () => {
  assert.equal(walletButtonMode({ connected: false, unsupportedChain: false }), "connect");
  assert.equal(walletButtonMode({ connected: false, unsupportedChain: true }), "connect");
});

test("conectada en la red de la app, abre el menú de la cuenta", () => {
  assert.equal(walletButtonMode({ connected: true, unsupportedChain: false }), "account");
});

test("conectada en otra red, abre el menú de red (cambiar o desconectar)", () => {
  assert.equal(walletButtonMode({ connected: true, unsupportedChain: true }), "chain");
});
