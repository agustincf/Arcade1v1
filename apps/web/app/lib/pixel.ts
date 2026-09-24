// Bitmaps de pixel art: la base de GameIcon (sprites de juego) y PixelIcon
// (íconos de interfaz). Un sprite es una lista de filas; cada carácter es un
// píxel y "." es vacío. Así el dibujo se lee en el código tal como se ve.

export type Bitmap = readonly string[];

export type Run = { x: number; y: number; w: number; ch: string };

/** Fusiona los píxeles contiguos del mismo color de cada fila en una corrida:
 *  un <rect> por corrida en vez de uno por píxel (un sprite de 16x16 pasa de
 *  ~150 nodos a ~40, y el SVG que viaja en el HTML es mucho más chico). */
export function runs(rows: Bitmap): Run[] {
  const out: Run[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === ".") {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w++;
      out.push({ x, y, w, ch });
      x += w;
    }
  });
  return out;
}

export function bitmapSize(rows: Bitmap): { w: number; h: number } {
  return { w: Math.max(0, ...rows.map((r) => r.length)), h: rows.length };
}

/** Cuánto mide cada píxel del sprite para caber en `size` px de CSS, SIEMPRE
 *  entero, y el corrimiento (también entero) que lo centra en la caja. Con una
 *  escala de 3,5 unos píxeles medirían 3 y otros 4: el pixel art se deforma.
 *  `grid` es la grilla de referencia: todos los sprites que la comparten tienen
 *  el mismo tamaño de píxel a un mismo `size`, aunque su bitmap sea más chico. */
export function fitBitmap(rows: Bitmap, size: number, grid: number) {
  const { w, h } = bitmapSize(rows);
  const scale = Math.max(1, Math.floor(size / grid));
  const offX = Math.floor((size - w * scale) / 2);
  const offY = Math.floor((size - h * scale) / 2);
  // viewBox en unidades de sprite: 1 unidad = `scale` px, y el origen corrido
  // `off/scale` unidades para que el sprite quede centrado sobre px enteros.
  const vb = size / scale;
  return { viewBox: `${-offX / scale} ${-offY / scale} ${vb} ${vb}`, scale };
}
