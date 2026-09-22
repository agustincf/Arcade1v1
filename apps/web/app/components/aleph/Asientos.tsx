// LA GRILLA DE ASIENTOS, en sus dos formas. El mismo componente en los dos
// anchos y UN SOLO dibujo de criatura: lo que cambia de forma lo decide el
// corte de contenedor de 560 px, en `globals.css`.
//
// Dos cosas que ese corte no puede resolver solo y por eso están acá:
//   - las columnas viajan como custom properties (un elemento no puede
//     alternar dos valores de JS en una media query, y Tailwind v4 escanea
//     literales, así que `grid-cols-${n}` no genera nada);
//   - la etiqueta se monta en las DOS formas y el CSS esconde una, porque
//     `playerLabel` devuelve un string plano y no hay media query que parta un
//     string. Y NINGUNA de las dos lleva `aria-hidden`: cuál está escondida lo
//     decide el ancho del contenedor y un atributo del marcado no puede
//     seguirlo —a 375 px la escondida es la ancha—, así que un `aria-hidden`
//     fijo en la angosta dejaba muda justo a la tarjeta que se ve. El
//     `display: none` del corte ya saca del árbol de accesibilidad a la copia
//     escondida en cada ancho: exactamente una queda expuesta.

import type { CSSProperties } from "react";
import { Criatura } from "./Criatura";
import { Dorso, Olla } from "./Objetos";
import type {
  AsientoDeEscena,
  Destello,
  EtiquetaDeAsiento,
  ModeloDeEscena,
  Traductor,
} from "./nucleo/escena";
import { incluye } from "./nucleo/estados";

function Tarjeta({
  asiento,
  maximo,
  tamano,
  destello,
  t,
  etiquetaDe,
}: {
  asiento: AsientoDeEscena;
  maximo: number;
  /** `criatura--mesa` o `criatura--final`: nunca un número. */
  tamano: string;
  destello: Destello | null;
  t: Traductor;
  etiquetaDe: (seat: AsientoDeEscena["seat"]) => EtiquetaDeAsiento;
}) {
  const etiqueta = etiquetaDe(asiento.seat);
  const chip = t(asiento.chip);
  // La comparación sin caja es la de `nucleo/estados`: nadie escribe la suya.
  const grietaNueva = destello?.tipo === "grieta" && incluye(destello.asientos, asiento.address);
  return (
    <li className={`asiento${asiento.estado === "abandono" ? " asiento--abandono" : ""}`}>
      <Criatura
        address={asiento.address}
        estado={asiento.estado}
        traidor={asiento.traidor}
        oro={{ bolsillo: asiento.bolsillo, maximo }}
        clase={`${tamano} asiento-criatura shrink-0`}
        // El aria-label NO usa la etiqueta entera: el nombre, el avatar y el
        // chip CASA/WEBHOOK ya están en el HTML de al lado, y meterlos también
        // adentro del SVG los hace sonar dos veces.
        etiquetaA11y={t("aleph.a11y.criatura", { wallet: etiqueta.wallet, estado: chip })}
        respira={asiento.respira}
        grietaNueva={grietaNueva}
      />
      <div className="asiento-texto min-w-0 flex-1">
        {/* Sin `truncate`: la plana de un asiento de la casa (avatar, nombre,
            wallet y CASA) no entra en una celda de 4 columnas, y cortarla se
            llevaba la wallet, que no desaparece nunca. Se parte en renglones. */}
        <div className="etiqueta-ancha text-sm text-(--color-muted-bright)">{etiqueta.plana}</div>
        {/* Sin `aria-hidden`: el `display: none` del corte ya esconde una de
            las dos formas del árbol de accesibilidad, y cuál es depende del
            ancho, que el marcado no conoce. */}
        <div className="etiqueta-angosta">
          {etiqueta.perfil && (
            <div className="truncate text-sm text-(--color-muted-bright)">{etiqueta.perfil}</div>
          )}
          {/* La wallet abreviada NUNCA se trunca, en ningún ancho: es la regla
              anti-suplantación de wallet.tsx, no una preferencia de layout. */}
          <div className="font-mono text-px10 text-(--color-muted-3)">{etiqueta.wallet}</div>
        </div>
        <div className="asiento-chips mt-1 flex flex-wrap items-center gap-2">
          {/* CASA/WEBHOOK es chip de IDENTIDAD: no cuenta para el tope de dos,
              que es sobre los de estado. */}
          {etiqueta.tag && <span className="chip etiqueta-angosta">{etiqueta.tag}</span>}
          <span className="chip">{chip}</span>
          {asiento.traidor && <span className="chip chip--danger">{t("aleph.state.traidor")}</span>}
          {asiento.insignia !== null && (
            <span className="chip chip--money">+{asiento.insignia}</span>
          )}
        </div>
      </div>
      <span className="asiento-monto font-pixel shrink-0 text-sm text-(--color-gold)">
        {asiento.bolsillo}
      </span>
    </li>
  );
}

export function Asientos({
  modelo,
  destello,
  t,
  etiquetaDe,
}: {
  modelo: ModeloDeEscena;
  destello: Destello | null;
  t: Traductor;
  etiquetaDe: (seat: AsientoDeEscena["seat"]) => EtiquetaDeAsiento;
}) {
  // Las custom properties no entran en `CSSProperties` (csstype solo declara
  // las propiedades conocidas), así que el objeto se arma aparte y se afirma.
  const columnas = {
    "--cols-ancha": modelo.columnas.ancha,
    "--cols-angosta": modelo.columnas.angosta,
  } as CSSProperties;

  return (
    <>
      {/* La Final es el único momento en que la escena cambia de forma: los dos
          finalistas grandes y enfrentados, con la olla del pozo en el medio. */}
      {modelo.finalistas.length === 2 && (
        <ol className={`escena-final mt-4${destello?.tipo === "revela" ? " aleph-revela" : ""}`}>
          <Tarjeta
            asiento={modelo.finalistas[0]}
            maximo={modelo.maximo}
            tamano="criatura--final"
            destello={destello}
            t={t}
            etiquetaDe={etiquetaDe}
          />
          {/* El pozo, en el medio de los dos. Va en su propio <li> porque un
              <ol> solo puede tener <li> de hijo directo. */}
          <li className="escena-pozo" aria-hidden="true">
            <Olla clase="objeto" />
          </li>
          <Tarjeta
            asiento={modelo.finalistas[1]}
            maximo={modelo.maximo}
            tamano="criatura--final"
            destello={destello}
            t={t}
            etiquetaDe={etiquetaDe}
          />
        </ol>
      )}

      <ol className="escena-asientos mt-4" style={columnas}>
        {modelo.asientos.map((a) => (
          <Tarjeta
            key={a.address}
            asiento={a}
            maximo={modelo.maximo}
            tamano="criatura--mesa"
            destello={destello}
            t={t}
            etiquetaDe={etiquetaDe}
          />
        ))}
        {/* Sillas vacías: SOLO en el lobby. En `funding` la lista ya está
            congelada y una silla prometería un lugar que no se puede ocupar. */}
        {Array.from({ length: modelo.sillas }, (_, i) => (
          <li key={`silla${i}`} className="asiento asiento--vacia">
            {/* Texto oculto y no aria-label del <li>, como en el friso:
                varios lectores no leen el aria-label de un listitem, y el
                Dorso de adentro es aria-hidden. */}
            <span className="sr-only">{t("aleph.scene.emptySeat")}</span>
            <Dorso />
          </li>
        ))}
      </ol>
    </>
  );
}
