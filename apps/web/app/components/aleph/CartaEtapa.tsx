// LA CARTA DE ETAPA: qué etapa es, qué regla rige, en qué fase estamos, cuánto
// falta y cuántos actuaron. Es lo único en toda la pantalla que le explica el
// juego a alguien que cayó en la etapa 6.
//
// NUNCA dice "etapa X de N": el total no existe. La Final no sale del mazo
// (entra cuando quedan dos vivos) y, si el mazo se vacía, el director sigue
// repartiendo Votos. `cardsLeft` dice cuántas cartas quedan SIN DAR, que es
// otra cosa, y eso lo cuenta el mazo de la mesa.

import { mmss } from "../../lib/tiempo";
import type { CartaDeEscena, Traductor } from "./nucleo/escena";

export function CartaEtapa({
  carta,
  now,
  t,
  etiquetaDePorDireccion,
}: {
  carta: CartaDeEscena;
  /** El mismo `useState` que mueve el reloj de la página: sin esta prop el
   *  mm:ss se dibujaría una vez y no se movería más. */
  now: number;
  t: Traductor;
  etiquetaDePorDireccion: (address: string) => string;
}) {
  return (
    <div className="carta-etapa mt-4">
      {carta.etapa && (
        <>
          <p className="font-pixel text-sm text-(--color-muted-bright)">
            {t("aleph.room.stageHead", {
              n: carta.etapa.n,
              kind: t(`aleph.stage.${carta.etapa.kind}`),
            })}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <span className="chip">{t(`aleph.phase.${carta.etapa.fase}`)}</span>
            {carta.etapa.hasta !== null && (
              // Crudo, sin clave de i18n: el contexto de al lado ya dice qué se
              // está contando, y el "(quedan {time})" que envolvía al mm:ss en
              // PR1 (una clave que PR2 borra) sobra adentro de la carta.
              <span className="font-mono text-sm text-(--color-gold)">
                {mmss(carta.etapa.hasta - now)}
              </span>
            )}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-(--color-muted)">
            {t(`aleph.rule.${carta.etapa.kind}`)}
          </p>
        </>
      )}
      {carta.contador && (
        <p className="mt-2 text-sm text-(--color-muted-3)">
          {t(carta.contador.clave, { k: carta.contador.k, n: carta.contador.n })}
        </p>
      )}
      {carta.cierre && (
        <>
          <p className="font-pixel text-sm text-(--color-muted-bright)">
            {t("aleph.scene.settledTitle")}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-(--color-muted)">
            {t(
              carta.cierre.clave,
              carta.cierre.quien ? { who: etiquetaDePorDireccion(carta.cierre.quien) } : undefined,
            )}
          </p>
        </>
      )}
    </div>
  );
}
