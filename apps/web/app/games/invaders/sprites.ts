// Sprites pixel-art de SPACE INVADERS, compartidos entre el juego y el visor
// de replays para que ambos se vean igual. Solo dibujo: nada de esto toca el
// motor ni el replay (el hitbox sigue siendo la caja ALIEN_W x ALIEN_H).

import { ALIEN_W, ALIEN_H, INVADERS_CONST } from "@arcade1v1/game-sdk/invaders";

const { PLAYER_W, PLAYER_H, SB, UFO_W, UFO_H } = INVADERS_CONST;

export const ROW_COLOR = ["#ff3df0", "#27e8ff", "#ffd23d", "#39ff7a"];

// Bitmaps 12x9 (pixel de 2 => 24x18). "X" = pixel del color de la fila.
// Tres especies con dos cuadros de animacion (patas/tentaculos alternan).
const SQUID: string[][] = [
  [
    ".....XX.....",
    "....XXXX....",
    "...XXXXXX...",
    "..XXXXXXXX..",
    "..XX.XX.XX..",
    "..XXXXXXXX..",
    "....X..X....",
    "...X.XX.X...",
    "..X.X..X.X..",
  ],
  [
    ".....XX.....",
    "....XXXX....",
    "...XXXXXX...",
    "..XXXXXXXX..",
    "..XX.XX.XX..",
    "..XXXXXXXX..",
    "...X.XX.X...",
    "..X......X..",
    "....X..X....",
  ],
];

const CRAB: string[][] = [
  [
    "..X......X..",
    "...X....X...",
    "..XXXXXXXX..",
    ".XX.XXXX.XX.",
    "XXXXXXXXXXXX",
    "X.XXXXXXXX.X",
    "X.X......X.X",
    "...XX..XX...",
    "............",
  ],
  [
    "..X......X..",
    "X..X....X..X",
    "X.XXXXXXXX.X",
    "XXX.XXXX.XXX",
    ".XXXXXXXXXX.",
    "..XXXXXXXX..",
    "...X....X...",
    "..X......X..",
    "............",
  ],
];

const OCTOPUS: string[][] = [
  [
    "...XXXXXX...",
    ".XXXXXXXXXX.",
    "XXXXXXXXXXXX",
    "XXX.XXXX.XXX",
    "XXXXXXXXXXXX",
    "...XX..XX...",
    "..XX.XX.XX..",
    ".XX......XX.",
    "............",
  ],
  [
    "...XXXXXX...",
    ".XXXXXXXXXX.",
    "XXXXXXXXXXXX",
    "XXX.XXXX.XXX",
    "XXXXXXXXXXXX",
    "....XXXX....",
    "...XX..XX...",
    "..X.X..X.X..",
    "............",
  ],
];

// Fila 0 (la que mas vale) = calamar; medias = cangrejo; base = pulpo.
const ROW_SPECIES: string[][][] = [SQUID, CRAB, CRAB, OCTOPUS];

const PX = 2; // tamaño de pixel del sprite (12x9 -> 24x18)

// Cache: cada (fila, cuadro) se pre-dibuja una vez en un canvas chiquito.
const spriteCache = new Map<string, HTMLCanvasElement>();

function bakedAlien(row: number, frame: number): HTMLCanvasElement {
  const key = `${row}:${frame}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = ALIEN_W;
  cv.height = ALIEN_H;
  const c = cv.getContext("2d")!;
  const rows = ROW_SPECIES[row % ROW_SPECIES.length][frame % 2];
  c.fillStyle = ROW_COLOR[row % ROW_COLOR.length];
  for (let r = 0; r < rows.length; r++)
    for (let col = 0; col < rows[r].length; col++)
      if (rows[r][col] === "X") c.fillRect(col * PX, r * PX, PX, PX);
  spriteCache.set(key, cv);
  return cv;
}

export function drawAlien(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  row: number,
  frame: number,
) {
  ctx.drawImage(bakedAlien(row, frame), Math.round(x), Math.round(y));
}

/** Nave del jugador: casco trapezoidal con cupula, cañon y glow. */
export function drawShip(ctx: CanvasRenderingContext2D, playerX: number, playerY: number) {
  const x = playerX - PLAYER_W / 2;
  ctx.save();
  ctx.shadowColor = "#39ff7a";
  ctx.shadowBlur = 10;
  // casco (trapecio)
  ctx.fillStyle = "#39ff7a";
  ctx.beginPath();
  ctx.moveTo(x, playerY + PLAYER_H);
  ctx.lineTo(x + 3, playerY + 3);
  ctx.lineTo(x + PLAYER_W - 3, playerY + 3);
  ctx.lineTo(x + PLAYER_W, playerY + PLAYER_H);
  ctx.closePath();
  ctx.fill();
  // cañon
  ctx.fillRect(playerX - 2, playerY - 5, 4, 8);
  ctx.shadowBlur = 0;
  // cupula mas clara + boca del cañon
  ctx.fillStyle = "#b8ffd6";
  ctx.fillRect(playerX - 4, playerY + 3, 8, 3);
  ctx.fillRect(playerX - 1, playerY - 5, 2, 2);
  // panza oscura
  ctx.fillStyle = "#127a3c";
  ctx.fillRect(x + 1, playerY + PLAYER_H - 3, PLAYER_W - 2, 3);
  ctx.restore();
}

/** OVNI bonus: platillo con cupula y luces que titilan. */
export function drawUfo(ctx: CanvasRenderingContext2D, x: number, y: number, tick: number) {
  ctx.save();
  ctx.shadowColor = "#ff3df0";
  ctx.shadowBlur = 12;
  // platillo
  ctx.fillStyle = "#ff3df0";
  ctx.beginPath();
  ctx.ellipse(x + UFO_W / 2, y + UFO_H - 3, UFO_W / 2, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // cupula
  ctx.fillStyle = "#ff9df7";
  ctx.beginPath();
  ctx.ellipse(x + UFO_W / 2, y + 3.5, 6, 3.5, 0, Math.PI, 0);
  ctx.fill();
  // luces (alternan con el tick)
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = (tick >> 3) % 4 === i ? "#ffffff" : "#ffd23d";
    ctx.fillRect(x + 3 + i * 5, y + UFO_H - 4, 2, 2);
  }
  ctx.restore();
}

/** Bloque de escudo con relieve pixelado. */
export function drawShieldBlock(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#2fd167";
  ctx.fillRect(x, y, SB, SB);
  ctx.fillStyle = "#7dffab";
  ctx.fillRect(x, y, SB, 1);
  ctx.fillRect(x, y, 1, SB);
  ctx.fillStyle = "#0f8f42";
  ctx.fillRect(x, y + SB - 1, SB, 1);
  ctx.fillRect(x + SB - 1, y, 1, SB);
}

/** Bala del jugador: trazo cian con punta blanca y glow. */
export function drawBullet(ctx: CanvasRenderingContext2D, x: number, y: number, h: number) {
  ctx.save();
  ctx.shadowColor = "#27e8ff";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#27e8ff";
  ctx.fillRect(x - 1, y, 2, h);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x - 1, y, 2, 3);
  ctx.restore();
}

/** Bomba alien: rayo zigzag animado. */
export function drawBomb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  wob: number,
) {
  ctx.save();
  ctx.shadowColor = "#ff4d6d";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#ff4d6d";
  const seg = h / 3;
  for (let i = 0; i < 3; i++) {
    const dx = (i + wob) % 2 === 0 ? -1 : 1;
    ctx.fillRect(x + dx - 1, y + i * seg, 3, seg + 1);
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffb3c1";
  ctx.fillRect(x - 1, y + h - 2, 3, 2);
  ctx.restore();
}
