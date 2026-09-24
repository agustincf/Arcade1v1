// LOS OBJETOS DE LA ESCENA: el pozo, la caja del demonio, el mazo, el dorso de
// ALEPH y los cinco glifos de etapa. Misma técnica que la criatura y que
// `Logo.tsx`: grilla de píxeles, un <rect> por píxel, `crispEdges` y cero bytes
// en `public/`.
//
// Todos van `aria-hidden="true"`: su información está en el texto de al lado.
// Y nada de texto adentro del SVG: todo rótulo va en HTML, por el i18n.

import type { EtapaKind } from "./nucleo/estados";

/** [x, y, w, h, fill] sobre la grilla del objeto. */
type Pixel = [number, number, number, number, string];

const C = {
  oro: "var(--color-gold)",
  oroSombra: "#a97f1e",
  tinta: "var(--color-ink)",
  borde: "var(--color-border)",
  superficie: "var(--color-surface-2)",
  coral: "var(--color-accent)",
  cyan: "var(--color-accent-2)",
};

function Dibujo({
  pixeles,
  ancho,
  alto,
  clase,
}: {
  pixeles: readonly Pixel[];
  ancho: number;
  alto: number;
  clase: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${ancho} ${alto}`}
      shapeRendering="crispEdges"
      className={clase}
      aria-hidden="true"
    >
      {pixeles.map(([x, y, w, h, fill], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={fill} />
      ))}
    </svg>
  );
}

/** El pozo: una olla dorada con asas. */
const OLLA: readonly Pixel[] = [
  [2, 5, 12, 2, C.oro], // boca
  [3, 7, 10, 5, C.oro], // cuerpo
  [4, 7, 8, 1, C.oroSombra], // sombra de adentro
  [1, 7, 2, 2, C.oroSombra], // asa izquierda
  [13, 7, 2, 2, C.oroSombra], // asa derecha
  [4, 12, 8, 1, C.tinta], // pie
];

export function Olla({ clase = "objeto" }: { clase?: string }) {
  return <Dibujo pixeles={OLLA} ancho={16} alto={16} clase={clase} />;
}

/** La caja del demonio: un cofre oscuro con lacre coral. La tapa tiene tres
 *  alturas según `box / total` (< 25 %, < 40 %, >= 40 %): es la única forma de
 *  que "engorde etapa a etapa" sin inventar un dato. */
const cofre = (tapa: number): Pixel[] => [
  [2, 7 - tapa * 2, 12, 2 + tapa * 2, C.borde],
  [2, 9, 12, 4, C.tinta],
  [7, 8, 2, 3, C.coral],
  [3, 13, 10, 1, C.borde],
];

export function Cofre({ parte, clase = "objeto" }: { parte: number; clase?: string }) {
  const tapa = parte < 0.25 ? 0 : parte < 0.4 ? 1 : 2;
  return <Dibujo pixeles={cofre(tapa)} ancho={16} alto={16} clase={clase} />;
}

/** El mazo: la carta de arriba con el pozo dorado del dorso, y dos abajo. */
const MAZO: readonly Pixel[] = [
  [2, 2, 12, 12, C.borde],
  [3, 3, 10, 10, C.superficie],
  [7, 7, 2, 2, C.oro],
  [3, 14, 10, 1, C.borde],
  [4, 15, 8, 1, C.borde],
];

export function Mazo({ apagado = false, clase = "objeto" }: { apagado?: boolean; clase?: string }) {
  return (
    <Dibujo
      pixeles={MAZO}
      ancho={16}
      alto={16}
      clase={apagado ? `${clase} objeto--apagado` : clase}
    />
  );
}

/** El dorso de ALEPH, de 8x6: el anillo de asientos y el pozo dorado al centro.
 *  Es el reverso único de todo lo que está dado vuelta — las cartas sin dar y
 *  las sillas que todavía no ocupó nadie. */
const DORSO: readonly Pixel[] = [
  [0, 0, 8, 1, C.borde],
  [0, 5, 8, 1, C.borde],
  [0, 1, 1, 4, C.borde],
  [7, 1, 1, 4, C.borde],
  [3, 2, 2, 2, C.oro],
];

export function Dorso({ clase = "dorso" }: { clase?: string }) {
  return <Dibujo pixeles={DORSO} ancho={8} alto={6} clase={clase} />;
}

/** Los cinco glifos de etapa, de 8x8 y nunca más de 4 rects: dos barras el
 *  Reparto, una moneda la Oferta, una ranura el Voto, un candado la Cerradura y
 *  dos flechas encontradas la Final. */
const GLIFOS: Readonly<Record<EtapaKind, readonly Pixel[]>> = {
  share: [
    [1, 2, 6, 1, C.cyan],
    [1, 5, 6, 1, C.cyan],
  ],
  offer: [
    [2, 1, 4, 1, C.oro],
    [1, 2, 6, 4, C.oro],
    [2, 6, 4, 1, C.oro],
  ],
  vote: [
    [1, 1, 6, 5, C.cyan],
    [2, 3, 4, 1, C.tinta],
  ],
  lock: [
    [2, 1, 4, 2, C.cyan],
    [1, 3, 6, 4, C.cyan],
    [3, 4, 2, 2, C.tinta],
  ],
  final: [
    [1, 3, 2, 2, C.coral],
    [3, 2, 1, 4, C.coral],
    [5, 2, 1, 4, C.coral],
    [6, 3, 2, 2, C.coral],
  ],
};

export function Glifo({ kind, clase = "glifo" }: { kind: EtapaKind; clase?: string }) {
  return <Dibujo pixeles={GLIFOS[kind]} ancho={8} alto={8} clase={clase} />;
}
