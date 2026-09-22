// El reloj mm:ss del sitio. Vivía como función privada de módulo adentro de
// `apps/web/app/aleph/[roomId]/page.tsx`; la carta de etapa de la escena
// necesita el mismo formato, así que se muda acá con `export` en vez de
// quedar escrita dos veces.

/** Milisegundos que faltan, como `mm:ss`. Nunca negativo. */
export function mmss(ms: number): string {
  const left = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
}
