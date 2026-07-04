// Logo de Arcade1v1: joystick pixel-art dibujado con los tokens de la marca.
// SVG puro sobre una grilla de 12x12 (sin assets externos): nítido en el
// header, el favicon y la imagen OG. Los colores replican la paleta del
// sitio — bola coral (marca), palo marfil, base gold con la misma sombra
// dura que usan los botones btn3d.

const COLORS = {
  coral: "#e8845e",
  coralDark: "#b05230",
  ivory: "#f0ece1",
  white: "#fffdf7",
  gold: "#f2c14e",
  goldShadow: "#a97f1e",
};

/** [x, y, w, h, fill] sobre la grilla 12x12. */
const PIXELS: [number, number, number, number, string][] = [
  // Bola (coral, redonda) con brillo arriba a la izquierda
  [4, 1, 4, 1, COLORS.coral],
  [3, 2, 6, 1, COLORS.coral],
  [4, 2, 1, 1, COLORS.white],
  [3, 3, 6, 1, COLORS.coral],
  [4, 4, 4, 1, COLORS.coral],
  // Palo (marfil)
  [5, 5, 2, 3, COLORS.ivory],
  // Base (gold, dos niveles + sombra dura como btn3d) con botón arcade
  [3, 8, 6, 1, COLORS.gold],
  [1, 9, 10, 1, COLORS.gold],
  [9, 9, 1, 1, COLORS.coralDark],
  [1, 10, 10, 1, COLORS.goldShadow],
];

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {PIXELS.map(([x, y, w, h, fill], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={fill} />
      ))}
    </svg>
  );
}
