// Al conectar, el cambio de red no puede dejar la conexión colgada.
//
// RainbowKit conecta SIEMPRE pidiendo la red de la app: si la wallet aprueba la
// conexión parada en otra red (sin Base Sepolia en la sesión), wagmi le pide
// pasarse a Base Sepolia y espera ANTES de dar la conexión por hecha. Esa
// espera se colgaba de dos maneras, y la web seguía mostrando el QR como si
// nadie lo hubiera escaneado:
//  1. Con el QR de MetaMask, el pedido puede no llegar nunca al celular.
//  2. Aunque la wallet acepte, el conector de WalletConnect de wagmi (6.2) da
//     el cambio por hecho recién cuando oye el aviso de "cambió la red", y
//     durante la conexión todavía no lo escucha (se suscribe después): espera
//     para siempre un aviso que ya pasó.
//
// Este envoltorio, solo mientras conecta: si la wallet ya está en la red
// pedida, da el cambio por hecho (sondea la red del proveedor, así no depende
// del aviso); y si en SWITCH_STUCK_MS no pasó nada, el cambio falla como "no se
// pudo" (no como "lo cancelaste"), wagmi termina la conexión en la red en la
// que está la wallet, y la web muestra "RED EQUIVOCADA" con la ventana que
// explica cómo cambiarla (components/WrongNetworkDialog.tsx).
//
// Fuera de la conexión (el botón "Pasar a…" de esa ventana, o antes de firmar)
// el cambio de red sigue como siempre: esa ventana tiene su propio aviso, y ahí
// wagmi ya escucha el aviso de la wallet.

import { SwitchChainError } from "viem";
import type { CreateConnectorFn } from "wagmi";
import { SWITCH_STUCK_MS } from "./cambio-de-red";

/** Cada cuánto mirar si la wallet ya cambió de red mientras conecta. */
const SONDEO_MS = 500;

/** El cambio de red que pide la conexión, con tope. Termina bien si el cambio
 *  termina, o si `yaCambio` encuentra la wallet en la red pedida; si no pasa
 *  nada en `ms`, falla como SwitchChainError (código 4902): wagmi lo toma como
 *  "no se pudo cambiar" y conecta igual. Un rechazo del usuario (4001) sigue
 *  siendo un rechazo. Una respuesta tardía, después del tope, no deja un
 *  rechazo suelto. */
export function conTope<T>(
  cambio: Promise<T>,
  ms: number,
  yaCambio?: () => Promise<T | undefined>,
  cadaMs = SONDEO_MS,
): Promise<T> {
  return new Promise<T>((ok, no) => {
    let listo = false;
    let sondeo: ReturnType<typeof setInterval> | undefined;
    const terminar = (fn: () => void) => {
      if (listo) return;
      listo = true;
      clearTimeout(tope);
      if (sondeo) clearInterval(sondeo);
      fn();
    };
    const tope = setTimeout(
      () =>
        terminar(() =>
          no(new SwitchChainError(new Error("la wallet no contestó el cambio de red"))),
        ),
      ms,
    );
    if (yaCambio) {
      sondeo = setInterval(() => {
        yaCambio().then(
          (red) => {
            if (red !== undefined) terminar(() => ok(red));
          },
          () => {}, // si no se puede leer la red, se sigue esperando
        );
      }, cadaMs);
    }
    cambio.then(
      (v) => terminar(() => ok(v)),
      (e) => terminar(() => no(e)),
    );
  });
}

/** Envuelve un conector de wagmi: mientras `connect` está en curso, su
 *  `switchChain` pasa por `conTope`. wagmi copia el objeto que devuelve el
 *  conector (`{ ...conector }`) y llama a sus métodos sobre la copia: por eso
 *  se pasa `this` tal cual, y el `this.switchChain` que usa `connect` adentro
 *  es el envuelto. */
export function conTopeAlConectar(
  crear: CreateConnectorFn,
  ms = SWITCH_STUCK_MS,
): CreateConnectorFn {
  return ((config: Parameters<CreateConnectorFn>[0]) => {
    const c = crear(config) as any;
    let conectando = false;
    const envuelto: any = {
      ...c,
      async connect(this: any, params: any) {
        conectando = true;
        try {
          return await c.connect.call(this, params);
        } finally {
          conectando = false;
        }
      },
    };
    if (typeof c.switchChain === "function") {
      envuelto.switchChain = function (this: any, params: any) {
        const cambio = c.switchChain.call(this, params);
        if (!conectando) return cambio;
        const red = config.chains.find((x) => x.id === params?.chainId);
        const yaCambio = async () =>
          red && (await this.getChainId()) === red.id ? red : undefined;
        return conTope(cambio, ms, yaCambio);
      };
    }
    return envuelto;
  }) as CreateConnectorFn;
}
