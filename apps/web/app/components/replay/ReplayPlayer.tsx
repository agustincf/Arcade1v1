"use client";

// Reproductor de replays: instancia el MOTOR REAL desde la semilla y aplica
// los inputs tick a tick (igual que el verificador del árbitro), dibujando en
// un canvas. Lo usan: "ver la corrida del rival", el sandbox del builder y el
// modo espectador. Determinista: siempre reproduce exactamente la partida.

import { useEffect, useRef, useState } from "react";
import { SnakeEngine, type ReplaySnake } from "@arcade1v1/game-sdk/snake";
import { FlappyEngine, FLAPPY_DT, type ReplayFlappy } from "@arcade1v1/game-sdk/flappy";
import { RacingEngine, RACING_DT, type ReplayRacing } from "@arcade1v1/game-sdk/racing";
import { InvadersEngine, type ReplayInvaders } from "@arcade1v1/game-sdk/invaders";
import { TetrisEngine, type ReplayTetris } from "@arcade1v1/game-sdk/tetris";
import { Game2048, type Replay2048 } from "@arcade1v1/game-sdk/g2048";
import { useT } from "@/app/lib/i18n";
import {
  drawSnake,
  drawFlappy,
  drawRacing,
  drawInvaders,
  drawTetris,
  draw2048,
  snakeCanvasSize,
  flappyCanvasSize,
  racingCanvasSize,
  invadersCanvasSize,
  tetrisCanvasSize,
  g2048CanvasSize,
} from "./render";

/** Simulación normalizada: avanzar un tick y dibujar, para cualquier juego. */
interface Sim {
  w: number;
  h: number;
  totalTicks: number;
  tick: number;
  over: boolean;
  score: number;
  step(): void;
  draw(ctx: CanvasRenderingContext2D): void;
}

function groupByTick<A>(inputs: { t: number; a: A }[]): Map<number, A[]> {
  const byTick = new Map<number, A[]>();
  for (const inp of inputs ?? []) {
    const arr = byTick.get(inp.t) ?? [];
    arr.push(inp.a);
    byTick.set(inp.t, arr);
  }
  return byTick;
}

function makeSim(game: string, replay: unknown): Sim | null {
  try {
    if (game === "snake") {
      const r = replay as ReplaySnake;
      const eng = new SnakeEngine(r.seed);
      const byTick = groupByTick(r.inputs);
      const { w, h } = snakeCanvasSize();
      return {
        w,
        h,
        totalTicks: r.ticks,
        tick: 0,
        get over() {
          return eng.over;
        },
        get score() {
          return eng.score;
        },
        step() {
          const acts = byTick.get(this.tick);
          if (acts) for (const a of acts) eng.apply(a);
          eng.tick();
          this.tick++;
        },
        draw(ctx) {
          drawSnake(ctx, eng);
        },
      };
    }
    if (game === "flappy") {
      const r = replay as ReplayFlappy;
      const eng = new FlappyEngine(r.seed);
      const flapSet = new Set(r.flaps);
      const { w, h } = flappyCanvasSize();
      return {
        w,
        h,
        totalTicks: r.ticks,
        tick: 0,
        get over() {
          return eng.over;
        },
        get score() {
          return eng.score;
        },
        step() {
          if (flapSet.has(this.tick)) eng.flap();
          eng.update(FLAPPY_DT);
          this.tick++;
        },
        draw(ctx) {
          drawFlappy(ctx, eng);
        },
      };
    }
    if (game === "racing") {
      const r = replay as ReplayRacing;
      const eng = new RacingEngine(r.seed);
      const byTick = groupByTick(r.inputs);
      const { w, h } = racingCanvasSize();
      return {
        w,
        h,
        totalTicks: r.ticks,
        tick: 0,
        get over() {
          return eng.over;
        },
        get score() {
          return eng.score;
        },
        step() {
          const acts = byTick.get(this.tick);
          if (acts) {
            for (const a of acts) {
              if (a === "l") eng.moveLeft();
              else eng.moveRight();
            }
          }
          eng.update(RACING_DT);
          this.tick++;
        },
        draw(ctx) {
          drawRacing(ctx, eng);
        },
      };
    }
    if (game === "invaders") {
      const r = replay as ReplayInvaders;
      const eng = new InvadersEngine(r.seed);
      const byTick = groupByTick(r.inputs);
      const { w, h } = invadersCanvasSize();
      return {
        w,
        h,
        totalTicks: r.ticks,
        tick: 0,
        get over() {
          return eng.over;
        },
        get score() {
          return eng.score;
        },
        step() {
          const acts = byTick.get(this.tick);
          if (acts) for (const a of acts) eng.apply(a);
          eng.tick();
          this.tick++;
        },
        draw(ctx) {
          drawInvaders(ctx, eng);
        },
      };
    }
    if (game === "tetris") {
      const r = replay as ReplayTetris;
      const eng = new TetrisEngine(r.seed);
      const byTick = groupByTick(r.inputs);
      const { w, h } = tetrisCanvasSize();
      return {
        w,
        h,
        totalTicks: r.ticks,
        tick: 0,
        get over() {
          return eng.over;
        },
        get score() {
          return eng.score;
        },
        step() {
          const acts = byTick.get(this.tick);
          if (acts) for (const a of acts) eng.apply(a);
          eng.tick();
          this.tick++;
        },
        draw(ctx) {
          drawTetris(ctx, eng);
        },
      };
    }
    if (game === "2048") {
      const r = replay as Replay2048;
      const eng = new Game2048(r.seed);
      const { w, h } = g2048CanvasSize();
      // 2048 no es por ticks: reproducimos un movimiento cada 6 cuadros para
      // que se pueda seguir con la vista.
      const MOVE_EVERY = 6;
      let moveIdx = 0;
      return {
        w,
        h,
        totalTicks: (r.moves?.length ?? 0) * MOVE_EVERY,
        tick: 0,
        get over() {
          return eng.over || moveIdx >= (r.moves?.length ?? 0);
        },
        get score() {
          return eng.score;
        },
        step() {
          if (this.tick % MOVE_EVERY === 0 && moveIdx < (r.moves?.length ?? 0)) {
            eng.move(r.moves[moveIdx]);
            moveIdx++;
          }
          this.tick++;
        },
        draw(ctx) {
          draw2048(ctx, eng);
        },
      };
    }
  } catch {
    return null;
  }
  return null;
}

const SPEEDS = [1, 2, 4, 8];

export function ReplayPlayer({
  game,
  replay,
  label,
  autoPlay = true,
  onEnd,
}: {
  game: string;
  replay: unknown;
  /** Etiqueta chica arriba del canvas (ej. nombre del jugador). */
  label?: string;
  autoPlay?: boolean;
  onEnd?: (finalScore: number) => void;
}) {
  const { t } = useT();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim | null>(null);
  const [playing, setPlaying] = useState(autoPlay);
  const [speedIdx, setSpeedIdx] = useState(1); // 2x por defecto: mirar sin dormirse
  const [score, setScore] = useState(0);
  const [ended, setEnded] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // (Re)crear la simulación cuando cambia el replay o al reiniciar.
  useEffect(() => {
    simRef.current = makeSim(game, replay);
    setScore(0);
    setEnded(false);
    setSize(simRef.current ? { w: simRef.current.w, h: simRef.current.h } : null);
    // primer cuadro, aun en pausa
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && simRef.current) simRef.current.draw(ctx);
  }, [game, replay, resetKey]);

  useEffect(() => {
    if (!playing || ended) return;
    const ctx = canvasRef.current?.getContext("2d");
    const sim = simRef.current;
    if (!ctx || !sim) return;
    let raf = 0;
    const loop = () => {
      const ticksPerFrame = SPEEDS[speedIdx];
      for (let i = 0; i < ticksPerFrame; i++) {
        if (sim.over || sim.tick >= sim.totalTicks) break;
        sim.step();
      }
      sim.draw(ctx);
      setScore(sim.score);
      if (sim.over || sim.tick >= sim.totalTicks) {
        setEnded(true);
        onEnd?.(sim.score);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speedIdx, ended, resetKey, size]);

  if (!size) {
    return <p className="text-sm text-(--color-muted-2)">{t("replay.unavailable")}</p>;
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {label && (
        <div className="font-pixel w-full truncate text-center text-px10 text-(--color-muted-2)">
          {label}
        </div>
      )}
      <div
        className="relative w-full overflow-hidden rounded-lg border-2 border-(--color-ink)"
        style={{ maxWidth: Math.min(size.w, 340) }}
      >
        <canvas ref={canvasRef} width={size.w} height={size.h} className="block h-auto w-full" />
        {ended && (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 py-2 text-center">
            <span className="font-pixel text-xs text-(--color-gold)">
              {t("replay.final")}: {score}
            </span>
          </div>
        )}
      </div>
      <div className="flex w-full items-center justify-center gap-2">
        <button
          onClick={() => {
            if (ended) setResetKey((k) => k + 1);
            setPlaying((p) => (ended ? true : !p));
          }}
          className="btn3d btn3d--cyan btn3d--sm"
        >
          {ended ? "⟲" : playing ? "❚❚" : "▶"}
        </button>
        <button
          onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
          className="btn3d btn3d--cyan btn3d--sm"
        >
          {SPEEDS[speedIdx]}x
        </button>
        <span className="font-pixel ml-2 text-xs text-(--color-gold)">{score}</span>
      </div>
    </div>
  );
}
