// La guarda de configuración de la web. El modo de falla que cubre es el peor
// del producto: con NEXT_PUBLIC_ESCROW_ADDRESS vacía, `onchainEnabled` se apaga
// solo y una mesa de "5 USDC" se jugaba SIN depósito, con la pantalla diciendo
// 5 USDC igual. Nadie depositaba, nadie cobraba, y no había ni un aviso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { webConfigErrors, moneyTableBlocked, type WebEnv } from "../app/lib/config-guard";

const OK: WebEnv = {
  NODE_ENV: "production",
  NEXT_PUBLIC_ARBITER_URL: "https://arcade1v1.onrender.com",
  NEXT_PUBLIC_ESCROW_ADDRESS: "0xF6B4bd37d4571B23a707A3C128fcA1a4714BeecB",
  NEXT_PUBLIC_USDC_ADDRESS: "0xBE3A57a90548b336F5EBF997E6DA6d3DC64EE137",
  NEXT_PUBLIC_CHAIN_ID: "84532",
};

test("una configuración correcta no reporta nada", () => {
  assert.deepEqual(webConfigErrors(OK), []);
});

test("media configuración es peor que ninguna: falta el escrow y sobra el USDC", () => {
  const errs = webConfigErrors({ ...OK, NEXT_PUBLIC_ESCROW_ADDRESS: "" });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /las dos o ninguna/);
});

test("sin ninguna de las dos direcciones no hay error: es un despliegue sin plata", () => {
  assert.deepEqual(
    webConfigErrors({ ...OK, NEXT_PUBLIC_ESCROW_ADDRESS: "", NEXT_PUBLIC_USDC_ADDRESS: "" }),
    [],
  );
});

test("dirección con typo: se detecta el formato, no solo la presencia", () => {
  const errs = webConfigErrors({ ...OK, NEXT_PUBLIC_ESCROW_ADDRESS: "0xF6B4bd37" });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /mal formada/);
});

test("dirección cero: el pago on-chain quedaría roto", () => {
  const errs = webConfigErrors({
    ...OK,
    NEXT_PUBLIC_ESCROW_ADDRESS: "0x0000000000000000000000000000000000000000",
  });
  assert.match(errs.join(" "), /dirección cero/);
});

test("en producción falta la URL del árbitro: le pegaría a localhost", () => {
  const errs = webConfigErrors({ ...OK, NEXT_PUBLIC_ARBITER_URL: "" });
  assert.match(errs.join(" "), /localhost:4000/);
});

test("en producción el árbitro tiene que ser https", () => {
  const errs = webConfigErrors({ ...OK, NEXT_PUBLIC_ARBITER_URL: "http://arcade1v1.onrender.com" });
  assert.match(errs.join(" "), /https en producción/);
});

test("fuera de producción no se exige la URL del árbitro", () => {
  assert.deepEqual(
    webConfigErrors({ ...OK, NODE_ENV: "development", NEXT_PUBLIC_ARBITER_URL: "" }),
    [],
  );
});

test("mainnet declarada sin escrow: anunciaría dinero real y jugaría gratis", () => {
  const errs = webConfigErrors({
    ...OK,
    NEXT_PUBLIC_CHAIN_ID: "8453",
    NEXT_PUBLIC_ESCROW_ADDRESS: "",
    NEXT_PUBLIC_USDC_ADDRESS: "",
  });
  assert.match(errs.join(" "), /anunciaría dinero real/);
});

test("chain id no numérico", () => {
  assert.match(webConfigErrors({ ...OK, NEXT_PUBLIC_CHAIN_ID: "base" }).join(" "), /inválido/);
});

test("moneyTableBlocked: una mesa de plata sin escrow NO se juega", () => {
  assert.equal(moneyTableBlocked(5, false), true, "5 USDC sin pago on-chain: bloqueada");
  assert.equal(moneyTableBlocked(5, true), false, "5 USDC con escrow: se juega normal");
  assert.equal(moneyTableBlocked(0, false), false, "la ladder gratis no necesita escrow");
  assert.equal(moneyTableBlocked(0, true), false);
});
