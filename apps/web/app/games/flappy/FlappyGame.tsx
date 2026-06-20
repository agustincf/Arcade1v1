"use client";

import { useEffect, useRef, useState } from "react";
import { FlappyEngine, FLAPPY_CONST } from "./engine";

const { WIDTH, HEIGHT, BIRD_X, BIRD_R, PIPE_W, GAP } = FLAPPY_CONST;

export interface FlappyResult {
  score: number;
}

export function FlappyGame({
  seed,
  onFinish,
}: {
  seed: number;
  onFinish: (result: FlappyResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<FlappyEngine | null>(null);
  if (engineRef.current === null) engineRef.current = new FlappyEngine(seed);

  const [started, setStarted] = useState(false);
  const [over, setOver] = useState(false);
  const [score, setScore] = useState(0);

  // Reloj + dibujo del juego.
  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();

    const draw = () => {
      const eng = engineRef.current!;

      // Fondo
      ctx.fillStyle = "#0d1320";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // Tubos
      ctx.fillStyle = "#22c55e";
      for (const p of eng.pipes) {
        const topH = p.gapY - GAP / 2;
        const bottomY = p.gapY + GAP / 2;
        ctx.fillRect(p.x, 0, PIPE_W, topH);
        ctx.fillRect(p.x, bottomY, PIPE_W, HEIGHT - bottomY);
      }

      // Pajaro
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.arc(BIRD_X, eng.birdY, BIRD_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0d1320";
      ctx.beginPath();
      ctx.arc(BIRD_X + 4, eng.birdY - 3, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Puntaje
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 36px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.fillText(String(eng.score), WIDTH / 2, 60);

      if (!eng.started) {
        ctx.font = "bold 16px ui-sans-serif, system-ui";
        ctx.fillStyle = "#cbd5e1";
        ctx.fillText("Toca para aletear", WIDTH / 2, HEIGHT / 2 + 60);
      }
    };

    const loop = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05); // segundos (cap por si se traba)
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

  // Controles: tocar/click o espacio = aletear.
  useEffect(() => {
    if (!started) return;
    function flap() {
      const eng = engineRef.current!;
      if (!eng.over) eng.flap();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === " ") {
        e.preventDefault();
        flap();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started]);

  function handleTap() {
    const eng = engineRef.current!;
    if (!eng.over) eng.flap();
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative overflow-hidden rounded-lg border border-[--color-border]"
        style={{ width: "min(86vw, 320px)" }}
        onPointerDown={started && !over ? handleTap : undefined}
      >
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="block h-auto w-full touch-none"
        />

        {/* Overlay: antes de empezar */}
        {!started && (
          <Overlay>
            <h3 className="text-lg font-bold">Tu intento de Flappy</h3>
            <p className="mt-2 max-w-[220px] text-center text-sm text-slate-300">
              Toca (o barra espaciadora) para aletear y esquiva los tubos. Cada
              tubo = 1 punto.
            </p>
            <button
              onClick={() => setStarted(true)}
              className="mt-4 rounded-xl bg-[--color-accent] px-6 py-3 font-semibold text-white hover:opacity-90"
            >
              Empezar ▶
            </button>
          </Overlay>
        )}

        {/* Overlay: game over */}
        {over && (
          <Overlay>
            <h3 className="text-xl font-extrabold">Game Over</h3>
            <p className="mt-2 text-sm text-slate-300">Tu puntaje</p>
            <p className="text-3xl font-black text-[--color-accent-2]">{score}</p>
            <button
              onClick={() => onFinish({ score })}
              className="mt-4 rounded-xl bg-[--color-accent] px-6 py-3 font-semibold text-white hover:opacity-90"
            >
              Confirmar puntaje →
            </button>
          </Overlay>
        )}
      </div>

      <p className="text-center text-xs text-slate-500">
        Toca la pantalla o usa la barra espaciadora para aletear.
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
