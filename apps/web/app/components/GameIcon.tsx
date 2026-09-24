// Íconos de los juegos: sprites pixel dibujados con la paleta de la marca.
// Antes eran vectores neón (#ff3df0, #39ff7a…) con un glow de drop-shadow: la
// paleta vieja del sitio, que chocaba con el ciruela, el coral y el marfil, y
// mezclaba pixel art (el invader) con vectores lisos (el pájaro, el auto).
// Ahora los siete comparten grilla, tamaño de píxel y colores: son la etiqueta
// del cartucho.
//
// Sin estado: se puede usar en componentes de servidor o cliente. Los colores
// salen de clases `.spr-*` (globals.css), que leen los tokens: el sprite
// cambia solo si cambia la marca.
//
// Van SIEMPRE sobre un fondo oscuro (la `.pantalla`, una tarjeta, la barra):
// sobre papel o sobre un botón coral los colores de marca dan 1,0 a 2,3:1.

import { fitBitmap, runs, type Bitmap } from "@/app/lib/pixel";

/** Letra del bitmap -> clase de color (globals.css). */
const FILL: Record<string, string> = {
  k: "spr-ink",
  c: "spr-coral",
  C: "spr-coral-deep",
  y: "spr-cyan",
  Y: "spr-cyan-deep",
  g: "spr-gold",
  G: "spr-gold-deep",
  l: "spr-lime",
  L: "spr-lime-deep",
  w: "spr-ivory",
  W: "spr-white",
  r: "spr-red",
  t: "spr-tire",
};

const SPRITES: Record<string, Bitmap> = {
  // El invader "pulpo" de 12x8 del original, en coral.
  invaders: [
    "......cccc......",
    "...cccccccccc...",
    "..cccccccccccc..",
    "..ccc..cc..ccc..",
    "..cccccccccccc..",
    ".....cc..cc.....",
    "....cc.cc.cc....",
    "..cc........cc..",
  ],
  flappy: [
    ".....gggggg.....",
    "...ggggggWWWW...",
    "..gggggggWWkkg..",
    "..gggggggWWkkg..",
    ".ggggggggWWWWgg.",
    ".GwwwGggggggcccc",
    ".GwwwGggggggCCC.",
    "..GGGggggggggg..",
    "..gggggggggggg..",
    "...GGGGGGGGGG...",
    ".....GGGGGG.....",
  ],
  // Las cuatro fichas del original ("2 0 / 4 8"), con dígitos de 3x5.
  "2048": [
    ".ggggg...ccccc.",
    "ggkkkgg.cckkkcc",
    "ggggkgg.cckckcc",
    "ggkkkgg.cckckcc",
    "ggkgggg.cckckcc",
    "ggkkkgg.cckkkcc",
    ".ggggg...ccccc.",
    "...............",
    ".yyyyy...lllll.",
    "yykykyy.llkkkll",
    "yykykyy.llklkll",
    "yykkkyy.llkkkll",
    "yyyykyy.llklkll",
    "yyyykyy.llkkkll",
    ".yyyyy...lllll.",
  ],
  // Snake v2 tiene moneda: va la moneda, no la fruta.
  snake: [
    ".lll.lll.lll....",
    "clkl.lll.lll....",
    ".lll.lll.lll....",
    "................",
    ".........lll....",
    ".........lll..g.",
    ".........lll.gWg",
    "..............g.",
    ".lll.lll.lll....",
    ".lll.lll.lll....",
    ".lll.lll.lll....",
  ],
  tetris: [
    ".....ggggGyyyyY",
    ".....gWggGyWyyY",
    ".....ggggGyyyyY",
    ".....ggggGyyyyY",
    ".....GGGGGYYYYY",
    "ccccCllllL.....",
    "cWccClWllL.....",
    "ccccCllllL.....",
    "ccccCllllL.....",
    "CCCCCLLLLL.....",
  ],
  racing: [
    "...yyyy...",
    "..yWyyyy..",
    "ttyyyyyytt",
    "ttykkkkytt",
    "ttykkkkytt",
    "..yyyyyy..",
    "..yyYYyy..",
    "..yyYYyy..",
    "..yyYYyy..",
    "ttyyYYyytt",
    "ttyyyyyytt",
    "ttykkkkytt",
    "..yyyyyy..",
    "..ryyyyr..",
  ],
  // Aleph no es un cartucho: es la mesa. Ocho asientos alrededor del pozo,
  // cuatro ocupados.
  aleph: [
    ".......yy.......",
    ".......yy.......",
    "..YY........yy..",
    "..YY........yy..",
    "......gggg......",
    ".....gWgggg.....",
    "....gWgggggg....",
    "YY..gggggggg..yy",
    "YY..gggggggg..yy",
    "....gggggggg....",
    ".....GggggG.....",
    "......GGGG......",
    "..YY........yy..",
    "..YY........yy..",
    ".......YY.......",
    ".......YY.......",
  ],
};

/** Todos los sprites se miden contra la misma grilla de 16: a un mismo `size`,
 *  el píxel mide lo mismo en los siete (floor(size / 16)). */
const GRID = 16;

export function GameIcon({ id, size = 48 }: { id: string; size?: number }) {
  const rows = SPRITES[id] ?? [];
  const { viewBox } = fitBitmap(rows, size, GRID);
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      shapeRendering="crispEdges"
      className="px-icon"
      aria-hidden="true"
    >
      {runs(rows).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} className={FILL[r.ch]} />
      ))}
    </svg>
  );
}
