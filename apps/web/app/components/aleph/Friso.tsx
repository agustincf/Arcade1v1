// EL FRISO: una carta chiquita por etapa jugada, la actual con borde coral y
// los dorsos de las que faltan. Es lo que contesta "cuántas se jugaron" sin
// leer el relato entero.
//
// Y se explica a la vista, no solo al lector de pantalla: un rótulo arriba
// dice qué es la fila, cada carta dice qué etapa es al pasarle el mouse (con
// sus marcas) y, si la sala tiene alguna marca, abajo va la leyenda de los
// dos puntos.

import { useId } from "react";
import type { ReactNode } from "react";
import { Dorso, Glifo } from "./Objetos";
import type { CartaDelFriso, FrisoDeEscena, Traductor } from "./nucleo/escena";

/** El nombre de una carta jugada: la etapa y, detrás, sus marcas. Un punto no
 *  dice nada solo, así que el nombre las cuenta con palabras. */
function nombreDeJugada(j: CartaDelFriso, t: Traductor): string {
  const partes = [t("aleph.frieze.played", { n: j.n, kind: t(`aleph.stage.${j.kind}`) })];
  if (j.salida) partes.push(t("aleph.frieze.left"));
  if (j.premio) partes.push(t("aleph.frieze.bonus"));
  return partes.join(". ");
}

/** Una carta, con su nombre dos veces y a propósito. Como texto oculto, para
 *  el lector: varios no leen el aria-label de un listitem. Y como tooltip del
 *  dibujo, para el mouse: el dibujo es `aria-hidden`, así el lector no lo
 *  dice dos veces, y ocupa la carta entera, así el tooltip salta en cualquier
 *  punto de ella. */
function Carta({
  nombre,
  clase,
  children,
}: {
  nombre: string;
  clase: string;
  children: ReactNode;
}) {
  return (
    <li className={clase}>
      <span className="sr-only">{nombre}</span>
      <span className="friso-dibujo" aria-hidden="true" title={nombre}>
        {children}
      </span>
    </li>
  );
}

export function Friso({ friso, t }: { friso: FrisoDeEscena; t: Traductor }) {
  const rotulo = useId();
  const haySalida = friso.jugadas.some((j) => j.salida);
  const hayPremio = friso.jugadas.some((j) => j.premio);
  return (
    <div className="mt-4">
      <p id={rotulo} className="text-sm text-(--color-muted-3)">
        {t("aleph.frieze.title")}
      </p>
      <ol className="friso mt-1" aria-labelledby={rotulo}>
        {friso.jugadas.map((j) => (
          <Carta key={`j${j.n}`} nombre={nombreDeJugada(j, t)} clase="friso-carta">
            <Glifo kind={j.kind} />
            {j.salida && <span className="friso-salida" />}
            {j.premio && <span className="friso-premio" />}
          </Carta>
        ))}
        {friso.actual && (
          <Carta
            nombre={t("aleph.frieze.current", {
              n: friso.actual.n,
              kind: t(`aleph.stage.${friso.actual.kind}`),
            })}
            clase="friso-carta friso-carta--actual"
          >
            <Glifo kind={friso.actual.kind} />
          </Carta>
        )}
        {Array.from({ length: friso.dorsos }, (_, i) => (
          <Carta
            key={`d${i}`}
            nombre={t("aleph.frieze.back")}
            clase="friso-carta friso-carta--dorso"
          >
            <Dorso />
          </Carta>
        ))}
      </ol>
      {/* La leyenda solo con las marcas que hay: explicar un punto que no está
          en pantalla es ruido. Va `aria-hidden` porque es la clave de un
          dibujo, y el lector ya oye cada marca en el nombre de su carta. */}
      {(haySalida || hayPremio) && (
        <p className="friso-leyenda mt-2 text-xs text-(--color-muted-3)" aria-hidden="true">
          {haySalida && (
            <span className="friso-leyenda-entrada">
              <span className="friso-muestra">
                <span className="friso-salida" />
              </span>
              {t("aleph.frieze.left")}
            </span>
          )}
          {hayPremio && (
            <span className="friso-leyenda-entrada">
              <span className="friso-muestra">
                <span className="friso-premio" />
              </span>
              {t("aleph.frieze.bonus")}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
