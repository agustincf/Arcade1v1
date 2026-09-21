// La criatura, en React. NO DIBUJA NADA PROPIO: mapea la lista de `nodosDe` a
// <rect> y nada más. Un píxel escrito acá adentro es un bug de revisión.
//
// El tamaño llega como CLASE, no como número: los anchos cambian en el corte de
// contenedor de la escena (PR2) y un número de JS no puede alternar dos valores
// en una media query. El viewBox de 16 es siempre el mismo.

import { nodosDe, rasgosDe, filasDeOro, OPACIDAD_DE_ESTADO, type Estado } from "./nucleo/criatura";

/** El bolsillo de este asiento y el máximo de la mesa. La fórmula vive en
 *  `filasDeOro`, para que nadie la pueda escribir distinto. */
export interface OroDeCriatura {
  bolsillo: number;
  maximo: number;
}

export function Criatura({
  address,
  estado = "base",
  traidor = false,
  oro,
  clase,
  etiquetaA11y,
  respira = false,
}: {
  address: string;
  estado?: Estado;
  traidor?: boolean;
  oro?: OroDeCriatura;
  /** `criatura--mesa` o `criatura--charla`. */
  clase: string;
  /** Ausente en la charla, que va `aria-hidden`: cada línea de la terminal ya
   *  empieza con la wallet escrita en texto, y anunciar una criatura por
   *  mensaje hace ilegible una sala liquidada de decenas de líneas. */
  etiquetaA11y?: string;
  /** Solo los vivos respiran. No se puede derivar del estado: `base` también es
   *  el reposo de un asiento terminado y de uno en el lobby. */
  respira?: boolean;
}) {
  const rasgos = rasgosDe(address);
  const filas = oro ? filasDeOro(oro.bolsillo, oro.maximo) : 0;
  const nodos = nodosDe(rasgos, { estado, traidor, filas });
  const opacidad = OPACIDAD_DE_ESTADO[estado];
  // El desfase sale del byte 11, el primero que no usa ningún rasgo, y va en
  // negativo para que la animación arranque ya corrida y ocho criaturas no
  // latan en bloque. Es azar DECORATIVO: el del juego sale de SHA-256 del
  // secreto (reglas v2) y no toca ni al servidor ni al contrato.
  const estilo = respira ? { animationDelay: `-${rasgos.desfase * 0.4}s` } : undefined;
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={`${clase}${respira ? " aleph-respira" : ""}`}
      style={estilo}
      opacity={opacidad}
      role={etiquetaA11y ? "img" : undefined}
      aria-label={etiquetaA11y}
      aria-hidden={etiquetaA11y ? undefined : true}
    >
      {nodos.map((n, i) => (
        <rect key={i} x={n.x} y={n.y} width={n.w} height={n.h} fill={n.fill} />
      ))}
    </svg>
  );
}
