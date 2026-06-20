"use client";

import { useEffect, useRef, useState } from "react";
import { RacingEngine, RACING_CONST, laneX } from "./engine";

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

      // Asfalto
      ctx.fillStyle = "#1b1b24";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      // Bordes (pasto)
      ctx.fillStyle = "#143d1f";
      ctx.fillRect(0, 0, 8, HEIGHT);
      ctx.fillRect(WIDTH - 8, 0, 8, HEIGHT);

      // Lineas de carril (animadas)
      ctx.fillStyle = "#5a5a6e";
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
      ctx.font = "bold 30px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.fillText(String(eng.score), WIDTH / 2, 44);
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
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        eng.moveRight();
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
          <Overlay>
            <h3 className="font-pixel text-sm text-[--color-win]">CARRERA</h3>
            <p className="font-screen mt-2 max-w-[220px] text-center text-lg text-slate-200">
              Esquivá los autos cambiando de carril. +1 por cada uno que esquivás.
              ¡Acelera con el tiempo!
            </p>
            <button onClick={() => setStarted(true)} className="btn3d btn3d--magenta mt-4">
              EMPEZAR ▶
            </button>
          </Overlay>
        )}

        {over && (
          <Overlay>
            <h3 className="font-pixel text-base">CHOCASTE 💥</h3>
            <p className="font-screen mt-2 text-lg text-slate-200">Tu puntaje</p>
            <p className="font-pixel text-2xl text-[--color-accent-2]">{score}</p>
            <button onClick={() => onFinish({ score })} className="btn3d btn3d--magenta mt-4">
              CONFIRMAR ▶
            </button>
          </Overlay>
        )}
      </div>

      {/* Controles tactiles */}
      {started && !over && (
        <div className="grid w-full max-w-[320px] grid-cols-2 gap-3">
          <button
            onClick={() => engineRef.current!.moveLeft()}
            className="btn3d btn3d--cyan !text-2xl"
          >
            ◀
          </button>
          <button
            onClick={() => engineRef.current!.moveRight()}
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

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-4">
      {children}
    </div>
  );
}
