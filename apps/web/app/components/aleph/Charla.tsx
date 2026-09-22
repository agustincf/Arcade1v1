// La terminal de la charla pública. Dibuja lo que le da `lineasDeCharla` y no
// decide nada por su cuenta.
//
// Nada de globos de papel: el sitio ya reserva el registro monoespaciado para
// los datos técnicos, y una terminal aguanta mejor que un globito el hecho de
// que el mensaje pueda llegar nueve segundos tarde (el sondeo es de 10 s).

import { Criatura } from "./Criatura";
import { lineasDeCharla } from "./nucleo/charla";
import type { Destello } from "./nucleo/escena";
import type { SalaDeAleph } from "./nucleo/estados";

export function Charla({
  room,
  t,
  etiquetaDePorDireccion,
  destello,
}: {
  room: SalaDeAleph;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** El `from` y el `to` son direcciones sueltas, no asientos. */
  etiquetaDePorDireccion: (address: string) => string;
  /** El destello que la página calculó comparando la vista nueva con la
   *  anterior. La terminal mira uno solo: `desclasifica`, que es el fundido con
   *  el que entran las líneas de susurro cuando la sala liquida. Los otros dos
   *  son de la escena y acá se ignoran sin ruido. */
  destello: Destello | null;
}) {
  const modelo = lineasDeCharla(room);
  if (!modelo) return null;

  return (
    <section className="win mt-6">
      <div className="win-title win-title--cyan">
        <span>{t("aleph.chat.title")}</span>
      </div>
      <div className="charla p-4 font-mono">
        {/* Por qué hay tan pocas líneas. Va acá y no como chip en la barra: la
            barra no envuelve y .win recorta, así que a 375 px una frase de 70
            caracteres se perdería entera. */}
        <p className="charla-nota">{t("aleph.chat.caps")}</p>
        {modelo.desclasificada && <p className="charla-aviso">{t("aleph.chat.declassified")}</p>}
        {modelo.lineas.length === 0 ? (
          // Con la sala liquidada NO se dice "todavía no habló nadie en esta
          // etapa": no hay etapa en curso que nombrar, y el cartel de
          // desclasificación de arriba ya dice que acá está todo lo que se
          // dijo. Es la misma razón por la que la ventana no se monta en
          // `lobby`, `funding` ni `dissolved`.
          !modelo.desclasificada && <p className="charla-nota mt-3">{t("aleph.chat.empty")}</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-1">
            {modelo.lineas.map((linea, i) =>
              linea.tipo === "etapa" ? (
                <li key={i} className="charla-etapa">
                  {/* El `.replace` solo dispara cuando la etapa no tiene
                      resultado y `kind` queda vacío: sin él, el separador
                      termina en un "·" colgando. Las cuatro traducciones de
                      `aleph.chat.stageSep` terminan en `{kind}` y usan el mismo
                      "·", así que con `kind` lleno no hay nada que recortar. */}
                  {t("aleph.chat.stageSep", {
                    n: linea.n,
                    kind: linea.kind ? t(`aleph.stage.${linea.kind}`) : "",
                  }).replace(/\s*·\s*$/, "")}
                </li>
              ) : (
                <li
                  key={i}
                  className={`charla-linea${linea.susurro ? " charla-linea--susurro" : ""}${
                    linea.susurro && destello?.tipo === "desclasifica" ? " aleph-desclasifica" : ""
                  }`}
                >
                  {/* Siempre en estado base, sin marca de traidor y sin oro: el
                      renglón cuenta lo que ese asiento dijo en ese momento, no
                      en qué terminó. Y va `aria-hidden` (sin etiqueta), porque
                      la línea ya empieza con la wallet escrita en texto. */}
                  <Criatura address={linea.from} clase="criatura--charla shrink-0" />
                  <span className="charla-quien">{etiquetaDePorDireccion(linea.from)}</span>
                  {/* `.chip` a secas, NO `chip--danger`: el spec reserva las
                      dos únicas excepciones de color para la insignia `+{n}`
                      (gold) y el chip del traidor (danger), y `chip--danger` es
                      `--color-lose`, rojo, no coral. Lo que marca al susurro es
                      el borde izquierdo coral y el "a {who}". */}
                  {linea.susurro && (
                    <span className="chip shrink-0">{t("aleph.chat.whisper")}</span>
                  )}
                  {linea.susurro && linea.to && (
                    <span className="charla-a">
                      {t("aleph.chat.whisperTo", { who: etiquetaDePorDireccion(linea.to) })}
                    </span>
                  )}
                  <span className="charla-prompt">&gt;</span>
                  <span className="charla-texto">{linea.texto}</span>
                </li>
              ),
            )}
          </ol>
        )}
        {/* La línea de sistema va FIJA, siempre, haya habido susurros o no: es
            lo único honesto, el navegador no sabe si hubo. Y con la sala
            liquidada sigue siendo la que nombra el canal privado al pie, para
            que el pie nunca quede vacío. La de `onlyThisStage`, en cambio, solo
            vale mientras la sala juega: al liquidar se abre el historial
            entero. */}
        <p className="charla-sistema mt-4">{t("aleph.chat.private")}</p>
        {!modelo.desclasificada && (
          <p className="charla-nota mt-1">{t("aleph.chat.onlyThisStage")}</p>
        )}
      </div>
    </section>
  );
}
