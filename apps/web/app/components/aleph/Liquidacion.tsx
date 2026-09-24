// "Quién votó a quién". Se abre cuando la sala liquida: hasta entonces el
// árbitro responde 400 al registro, y mostrar los votos en vivo sería filtrar
// el juego.
//
// NO PIDE NADA: la página trae los eventos una sola vez y se los pasa. Si el
// pedido falló, `eventos` llega en `null` y el bloque muestra una línea que
// apunta al registro firmado, que ya está enlazado abajo.

import { gruposDeVotos } from "./nucleo/escena";
import type { EventoDeRegistro, Traductor } from "./nucleo/escena";
import type { ResultadoDeEtapa } from "./nucleo/estados";

export function Liquidacion({
  eventos,
  etapas,
  t,
  etiquetaDePorDireccion,
}: {
  eventos: EventoDeRegistro[] | null;
  /** `results` entero: es lo único que sabe el `kind` de cada índice —
   *  `AlephEvent` solo trae el número— y los `votes` de cada etapa de Voto,
   *  que listan a todos los que estaban vivos. */
  etapas: ResultadoDeEtapa[];
  t: Traductor;
  etiquetaDePorDireccion: (address: string) => string;
}) {
  const grupos = eventos ? gruposDeVotos(eventos, etapas) : [];
  return (
    <section className="paper mt-6">
      <div className="paper-title">
        <span>{t("aleph.votes.title")}</span>
      </div>
      <div className="p-5 sm:p-6">
        {!eventos ? (
          <p className="leading-relaxed text-(--color-paper-muted)">
            {t("aleph.votes.unavailable")}
          </p>
        ) : grupos.length === 0 ? (
          <p className="leading-relaxed text-(--color-paper-muted)">{t("aleph.votes.empty")}</p>
        ) : (
          <ol className="flex flex-col gap-5">
            {grupos.map((g) => (
              <li key={g.n}>
                <h3 className="text-base font-bold text-(--color-paper-ink)">
                  {t("aleph.room.stageHead", { n: g.n, kind: t(`aleph.stage.${g.kind}`) })}
                </h3>
                <ul className="mt-1 flex flex-col gap-1">
                  {g.votos.map((v, i) => (
                    <li key={i} className="leading-relaxed text-(--color-paper-muted)">
                      {t("aleph.votes.line", {
                        voter: etiquetaDePorDireccion(v.voter),
                        target: etiquetaDePorDireccion(v.target),
                      })}
                    </li>
                  ))}
                  {/* El que no vota queda contado en contra de sí mismo al
                      resolver la etapa, y eso lo pone el motor, no una acción
                      firmada: no aparece en los eventos. Sin esta línea, una
                      etapa con dos ausentes muestra menos votos de los que el
                      relato de abajo ya cuenta, en la misma pantalla. */}
                  {g.ausentes.length > 0 && (
                    <li className="leading-relaxed text-(--color-paper-muted-2)">
                      {t("aleph.votes.implied", {
                        who: g.ausentes.map(etiquetaDePorDireccion).join(", "),
                      })}
                    </li>
                  )}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
