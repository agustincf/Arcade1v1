// El árbitro NUNCA miraba la cadena: emparejaba, aceptaba puntajes y firmaba
// resultados sin saber si alguien había depositado. Un atacante encolaba wallets
// recién generadas en las mesas de plata —solo cuesta una firma, y el rate limit
// deja ~12 pedidos por segundo— y no depositaba jamás. Cada humano que sí
// depositó quedaba con la plata trabada hasta que venciera el plazo, y tenía que
// descubrir /recover por su cuenta para pedir el reembolso pagando gas.
//
// Acá se prueba la REGLA (función pura). La lectura RPC en sí queda cubierta por
// el e2e contra anvil de packages/contracts/check-payment-e2e.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { razonRechazoDeposito, ONCHAIN_STATUS, type OnchainMatch } from "../src/onchain.js";

const P1 = "0xAAAaAAaaAAAAaAAAAaaAaaaAAAaAAAaaaAaAAAAa";
const P2 = "0xBbBbbBBBbbbbBbBBbbbbBBBBbBbbBBbBbBbBBbBb";
const FANTASMA = "0xCcCCccCCCCCCcCCCCCCcccCcccCCCCCcCcccCCcC";
const ZERO = "0x0000000000000000000000000000000000000000";

const partida = (over: Partial<OnchainMatch> = {}): OnchainMatch => ({
  p1: P1,
  p2: P2,
  stake: 5_000_000n,
  status: ONCHAIN_STATUS.Funded,
  ...over,
});

test("los dos que depositaron pueden enviar puntaje", () => {
  assert.equal(razonRechazoDeposito(partida(), P1), null);
  assert.equal(razonRechazoDeposito(partida(), P2), null);
});

test("las direcciones se comparan sin distinguir mayúsculas", () => {
  assert.equal(razonRechazoDeposito(partida(), P1.toLowerCase()), null);
  assert.equal(razonRechazoDeposito(partida(), P1.toUpperCase()), null);
});

test("el modelo asincrónico sigue funcionando: p1 envía con la partida en Open", () => {
  // Este es el caso que hace que NO se pueda exigir status Funded: el primero
  // juega y manda su puntaje cuando todavía no hay rival.
  const soloP1 = partida({ p2: ZERO, status: ONCHAIN_STATUS.Open });
  assert.equal(razonRechazoDeposito(soloP1, P1), null);
});

test("el fantasma que emparejó pero nunca depositó queda afuera", () => {
  const motivo = razonRechazoDeposito(partida(), FANTASMA);
  assert.match(String(motivo), /no on-chain deposit found/);
});

test("una partida que no existe en la cadena se rechaza", () => {
  assert.match(String(razonRechazoDeposito(null, P1)), /no on-chain deposit found/);
  assert.match(
    String(razonRechazoDeposito(partida({ status: ONCHAIN_STATUS.None, p1: ZERO, p2: ZERO }), P1)),
    /no on-chain deposit found/,
  );
});

test("una partida ya pagada o reembolsada no acepta más puntajes", () => {
  assert.match(
    String(razonRechazoDeposito(partida({ status: ONCHAIN_STATUS.Settled }), P1)),
    /already settled or refunded/,
  );
  assert.match(
    String(razonRechazoDeposito(partida({ status: ONCHAIN_STATUS.Refunded }), P2)),
    /already settled or refunded/,
  );
});

test("el segundo slot vacío no deja colar a la dirección cero", () => {
  const soloP1 = partida({ p2: ZERO, status: ONCHAIN_STATUS.Open });
  assert.match(String(razonRechazoDeposito(soloP1, ZERO)), /no on-chain deposit found/);
});
