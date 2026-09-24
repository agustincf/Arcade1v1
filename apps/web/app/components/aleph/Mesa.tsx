// LA MESA: pozo, caja y mazo como objetos, la barra del invariante y su línea.
// Reemplaza los tres bloques `Money` del encabezado — mismos datos, ahora
// dibujados, con las mismas claves de i18n.

import { Cofre, Mazo, Olla } from "./Objetos";
import type { MesaDeEscena, Traductor } from "./nucleo/escena";

/** De dónde arrancó el pozo sobre el total: `1 − ALEPH_RULES.BOX_BPS / 10000`
 *  con `BOX_BPS = 2000`. Va como constante local y NO se importa: el único
 *  subpath que exporta `ALEPH_RULES` es `@arcade1v1/game-sdk/aleph`, que
 *  arrastraría el motor entero de Aleph —`createAleph`, `replayAleph`,
 *  `viewFor`— al bundle de la web por un solo número. Y lo que NO sirve para
 *  ubicarla es `potInitial / total`: `potInitial` ES el total, así que ese
 *  cociente da 1,0 y la marca queda pegada al borde derecho. */
const ARRANQUE_DEL_POZO = 0.8;

export function Mesa({ mesa, t }: { mesa: MesaDeEscena; t: Traductor }) {
  const pct = (n: number) => (mesa.total > 0 ? (n / mesa.total) * 100 : 0);
  const parte = mesa.total > 0 ? mesa.caja / mesa.total : 0;
  return (
    <div className="mt-4">
      <div className="mesa">
        <div className="mesa-objeto">
          <Olla />
          <span>
            <span className="block text-sm text-(--color-muted-3)">{t("aleph.room.pot")}</span>
            <span className="font-pixel text-px16 text-(--color-gold)">{mesa.pozo}</span>
          </span>
        </div>
        <div className="mesa-objeto">
          <Cofre parte={parte} clase={mesa.liquidada ? "objeto objeto--apagado" : "objeto"} />
          <span>
            <span className="block text-sm text-(--color-muted-3)">{t("aleph.room.box")}</span>
            <span className="font-pixel text-px16 text-(--color-muted-bright)">{mesa.caja}</span>
          </span>
        </div>
        <div className="mesa-objeto">
          {/* Con la sala liquidada el mazo va apagado y SIN número: la Final
              entra sin sacar carta, así que `cardsLeft` quedó en lo que sobró y
              anunciar "{n} sin dar" de una sala terminada sería mentir. */}
          <Mazo apagado={mesa.liquidada || mesa.cartasSinDar === 0} />
          <span>
            <span className="block text-sm text-(--color-muted-3)">{t("aleph.scene.deck")}</span>
            {!mesa.liquidada && (
              <span className="rotulo text-(--color-muted-bright)">
                {t("aleph.scene.deckLeft", { n: mesa.cartasSinDar })}
              </span>
            )}
          </span>
        </div>
      </div>

      {mesa.liquidada ? (
        // El motor no vacía la caja al liquidar: `finish()` reparte `box / N`
        // dentro de `payouts` y deja `box` y los `pocket` intactos. Una barra
        // con esos mismos 1.800 adentro, arriba de una tabla de pagos donde ya
        // están repartidos, contaría la misma plata dos veces.
        <p className="mt-3 text-sm text-(--color-muted-3)">
          {t("aleph.scene.settledSplit", { each: mesa.reparto ?? 0 })}
        </p>
      ) : (
        <>
          <div className="barra mt-3" aria-hidden="true">
            <span className="barra-pozo" style={{ width: `${pct(mesa.pozo)}%` }} />
            <span className="barra-caja" style={{ width: `${pct(mesa.caja)}%` }} />
            <span className="barra-bolsillos" style={{ width: `${pct(mesa.bolsillos)}%` }} />
            {/* De dónde arrancó el pozo. */}
            <span className="barra-marca" style={{ left: `${ARRANQUE_DEL_POZO * 100}%` }} />
          </div>
          <p className="mt-2 text-sm text-(--color-muted-3)">
            {t("aleph.scene.invariant", {
              pot: mesa.pozo,
              box: mesa.caja,
              pockets: mesa.bolsillos,
              total: mesa.total,
            })}
          </p>
        </>
      )}
      <p className="mt-2 text-sm text-(--color-muted-3)">{t("aleph.scene.deckNote")}</p>
    </div>
  );
}
