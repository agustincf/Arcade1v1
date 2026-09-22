// EL FRISO: una carta chiquita por etapa jugada, la actual con borde coral y
// los dorsos de las que faltan. Es lo que contesta "cuántas se jugaron" sin
// leer el relato entero.

import { Dorso, Glifo } from "./Objetos";
import type { FrisoDeEscena, Traductor } from "./nucleo/escena";

export function Friso({ friso, t }: { friso: FrisoDeEscena; t: Traductor }) {
  return (
    <ol className="friso mt-4" aria-label={t("aleph.frieze.title")}>
      {friso.jugadas.map((j) => (
        <li key={`j${j.n}`} className="friso-carta">
          {/* El nombre va como texto oculto y no como aria-label del <li>:
              varios lectores no leen el aria-label de un listitem, y todo lo
              de adentro (Glifo, Dorso) es aria-hidden. */}
          <span className="sr-only">
            {t("aleph.frieze.played", { n: j.n, kind: t(`aleph.stage.${j.kind}`) })}
          </span>
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
        <li className="friso-carta friso-carta--actual">
          <span className="sr-only">
            {t("aleph.frieze.current", {
              n: friso.actual.n,
              kind: t(`aleph.stage.${friso.actual.kind}`),
            })}
          </span>
          <Glifo kind={friso.actual.kind} />
        </li>
      )}
      {Array.from({ length: friso.dorsos }, (_, i) => (
        <li key={`d${i}`} className="friso-carta friso-carta--dorso">
          <span className="sr-only">{t("aleph.frieze.back")}</span>
          <Dorso />
        </li>
      ))}
    </ol>
  );
}
