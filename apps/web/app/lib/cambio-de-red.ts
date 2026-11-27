// Pasar la wallet a la red de la app, sin quedarse colgado.
//
// Con la wallet en otra red, el encabezado abría la ventana de red de
// RainbowKit: "Base Sepolia · Confirmar en la cartera" y nada más. Conectado
// con el QR de MetaMask, el pedido de cambio de red puede no llegar nunca al
// celular (la conexión se cortó, o la app estaba cerrada), y esa ventana
// esperaba para siempre sin decir qué hacer.
//
// La ventana propia (components/WrongNetworkDialog.tsx) sigue estas fases.
// Acá viven puras, para probarlas sin React (test/cambio-de-red.test.ts).

/** Cuánto esperar el cambio de red antes de explicar cómo hacerlo a mano. Una
 *  wallet que lo recibe pregunta enseguida; si pasa este tiempo, lo más
 *  probable es que el pedido no haya llegado. */
export const SWITCH_STUCK_MS = 15_000;

/** - `idle`: todavía no se pidió nada.
 *  - `waiting`: se le pidió a la wallet que cambie de red.
 *  - `stuck`: pasó SWITCH_STUCK_MS sin respuesta (el pedido sigue en pie: si
 *    la wallet contesta más tarde, cuenta igual).
 *  - `rejected`: el usuario lo canceló en la wallet.
 *  - `failed`: la wallet no pudo cambiar de red. */
export type SwitchPhase = "idle" | "waiting" | "stuck" | "rejected" | "failed";

export type SwitchEvent = "start" | "timeout" | "rejected" | "failed" | "reset";

export function nextSwitchPhase(phase: SwitchPhase, event: SwitchEvent): SwitchPhase {
  const pending = phase === "waiting" || phase === "stuck";
  switch (event) {
    case "start":
      return "waiting";
    case "timeout":
      // Un tope viejo no pisa una respuesta que ya llegó.
      return phase === "waiting" ? "stuck" : phase;
    case "rejected":
    case "failed":
      // La respuesta vale aunque llegue tarde (después del tope), pero no si
      // ya no había nada pendiente.
      return pending ? event : phase;
    case "reset":
      return "idle";
  }
}

/** ¿Se puede volver a pedir el cambio? No mientras hay uno pendiente: la wallet
 *  atiende los pedidos de a uno, y uno nuevo quedaría en la fila detrás del
 *  que no contestó. */
export function canRequestSwitch(phase: SwitchPhase): boolean {
  return phase !== "waiting" && phase !== "stuck";
}

/** ¿Mostrar cómo cambiar la red a mano en la wallet (y desconectar si la web no
 *  se entera)? Cuando el pedido no llegó, o la wallet no pudo. */
export function showsManualHelp(phase: SwitchPhase): boolean {
  return phase === "stuck" || phase === "failed";
}
