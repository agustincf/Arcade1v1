// Renderers de ESPECTADOR: dibujan el estado de cada motor en un canvas.
// Son versiones compactas de la estética de cada juego (mismos colores) que
// leen SOLO estado público del motor — sirven para reproducir cualquier
// replay: el del rival, el sandbox del builder y el modo espectador.

import { SnakeEngine, GRID } from "@arcade1v1/game-sdk/snake";
import { FlappyEngine, FLAPPY_CONST } from "@arcade1v1/game-sdk/flappy";
import { RacingEngine, RACING_CONST, laneX } from "@arcade1v1/game-sdk/racing";
import { InvadersEngine, INVADERS_CONST, ALIEN_W, ALIEN_H } from "@arcade1v1/game-sdk/invaders";
import {
  TetrisEngine,
  PIECE_COLORS,
  COLS as TCOLS,
  ROWS as TROWS,
} from "@arcade1v1/game-sdk/tetris";
import { Game2048, SIZE as G2048_SIZE } from "@arcade1v1/game-sdk/g2048";

export function snakeCanvasSize() {
  return { w: GRID * 20, h: GRID * 20 };
}

export function drawSnake(ctx: CanvasRenderingContext2D, eng: SnakeEngine) {
  const CELL = 20;
  const SIZE = GRID * CELL;
  ctx.fillStyle = "#140a2e";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = "rgba(75,59,128,0.18)";
  ctx.lineWidth = 1;
  for (let i = 1; i < GRID; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL, 0);
    ctx.lineTo(i * CELL, SIZE);
    ctx.moveTo(0, i * CELL);
    ctx.lineTo(SIZE, i * CELL);
    ctx.stroke();
  }
  ctx.fillStyle = "#ff3df0";
  ctx.fillRect(eng.food.x * CELL + 3, eng.food.y * CELL + 3, CELL - 6, CELL - 6);
  if (eng.coin && (!eng.coinBlinking() || eng.coinSteps % 2 === 0)) {
    ctx.fillStyle = "#ffd23d";
    ctx.beginPath();
    ctx.arc(eng.coin.x * CELL + CELL / 2, eng.coin.y * CELL + CELL / 2, CELL / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
  }
  eng.body.forEach((s, i) => {
    ctx.fillStyle = i === 0 ? "#b6ff3d" : "#39ff7a";
    ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
  });
}

export function flappyCanvasSize() {
  return { w: FLAPPY_CONST.WIDTH, h: FLAPPY_CONST.HEIGHT };
}

export function drawFlappy(ctx: CanvasRenderingContext2D, eng: FlappyEngine) {
  const { WIDTH, HEIGHT, BIRD_X, BIRD_R, PIPE_W, GROUND_H } = FLAPPY_CONST;
  const GAP = 158; // mismo hueco que el motor
  const GROUND_Y = HEIGHT - GROUND_H;
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, "#2a1054");
  sky.addColorStop(0.5, "#7a1f8f");
  sky.addColorStop(1, "#ff5fa2");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, GROUND_Y);
  ctx.fillStyle = "rgba(255,210,61,0.9)";
  ctx.beginPath();
  ctx.arc(WIDTH / 2, GROUND_Y - 40, 46, 0, Math.PI * 2);
  ctx.fill();
  // tubos
  for (const p of eng.pipes) {
    const topH = p.gapY - GAP / 2;
    const botY = p.gapY + GAP / 2;
    ctx.fillStyle = "#1fcf5c";
    ctx.strokeStyle = "#063d1c";
    ctx.lineWidth = 3;
    ctx.fillRect(p.x, 0, PIPE_W, topH);
    ctx.strokeRect(p.x, 0, PIPE_W, topH);
    ctx.fillRect(p.x, botY, PIPE_W, GROUND_Y - botY);
    ctx.strokeRect(p.x, botY, PIPE_W, GROUND_Y - botY);
  }
  // suelo
  ctx.fillStyle = "#3a2a12";
  ctx.fillRect(0, GROUND_Y, WIDTH, GROUND_H);
  ctx.fillStyle = "#b6ff3d";
  ctx.fillRect(0, GROUND_Y, WIDTH, 3);
  // pájaro (a los 20 puntos, el easter egg: se convierte en autito celeste)
  ctx.save();
  ctx.translate(BIRD_X, eng.birdY);
  ctx.rotate(Math.max(-0.5, Math.min(1.1, eng.birdVy / 600)));
  if (eng.score >= 20) {
    ctx.fillStyle = "#161018";
    for (const wx of [-9, 8]) {
      ctx.beginPath();
      ctx.arc(wx, 10, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#4fc6f7";
    ctx.strokeStyle = "#0b4a6b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 3, 15, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-1, -5, 10, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#eaffff";
    ctx.beginPath();
    ctx.ellipse(1, -5, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(-2, -6, 2.6, 0, Math.PI * 2);
    ctx.arc(4, -6, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0a0518";
    ctx.beginPath();
    ctx.arc(-1.3, -6, 1.3, 0, Math.PI * 2);
    ctx.arc(4.7, -6, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff6c9";
    ctx.strokeStyle = "#0b4a6b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(13, 2, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = "#ffd23d";
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#a8780b";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ff7a00";
    ctx.beginPath();
    ctx.moveTo(BIRD_R - 2, -1);
    ctx.lineTo(BIRD_R + 7, 1);
    ctx.lineTo(BIRD_R - 2, 4);
    ctx.fill();
  }
  ctx.restore();
}

export function racingCanvasSize() {
  return { w: RACING_CONST.WIDTH, h: RACING_CONST.HEIGHT };
}

const OBST_COLORS = ["#ff4d6d", "#ffd23d", "#27e8ff"];

export function drawRacing(ctx: CanvasRenderingContext2D, eng: RacingEngine) {
  const { WIDTH, HEIGHT, LANES, CAR_W, CAR_H, OBST_W, OBST_H } = RACING_CONST;
  // Vista cenital simple (el juego real es pseudo-3D; para mirar alcanza).
  ctx.fillStyle = "#1a0f3a";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#0a0510";
  ctx.fillRect(10, 0, WIDTH - 20, HEIGHT);
  // líneas de carril (desplazadas con roadOffset para sensación de velocidad)
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 22]);
  ctx.lineDashOffset = -eng.roadOffset * 2;
  for (let l = 1; l < LANES; l++) {
    const x = (WIDTH / LANES) * l;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // obstáculos: sólidos llenos; vallas = barra chata rayada
  for (const o of eng.obstacles) {
    if (o.jumpable) {
      const w = OBST_W;
      const h = OBST_H * 0.35;
      const bx = laneX(o.lane) - w / 2;
      ctx.fillStyle = "#0a0510";
      ctx.fillRect(bx, o.y - h / 2, w, h);
      ctx.fillStyle = "#ffd23d";
      const stripe = w / 5;
      for (let i = 0; i < 5; i += 2) ctx.fillRect(bx + i * stripe, o.y - h / 2, stripe, h);
    } else {
      ctx.fillStyle = OBST_COLORS[o.kind % OBST_COLORS.length];
      ctx.fillRect(laneX(o.lane) - OBST_W / 2, o.y - OBST_H / 2, OBST_W, OBST_H);
    }
  }
  // monedas
  ctx.fillStyle = "#ffd23d";
  for (const c of eng.coins) {
    if (c.taken) continue;
    ctx.beginPath();
    ctx.arc(laneX(c.lane), c.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  // auto (se agranda al saltar)
  const jumpArc = Math.sin(Math.PI * eng.jumpProgress());
  const cw = CAR_W * (1 + 0.3 * jumpArc);
  const ch = CAR_H * (1 + 0.3 * jumpArc);
  ctx.fillStyle = "#39ff7a";
  ctx.fillRect(laneX(eng.carLane) - cw / 2, eng.carY - ch / 2, cw, ch);
  ctx.fillStyle = "#0a0518";
  ctx.fillRect(laneX(eng.carLane) - cw / 2 + 6, eng.carY - ch / 2 + 10, cw - 12, 16);
}

export function invadersCanvasSize() {
  return { w: INVADERS_CONST.WIDTH, h: INVADERS_CONST.HEIGHT };
}

const ROW_COLOR = ["#ff3df0", "#27e8ff", "#ffd23d", "#39ff7a"];

export function drawInvaders(ctx: CanvasRenderingContext2D, eng: InvadersEngine) {
  const { WIDTH, HEIGHT, PLAYER_W, PLAYER_H, PLAYER_Y, SB, UFO_W, UFO_H, UFO_Y } = INVADERS_CONST;
  ctx.fillStyle = "#0a0518";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  // ovni
  if (eng.ufo) {
    ctx.fillStyle = "#ff3df0";
    ctx.fillRect(eng.ufo.x, UFO_Y, UFO_W, UFO_H);
  }
  // aliens
  for (const a of eng.aliveAliens()) {
    ctx.fillStyle = ROW_COLOR[a.row % ROW_COLOR.length];
    ctx.fillRect(a.x, a.y, ALIEN_W, ALIEN_H);
    ctx.fillStyle = "#0a0518";
    ctx.fillRect(a.x + 5, a.y + 5, 4, 4);
    ctx.fillRect(a.x + ALIEN_W - 9, a.y + 5, 4, 4);
  }
  // escudos
  ctx.fillStyle = "#39ff7a";
  for (const s of eng.shields) ctx.fillRect(s.x, s.y, SB, SB);
  // balas y bombas
  ctx.fillStyle = "#27e8ff";
  for (const b of eng.bullets) ctx.fillRect(b.x - 1, b.y - 10, 3, 10);
  ctx.fillStyle = "#ff4d6d";
  for (const b of eng.bombs) ctx.fillRect(b.x - 1, b.y, 3, 10);
  // jugador
  ctx.fillStyle = "#39ff7a";
  ctx.fillRect(eng.playerX - PLAYER_W / 2, PLAYER_Y - PLAYER_H, PLAYER_W, PLAYER_H);
  ctx.fillRect(eng.playerX - 2, PLAYER_Y - PLAYER_H - 6, 4, 6);
  // vidas
  ctx.fillStyle = "#ffd23d";
  ctx.font = "bold 12px ui-sans-serif, system-ui";
  ctx.textAlign = "left";
  ctx.fillText("♥".repeat(Math.max(0, eng.lives)), 8, HEIGHT - 8);
}

export function tetrisCanvasSize() {
  return { w: TCOLS * 18, h: TROWS * 18 };
}

export function drawTetris(ctx: CanvasRenderingContext2D, eng: TetrisEngine) {
  const CELL = 18;
  ctx.fillStyle = "#140a2e";
  ctx.fillRect(0, 0, TCOLS * CELL, TROWS * CELL);
  const board = eng.render();
  for (let r = 0; r < TROWS; r++) {
    for (let c = 0; c < TCOLS; c++) {
      const v = board[r][c];
      if (v === 0) {
        ctx.fillStyle = "rgba(75,59,128,0.12)";
        ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
      } else {
        ctx.fillStyle = PIECE_COLORS[(v - 1) % PIECE_COLORS.length];
        ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
      }
    }
  }
}

export function g2048CanvasSize() {
  return { w: 320, h: 320 };
}

const TILE_COLORS: Record<number, string> = {
  2: "#3b3566",
  4: "#574a8f",
  8: "#27e8ff",
  16: "#39ff7a",
  32: "#ffd23d",
  64: "#ff9f1c",
  128: "#ff4d6d",
  256: "#c06bff",
  512: "#ff3df0",
  1024: "#27e8ff",
  2048: "#ffd23d",
};

export function draw2048(ctx: CanvasRenderingContext2D, eng: Game2048) {
  const W = 320;
  const CELL = W / G2048_SIZE;
  ctx.fillStyle = "#140a2e";
  ctx.fillRect(0, 0, W, W);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let r = 0; r < G2048_SIZE; r++) {
    for (let c = 0; c < G2048_SIZE; c++) {
      const v = eng.board[r][c];
      const x = c * CELL;
      const y = r * CELL;
      ctx.fillStyle = v === 0 ? "rgba(75,59,128,0.18)" : (TILE_COLORS[v] ?? "#ffd23d");
      ctx.fillRect(x + 4, y + 4, CELL - 8, CELL - 8);
      if (v !== 0) {
        ctx.fillStyle = v <= 4 ? "#e8e3ff" : "#140a2e";
        ctx.font = `bold ${v >= 1024 ? 20 : 26}px ui-sans-serif, system-ui`;
        ctx.fillText(String(v), x + CELL / 2, y + CELL / 2);
      }
    }
  }
}
