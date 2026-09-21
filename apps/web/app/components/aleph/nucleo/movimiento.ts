// EL BOTÓN DE PAUSAR EL MOVIMIENTO. Una sala dura 40 minutos y el media query
// de `prefers-reduced-motion` no cubre al que simplemente se cansa.
//
// Todo acceso a `localStorage` va adentro de un try/catch: en una ventana
// privada, con las cookies bloqueadas o durante una captura, el acceso TIRA
// —no devuelve `null`—. Si no se puede leer, el default es CON movimiento.

const CLAVE = "aleph.movimiento";

/** `true` = con movimiento. Cualquier problema cae del lado del default. */
export function leerPreferencia(): boolean {
  try {
    return globalThis.localStorage?.getItem(CLAVE) !== "off";
  } catch {
    return true;
  }
}

export function guardarPreferencia(conMovimiento: boolean): void {
  try {
    globalThis.localStorage?.setItem(CLAVE, conMovimiento ? "on" : "off");
  } catch {
    // Sin storage la preferencia dura lo que dure la pestaña. No es un error
    // que haya que contarle a nadie.
  }
}
