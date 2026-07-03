"use client";

import { useEffect, useRef, useState } from "react";
import {
  FlappyEngine,
  FLAPPY_CONST,
  FLAPPY_DT,
  type ReplayFlappy,
} from "@arcade1v1/game-sdk/flappy";
import { StartScreen, GameOverScreen } from "@/app/games/_shared/ui";
import { sfx, ensureAudio } from "@/app/lib/sound";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";

const { WIDTH, HEIGHT, BIRD_X, BIRD_R, PIPE_W, GAP, GROUND_H } = FLAPPY_CONST;
const GROUND_Y = HEIGHT - GROUND_H;
const STEP = FLAPPY_DT * 1000; // ms por tick

export interface FlappyResult {
  score: number;
  replay: ReplayFlappy;
}

interface Cloud {
  x: number;
  y: number;
  s: number;
}

export function FlappyGame({
  seed,
  onFinish,
  onStarted,
}: {
  seed: number;
  onFinish: (result: FlappyResult) => void;
  onStarted?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<FlappyEngine | null>(null);
  if (engineRef.current === null) engineRef.current = new FlappyEngine(seed);

  const { t } = useT();
  const [started, setStarted] = useState(false);
  const [over, setOver] = useState(false);
  const [score, setScore] = useState(0);

  // Grabacion del replay (para el anti-trampa).
  const flaps = useRef<number[]>([]);
  const tickRef = useRef(0);
  const pendingFlap = useRef(false);

  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let groundX = 0;
    let cityX = 0;
    const clouds: Cloud[] = [
      { x: 60, y: 70, s: 1 },
      { x: 200, y: 130, s: 0.7 },
      { x: 300, y: 50, s: 0.85 },
    ];
    let flapAnim = 0;
    let lastScore = -1;

    function drawPipe(x: number, gapY: number) {
      const topH = gapY - GAP / 2;
      const botY = gapY + GAP / 2;
      const grad = ctx.createLinearGradient(x, 0, x + PIPE_W, 0);
      grad.addColorStop(0, "#39ff7a");
      grad.addColorStop(0.5, "#1fcf5c");
      grad.addColorStop(1, "#0b8c3a");
      ctx.fillStyle = grad;
      ctx.strokeStyle = "#063d1c";
      ctx.lineWidth = 3;
      // cuerpos
      ctx.fillRect(x, 0, PIPE_W, topH);
      ctx.strokeRect(x, 0, PIPE_W, topH);
      ctx.fillRect(x, botY, PIPE_W, GROUND_Y - botY);
      ctx.strokeRect(x, botY, PIPE_W, GROUND_Y - botY);
      // "labios"
      ctx.fillRect(x - 4, topH - 16, PIPE_W + 8, 16);
      ctx.strokeRect(x - 4, topH - 16, PIPE_W + 8, 16);
      ctx.fillRect(x - 4, botY, PIPE_W + 8, 16);
      ctx.strokeRect(x - 4, botY, PIPE_W + 8, 16);
    }

    function drawBird(y: number, vy: number) {
      ctx.save();
      ctx.translate(BIRD_X, y);
      const tilt = Math.max(-0.5, Math.min(1.1, vy / 600));
      ctx.rotate(tilt);
      // cuerpo
      ctx.fillStyle = "#ffd23d";
      ctx.beginPath();
      ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#a8780b";
      ctx.lineWidth = 2;
      ctx.stroke();
      // ala (aletea)
      ctx.fillStyle = "#ffae00";
      const wing = Math.sin(flapAnim) * 5;
      ctx.beginPath();
      ctx.ellipse(-3, 2 + wing, 7, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // ojo
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(5, -4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0a0518";
      ctx.beginPath();
      ctx.arc(6, -4, 2, 0, Math.PI * 2);
      ctx.fill();
      // pico
      ctx.fillStyle = "#ff7a00";
      ctx.beginPath();
      ctx.moveTo(BIRD_R - 2, -1);
      ctx.lineTo(BIRD_R + 7, 1);
      ctx.lineTo(BIRD_R - 2, 4);
      ctx.fill();
      ctx.restore();
    }

    const draw = () => {
      const eng = engineRef.current!;
      flapAnim += 0.3;

      // Cielo synthwave
      const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
      sky.addColorStop(0, "#2a1054");
      sky.addColorStop(0.5, "#7a1f8f");
      sky.addColorStop(1, "#ff5fa2");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, WIDTH, GROUND_Y);

      // Sol
      ctx.fillStyle = "rgba(255,210,61,0.9)";
      ctx.beginPath();
      ctx.arc(WIDTH / 2, GROUND_Y - 40, 46, 0, Math.PI * 2);
      ctx.fill();

      // Nubes (parallax)
      if (eng.started && !eng.over) {
        for (const c of clouds) {
          c.x -= 18 * c.s * (1 / 60);
          if (c.x < -40) c.x = WIDTH + 40;
        }
      }
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      for (const c of clouds) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 12 * c.s, 0, Math.PI * 2);
        ctx.arc(c.x + 12 * c.s, c.y + 3, 9 * c.s, 0, Math.PI * 2);
        ctx.arc(c.x - 12 * c.s, c.y + 3, 9 * c.s, 0, Math.PI * 2);
        ctx.fill();
      }

      // Skyline lejano (parallax, da profundidad)
      if (eng.started && !eng.over) cityX = (cityX + 0.4) % 48;
      ctx.fillStyle = "#3a1a5e";
      const baseY = GROUND_Y;
      const heights = [34, 52, 24, 44, 30, 60, 28, 40, 50, 22];
      for (let i = -1; i < 8; i++) {
        const bx = i * 48 - cityX;
        const h = heights[((i % heights.length) + heights.length) % heights.length];
        ctx.fillRect(bx, baseY - h, 30, h);
        // ventanitas
        ctx.fillStyle = "rgba(255,210,61,0.25)";
        for (let wy = baseY - h + 6; wy < baseY - 6; wy += 10) {
          ctx.fillRect(bx + 6, wy, 4, 4);
          ctx.fillRect(bx + 18, wy, 4, 4);
        }
        ctx.fillStyle = "#3a1a5e";
      }

      // Tubos
      for (const p of eng.pipes) drawPipe(p.x, p.gapY);

      // Suelo (rayado, se desplaza)
      if (eng.started && !eng.over) groundX = (groundX + eng.pipeSpeed() / 60) % 24;
      ctx.fillStyle = "#3a2a12";
      ctx.fillRect(0, GROUND_Y, WIDTH, GROUND_H);
      ctx.fillStyle = "#5a4220";
      for (let x = -24 + groundX; x < WIDTH; x += 24) {
        ctx.fillRect(x, GROUND_Y, 12, GROUND_H);
      }
      ctx.fillStyle = "#b6ff3d";
      ctx.fillRect(0, GROUND_Y, WIDTH, 3);

      // Pajaro
      drawBird(eng.birdY, eng.birdVy);

      // Puntaje
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#0a0518";
      ctx.lineWidth = 4;
      ctx.font = "bold 40px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.strokeText(String(eng.score), WIDTH / 2, 64);
      ctx.fillText(String(eng.score), WIDTH / 2, 64);

      if (!eng.started) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 15px ui-sans-serif, system-ui";
        ctx.fillText("▲ Tocá para aletear ▲", WIDTH / 2, HEIGHT / 2 + 70);
      }
    };

    const loop = (t: number) => {
      const dt = Math.min(t - last, 100);
      last = t;
      const eng = engineRef.current!;
      // Paso fijo determinístico: cada tick aplica el aleteo (si lo hubo) y avanza.
      acc += dt;
      while (acc >= STEP) {
        if (pendingFlap.current) {
          eng.flap();
          flaps.current.push(tickRef.current);
          pendingFlap.current = false;
        }
        eng.update(FLAPPY_DT);
        tickRef.current += 1;
        acc -= STEP;
        if (eng.over) break;
      }
      if (eng.score !== lastScore) {
        lastScore = eng.score;
        setScore(eng.score);
      }
      draw();
      if (eng.over) {
        setOver(true);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    draw();
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [started]);

  useEffect(() => {
    if (!started) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === " ") {
        e.preventDefault();
        if (!engineRef.current!.over) {
          pendingFlap.current = true; // se aplica en el proximo tick
          sfx.flap();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started]);

  function handleTap() {
    if (!engineRef.current!.over) {
      pendingFlap.current = true;
      sfx.flap();
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative overflow-hidden rounded-lg border-2 border-(--color-ink)"
        style={{ width: "min(86vw, 320px)" }}
        onPointerDown={started && !over ? handleTap : undefined}
      >
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="block h-auto w-full touch-none"
        />

        {!started && (
          <StartScreen
            icon={<GameIcon id="flappy" size={56} />}
            title={t("g.flappy.title")}
            instructions={t("g.flappy.instr")}
            onStart={() => {
              ensureAudio();
              onStarted?.();
              setStarted(true);
            }}
          />
        )}

        {over && (
          <GameOverScreen
            headline={t("g.flappy.over")}
            score={score}
            onConfirm={() =>
              onFinish({
                score,
                replay: { seed, ticks: tickRef.current, flaps: flaps.current },
              })
            }
          />
        )}
      </div>

      <p className="font-screen text-center text-base text-(--color-muted-3)">
        {t("g.flappy.hint")}
      </p>
    </div>
  );
}
