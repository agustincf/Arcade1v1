// LA PORTADA DE /aleph. Lo primero que ve el que llega (casi siempre desde el
// celular): qué es en una línea y la última sala dibujada con sus criaturas,
// antes que los tres párrafos de reglas. Sin esto, la primera pantalla en
// mobile era solo texto.
//
// NO calcula nada propio: los estados, los chips y los montos salen de
// `modeloDeEscena`, el mismo modelo que dibuja la sala. La portada no puede
// mostrar una criatura distinta de la que el visitante encuentra al entrar.

import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { shortAddress } from "@/app/lib/wallet";
import { Criatura } from "./Criatura";
import { modeloDeEscena, type AsientoDeEscena, type Traductor } from "./nucleo/escena";
import type { SalaDeAleph } from "./nucleo/estados";

/** Cuatro sillas grises mientras llega la sala: mismo alto que la fila real,
 *  así la página no salta cuando carga. */
const SILLAS_DE_ESPERA = 4;

export function Portada({
  sala,
  roomId,
  etapas,
  cargando,
  t,
}: {
  /** La vista pública de la última sala liquidada, o null si todavía no llegó o no hay. */
  sala: SalaDeAleph | null;
  roomId: string | null;
  etapas: number;
  /** Todavía no se sabe si hay sala: se dibujan las sillas de espera. */
  cargando: boolean;
  t: Traductor;
}) {
  // Cada asiento mide 64 px con 8 de separación: a 375 px entran cuatro por
  // fila (una mesa de 8 queda en dos filas parejas); a 320, tres. En escritorio
  // el `max-w-md` también corta en cuatro: con cinco, el sexto quedaba solo.
  // Primero el que más se llevó: la fila se lee "quién ganó" de izquierda a
  // derecha. Los finalistas van fuera de la grilla en la escena; acá, juntos.
  const asientos: AsientoDeEscena[] = sala
    ? (() => {
        const m = modeloDeEscena(sala);
        return [...m.finalistas, ...m.asientos].sort((a, b) => b.bolsillo - a.bolsillo);
      })()
    : [];
  const maximo = asientos.reduce((m, a) => Math.max(m, a.bolsillo), 0);

  return (
    <section className="win mt-3">
      <div className="px-4 py-6 text-center sm:px-8 sm:py-8">
        <p className="font-pixel text-px10 tracking-wide text-(--color-accent-2)">
          ALEPH · {t("aleph.portada.kicker")}
        </p>
        <h1 className="mt-4 font-pixel text-base leading-relaxed text-(--color-text-strong) sm:text-xl">
          {t("aleph.portada.titulo")}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-(--color-muted) sm:text-base">
          {t("aleph.portada.bajada")}
        </p>

        {cargando ? (
          <ul className="mt-6 flex justify-center gap-4" aria-hidden="true">
            {Array.from({ length: SILLAS_DE_ESPERA }, (_, i) => (
              <li key={i} className="criatura--portada rounded-md bg-(--color-surface-2)" />
            ))}
          </ul>
        ) : (
          sala &&
          roomId && (
            <>
              <p className="mt-6 text-sm text-(--color-muted-2)">
                {t("aleph.portada.ultima", { seats: asientos.length, stages: etapas })}
              </p>
              <ul className="mx-auto mt-3 flex max-w-md flex-wrap justify-center gap-x-2 gap-y-4 sm:gap-x-4">
                {asientos.map((a) => {
                  const chip = t(a.chip);
                  return (
                    <li key={a.address} className="flex w-16 flex-col items-center sm:w-24">
                      <Criatura
                        address={a.address}
                        estado={a.estado}
                        traidor={a.traidor}
                        oro={{ bolsillo: a.bolsillo, maximo }}
                        clase="criatura--portada"
                        etiquetaA11y={`${shortAddress(a.address)}, ${chip}, ${a.bolsillo}`}
                      />
                      <span className="mt-1 font-pixel text-px10 text-(--color-gold)">
                        {a.bolsillo}
                      </span>
                      <span
                        className="mt-1 text-xs leading-tight text-(--color-muted-2)"
                        aria-hidden="true"
                      >
                        {chip}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )
        )}

        <div className="mt-6 flex flex-col items-center gap-3">
          {roomId && sala && (
            <Link href={`/aleph/${roomId}`} className="btn3d">
              ► {t("aleph.portada.mirar")}
            </Link>
          )}
          <a
            href="#sentarse"
            className="text-sm font-medium text-(--color-accent-2) hover:underline"
          >
            {t("aleph.portada.sentar")}
          </a>
        </div>
      </div>
    </section>
  );
}
