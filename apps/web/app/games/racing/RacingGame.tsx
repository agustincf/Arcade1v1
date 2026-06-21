"use client";

import { useEffect, useRef, useState } from "react";
import { RacingEngine, RACING_CONST, laneX } from "./engine";
import { StartScreen, GameOverScreen } from "@/app/games/_shared/ui";
import { sfx, ensureAudio } from "@/app/lib/sound";

const { WIDTH, HEIGHT, CAR_W, CAR_H, OBST_W, OBST_H } = RACING_CONST;

export interface RacingResult {
  score: number;
}

const OBST_COLORS = ["#ff4d6d", "#ffd23d", "#27e8ff"];

export function RacingGame({
  seed,
  onFinish,
}: {
  seed: number;
  onFinish: (result: RacingResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<RacingEngine | null>(null);
  if (engineRef.current === null) engineRef.current = new RacingEngine(seed);

  const [started, setStarted] = useState(false);
  const [over, setOver] = useState(false);
  const [score, setScore] = useState(0);

  // Dibujo de un autito.
  function drawCar(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    color: string,
    w: number,
    h: number,
  ) {
    const x = cx - w / 2;
    const y = cy - h / 2;
    ctx.fillStyle = color;
    ctx.fillRect(x + 4, y, w - 8, h); // carroceria
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x + 8, y + 10, w - 16, 14); // parabrisas
    ctx.fillRect(x + 8, y + h - 22, w - 16, 12); // luneta
    ctx.fillStyle = "#0a0518";
    ctx.fillRect(x, y + 8, 5, 14); // rueda
    ctx.fillRect(x + w - 5, y + 8, 5, 14);
    ctx.fillRect(x, y + h - 22, 5, 14);
    ctx.fillRect(x + w - 5, y + h - 22, 5, 14);
  }

  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();

    const draw = () => {
      const eng = engineRef.current!;

      // Asfalto (noche neon)
      const road = ctx.createLinearGradient(0, 0, 0, HEIGHT);
      road.addColorStop(0, "#1a0f33");
      road.addColorStop(1, "#2a1450");
      ctx.fillStyle = road;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      // Bordes neon
      ctx.fillStyle = "#ff3df0";
      ctx.fillRect(0, 0, 5, HEIGHT);
      ctx.fillRect(WIDTH - 5, 0, 5, HEIGHT);

      // Lineas de carril (animadas, neon cyan)
      ctx.fillStyle = "#27e8ff";
      for (let lane = 1; lane < 3; lane++) {
        const x = (WIDTH / 3) * lane - 2;
        for (let y = -40 + eng.roadOffset; y < HEIGHT; y += 40) {
          ctx.fillRect(x, y, 4, 22);
        }
      }

      // Obstaculos
      for (const o of eng.obstacles) {
        drawCar(ctx, laneX(o.lane), o.y, OBST_COLORS[o.kind], OBST_W, OBST_H);
      }

      // Auto del jugador
      drawCar(ctx, laneX(eng.carLane), eng.carY, "#39ff7a", CAR_W, CAR_H);

      // Puntaje
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#0a0518";
      ctx.lineWidth = 4;
      ctx.font = "bold 36px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.strokeText(String(eng.score), WIDTH / 2, 50);
      ctx.fillText(String(eng.score), WIDTH / 2, 50);
    };

    const loop = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      const eng = engineRef.current!;
      eng.update(dt);
      setScore(eng.score);
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

  // Teclado.
  useEffect(() => {
    if (!started) return;
    function onKey(e: KeyboardEvent) {
      const eng = engineRef.current!;
      if (eng.over) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        eng.moveLeft();
        sfx.move();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        eng.moveRight();
        sfx.move();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative overflow-hidden rounded-lg border-2 border-[#0a0518]"
        style={{ width: "min(86vw, 320px)" }}
      >
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="block h-auto w-full"
        />

        {!started && (
          <StartScreen
            emoji="🏎️"
            title="CARRERA"
            instructions="Cambiá de carril para esquivar los autos. +1 por cada uno que dejás atrás. ¡Y acelera!"
            onStart={() => {
              ensureAudio();
              setStarted(true);
            }}
          />
        )}

        {over && (
          <GameOverScreen
            headline="¡CHOCASTE! 💥"
            score={score}
            onConfirm={() => onFinish({ score })}
          />
        )}
      </div>

      {/* Controles tactiles */}
      {started && !over && (
        <div className="grid w-full max-w-[320px] grid-cols-2 gap-3">
          <button
            onClick={() => {
              engineRef.current!.moveLeft();
              sfx.move();
            }}
            className="btn3d btn3d--cyan !text-2xl"
          >
            ◀
          </button>
          <button
            onClick={() => {
              engineRef.current!.moveRight();
              sfx.move();
            }}
            className="btn3d btn3d--cyan !text-2xl"
          >
            ▶
          </button>
        </div>
      )}

      <p className="font-screen text-center text-base text-slate-500">
        Flechas ← → (o los botones) para cambiar de carril.
      </p>
    </div>
  );
}
