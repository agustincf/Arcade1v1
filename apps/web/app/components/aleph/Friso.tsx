// EL FRISO: una carta chiquita por etapa jugada, la actual con borde coral y
// los dorsos de las que faltan. Es lo que contesta "cuántas se jugaron" sin
// leer el relato entero.

import { Dorso, Glifo } from "./Objetos";
import type { FrisoDeEscena, Traductor } from "./nucleo/escena";

export function Friso({ friso, t }: { friso: FrisoDeEscena; t: Traductor }) {
  return (
    <ol className="friso mt-4" aria-label={t("aleph.frieze.title")}>
      {friso.jugadas.map((j) => (
        <li
          key={`j${j.n}`}
          className="friso-carta"
          aria-label={t("aleph.frieze.played", { n: j.n, kind: t(`aleph.stage.${j.kind}`) })}
        >
          <Glifo kind={j.kind} />
          {/* Las dos marcas llevan su propio rótulo: un punto no dice nada solo.
              `role="img"` + `aria-label` es lo que las expone al lector. */}
          {j.salida && (
            <span className="friso-salida" role="img" aria-label={t("aleph.frieze.left")} />
          )}
          {j.premio && (
            <span className="friso-premio" role="img" aria-label={t("aleph.frieze.bonus")} />
          )}
        </li>
      ))}
      {friso.actual && (
        <li
          className="friso-carta friso-carta--actual"
          aria-label={t("aleph.frieze.current", {
            n: friso.actual.n,
            kind: t(`aleph.stage.${friso.actual.kind}`),
          })}
        >
          <Glifo kind={friso.actual.kind} />
        </li>
      )}
      {Array.from({ length: friso.dorsos }, (_, i) => (
        <li
          key={`d${i}`}
          className="friso-carta friso-carta--dorso"
          aria-label={t("aleph.frieze.back")}
        >
          <Dorso />
        </li>
      ))}
    </ol>
  );
}
