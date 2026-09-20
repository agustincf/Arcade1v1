// La terminal de la charla pública. Dibuja lo que le da `lineasDeCharla` y no
// decide nada por su cuenta.
//
// Nada de globos de papel: el sitio ya reserva el registro monoespaciado para
// los datos técnicos, y una terminal aguanta mejor que un globito el hecho de
// que el mensaje pueda llegar nueve segundos tarde (el sondeo es de 10 s).

import { Criatura } from "./Criatura";
import { lineasDeCharla } from "./nucleo/charla";
import type { SalaDeAleph } from "./nucleo/estados";

/** Lo que la página calcula comparando la vista nueva con la anterior. En PR1
 *  siempre llega `null`: el `useRef` con la vista anterior y las tres
 *  animaciones llegan en PR2. La prop existe desde el día uno para no tocar la
 *  firma dos veces. */
export type Destello = { tipo: "grieta" | "revela" | "desclasifica"; asientos?: string[] };

export function Charla({
  room,
  t,
  etiquetaDePorDireccion,
}: {
  room: SalaDeAleph;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** El `from` y el `to` son direcciones sueltas, no asientos. */
  etiquetaDePorDireccion: (address: string) => string;
  /** Pedida desde el día uno para no tocar la firma dos veces, y sin
   *  desestructurar porque PR1 no la consume: quien la consume es el fundido
   *  de la desclasificación, que llega en PR2 junto con su `@keyframes`. */
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
          <p className="charla-nota mt-3">{t("aleph.chat.empty")}</p>
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
                  className={`charla-linea${linea.susurro ? " charla-linea--susurro" : ""}`}
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
        {/* Las dos líneas del pie hablan del canal privado MIENTRAS está
            cerrado: la de sistema promete que no se publica "ni que existió"
            porque el navegador no sabe si hubo susurros, y esa premisa se cae
            en el mismo momento en que la sala liquida y los susurros aparecen
            dibujados arriba. Con la sala liquidada, `aleph.chat.declassified`
            ya dijo lo que pasó con el canal, dos renglones más arriba. */}
        {!modelo.desclasificada && (
          <>
            <p className="charla-sistema mt-4">{t("aleph.chat.private")}</p>
            <p className="charla-nota mt-1">{t("aleph.chat.onlyThisStage")}</p>
          </>
        )}
      </div>
    </section>
  );
}
