"use client";

import { useEffect, useRef, useState } from "react";
import {
  SnakeEngine,
  GRID,
  SNAKE_DT,
  type SnakeAction,
  type ReplaySnake,
} from "@arcade1v1/game-sdk/snake";
import { StartScreen, GameOverScreen } from "@/app/games/_shared/ui";
import { sfx, ensureAudio } from "@/app/lib/sound";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";

const CELL = 20;
const SIZE = GRID * CELL;
const STEP = SNAKE_DT * 1000;

export interface SnakeResult {
  score: number;
  replay: ReplaySnake;
}

export function SnakeGame({
  seed,
  onFinish,
  onStarted,
}: {
  seed: number;
  onFinish: (result: SnakeResult) => void;
  onStarted?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SnakeEngine | null>(null);
  if (engineRef.current === null) engineRef.current = new SnakeEngine(seed);

  const { t } = useT();
  const [started, setStarted] = useState(false);
  const [over, setOver] = useState(false);
  const [score, setScore] = useState(0);

  const inputs = useRef<{ t: number; a: SnakeAction }[]>([]);
  const tickRef = useRef(0);
  const pending = useRef<SnakeAction[]>([]);

  function enqueue(a: SnakeAction) {
    if (engineRef.current!.over) return;
    pending.current.push(a);
  }

  useEffect(() => {
    if (!started) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastScore = -1;

    const draw = () => {
      const eng = engineRef.current!;
      ctx.fillStyle = "#140a2e";
      ctx.fillRect(0, 0, SIZE, SIZE);
      // grilla tenue
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
      // comida
      ctx.fillStyle = "#ff3df0";
      ctx.shadowColor = "#ff3df0";
      ctx.shadowBlur = 10;
      ctx.fillRect(eng.food.x * CELL + 3, eng.food.y * CELL + 3, CELL - 6, CELL - 6);
      ctx.shadowBlur = 0;
      // serpiente
      eng.body.forEach((s, i) => {
        ctx.fillStyle = i === 0 ? "#b6ff3d" : "#39ff7a";
        ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
      });
      // puntaje
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 16px ui-sans-serif, system-ui";
      ctx.textAlign = "left";
      ctx.fillText(String(eng.score), 8, 22);
    };

    const loop = (tnow: number) => {
      const dt = Math.min(tnow - last, 100);
      last = tnow;
      const eng = engineRef.current!;
      acc += dt;
      while (acc >= STEP) {
        while (pending.current.length) {
          const a = pending.current.shift()!;
          eng.apply(a);
          inputs.current.push({ t: tickRef.current, a });
        }
        eng.tick();
        tickRef.current += 1;
        acc -= STEP;
        if (eng.over) break;
      }
      if (eng.score !== lastScore) {
        lastScore = eng.score;
        setScore(eng.score);
        sfx.move();
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
      const map: Record<string, SnakeAction> = {
        ArrowUp: "u",
        ArrowDown: "d",
        ArrowLeft: "l",
        ArrowRight: "r",
      };
      const a = map[e.key];
      if (a) {
        e.preventDefault();
        enqueue(a);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started]);

  const touch = useRef<{ x: number; y: number } | null>(null);
  function onDown(e: React.PointerEvent) {
    touch.current = { x: e.clientX, y: e.clientY };
  }
  function onUp(e: React.PointerEvent) {
    if (!touch.current) return;
    const dx = e.clientX - touch.current.x;
    const dy = e.clientY - touch.current.y;
    touch.current = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
    if (Math.abs(dx) > Math.abs(dy)) enqueue(dx > 0 ? "r" : "l");
    else enqueue(dy > 0 ? "d" : "u");
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative overflow-hidden rounded-lg border-2 border-[--color-ink]"
        style={{ width: "min(86vw, 340px)" }}
        onPointerDown={onDown}
        onPointerUp={onUp}
      >
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          className="block h-auto w-full touch-none"
        />

        {!started && (
          <StartScreen
            icon={<GameIcon id="snake" size={56} />}
            title={t("g.snake.title")}
            instructions={t("g.snake.instr")}
            onStart={() => {
              ensureAudio();
              onStarted?.();
              setStarted(true);
            }}
          />
        )}
        {over && (
          <GameOverScreen
            headline={t("g.snake.over")}
            score={score}
            onConfirm={() =>
              onFinish({
                score,
                replay: { seed, ticks: tickRef.current, inputs: inputs.current },
              })
            }
          />
        )}
      </div>

      {started && !over && (
        <div className="grid w-full max-w-[200px] grid-cols-3 grid-rows-2 gap-2">
          <span />
          <DirBtn onClick={() => enqueue("u")} label="▲" />
          <span />
          <DirBtn onClick={() => enqueue("l")} label="◀" />
          <DirBtn onClick={() => enqueue("d")} label="▼" />
          <DirBtn onClick={() => enqueue("r")} label="▶" />
        </div>
      )}

      <p className="font-screen text-center text-base text-slate-500">{t("g.snake.hint")}</p>
    </div>
  );
}

function DirBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="btn3d btn3d--cyan !py-3 !text-xl">
      {label}
    </button>
  );
}
