// Al conectar, el cambio de red no puede dejar la conexión colgada.
//
// RainbowKit conecta pidiendo la red de la app, y wagmi espera el cambio de
// red antes de dar la conexión por hecha. Con el QR de MetaMask el pedido
// podía no llegar nunca, y aunque la wallet aceptara, wagmi esperaba un aviso
// que durante la conexión no escucha: la conexión quedaba colgada y la web
// seguía mostrando el QR. Ahora, si la wallet ya está en la red pedida, conecta
// ahí; si no pasa nada, la conexión termina en la red de la wallet y la web
// dice "RED EQUIVOCADA" con la ventana que explica cómo cambiarla.
//
// El conector de prueba imita a wagmi: su `connect` llama a `this.switchChain`
// y, si el cambio falla sin ser un rechazo del usuario (4001), conecta igual en
// la red en la que está. Y se usa como lo usa wagmi: copiado con `{ ...c }`.
//
// Correr: node --import tsx --test apps/web/test/tope-cambio-de-red.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { UserRejectedRequestError } from "viem";
import { conTope, conTopeAlConectar } from "../app/lib/tope-cambio-de-red.js";

const RED_DE_LA_WALLET = 1;
const RED_DE_LA_APP = 84532;
const NUNCA = new Promise<never>(() => {});

/** Un conector como el de WalletConnect de wagmi, con la respuesta de la
 *  wallet al cambio de red a elección y la red en la que está su proveedor. */
function conector(
  respuesta: () => Promise<{ id: number }>,
  redDelProveedor: () => number = () => RED_DE_LA_WALLET,
) {
  return () => ({
    id: "prueba",
    name: "Prueba",
    type: "walletConnect",
    async connect(this: any, { chainId }: { chainId?: number } = {}) {
      let actual = RED_DE_LA_WALLET;
      if (chainId && chainId !== actual) {
        const red = await this.switchChain({ chainId }).catch((e: any) => {
          if (e.code === UserRejectedRequestError.code) throw e;
          return { id: actual };
        });
        actual = red.id;
      }
      return { accounts: ["0x1"], chainId: actual };
    },
    switchChain: respuesta,
    async getChainId() {
      return redDelProveedor();
    },
  });
}

/** Lo que hace wagmi con el conector: lo copia y le llama los métodos. */
function comoWagmi(crear: (config: any) => any) {
  return { ...crear({ chains: [{ id: RED_DE_LA_APP }] }), uid: "x" };
}

test("si la wallet no contesta el cambio de red, la conexión termina igual en su red", async () => {
  const c = comoWagmi(conTopeAlConectar(conector(() => NUNCA) as any, 20));
  const t0 = Date.now();
  const r = await c.connect({ chainId: RED_DE_LA_APP });
  assert.equal(r.chainId, RED_DE_LA_WALLET);
  assert.ok(Date.now() - t0 < 1_000, "no esperó de más");
});

test("si la wallet cambia de red a tiempo, conecta en la red de la app", async () => {
  const c = comoWagmi(
    conTopeAlConectar(conector(async () => ({ id: RED_DE_LA_APP })) as any, 1_000),
  );
  const r = await c.connect({ chainId: RED_DE_LA_APP });
  assert.equal(r.chainId, RED_DE_LA_APP);
});

test("si la wallet ya cambió de red pero el aviso no llega, conecta en la red de la app sin esperar el tope", async () => {
  // Lo que pasa con wagmi 6.2: la wallet acepta, el proveedor ya está en la red
  // nueva, pero el cambio no termina nunca (espera un aviso que no escucha).
  let red = RED_DE_LA_WALLET;
  setTimeout(() => (red = RED_DE_LA_APP), 30);
  const c = comoWagmi(
    conTopeAlConectar(
      conector(
        () => NUNCA,
        () => red,
      ) as any,
      5_000,
    ),
  );
  const t0 = Date.now();
  const r = await c.connect({ chainId: RED_DE_LA_APP });
  assert.equal(r.chainId, RED_DE_LA_APP);
  assert.ok(Date.now() - t0 < 2_000, "no esperó el tope");
});

test("si el usuario rechaza el cambio de red, sigue siendo un rechazo", async () => {
  const rechazo = new UserRejectedRequestError(new Error("user rejected"));
  const c = comoWagmi(conTopeAlConectar(conector(() => Promise.reject(rechazo)) as any, 1_000));
  await assert.rejects(c.connect({ chainId: RED_DE_LA_APP }), (e: any) => e.code === 4001);
});

test("fuera de la conexión, el cambio de red no tiene tope (la ventana tiene su aviso)", async () => {
  const c = comoWagmi(conTopeAlConectar(conector(() => NUNCA) as any, 10));
  const r = await Promise.race([
    c.switchChain({ chainId: RED_DE_LA_APP }).then(
      () => "contestó",
      () => "falló",
    ),
    new Promise((ok) => setTimeout(() => ok("sigue esperando"), 60)),
  ]);
  assert.equal(r, "sigue esperando");
});

test("el tope falla como 'no se pudo cambiar' (4902), no como 'cancelaste' (4001)", async () => {
  await assert.rejects(conTope(NUNCA, 10), (e: any) => e.code === 4902);
});

test("una respuesta que llega después del tope no deja un rechazo suelto", async () => {
  let rechazar!: (e: Error) => void;
  const tarde = new Promise((_, no) => (rechazar = no));
  await assert.rejects(conTope(tarde, 10));
  rechazar(new Error("contestó tarde"));
  // Si quedara suelto, node:test marcaría el archivo como fallido.
  await new Promise((ok) => setTimeout(ok, 20));
});
