"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { TetrisEngine, COLS, ROWS, PIECE_COLORS } from "./engine";
import { StartScreen, GameOverScreen, GameOverlay } from "@/app/games/_shared/ui";

export interface TetrisResult {
  score: number;
  lines: number;
  level: number;
}

export function TetrisGame({
  seed,
  onFinish,
}: {
  seed: number;
  onFinish: (result: TetrisResult) => void;
}) {
  const engineRef = useRef<TetrisEngine | null>(null);
  if (engineRef.current === null) engineRef.current = new TetrisEngine(seed);

  const [, force] = useReducer((x) => x + 1, 0);
  const [started, setStarted] = useState(false);
  const [over, setOver] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const engine = engineRef.current;

  function afterInput() {
    force();
    if (engineRef.current!.over) setOver(true);
  }

  // Reloj del juego: hace caer las piezas segun el nivel.
  useEffect(() => {
    if (!started) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (t: number) => {
      const dt = t - last;
      last = t;
      const eng = engineRef.current!;
      if (!eng.over && !pausedRef.current) {
        eng.addTime(dt);
        acc += dt;
        const g = eng.gravityMs();
        while (acc >= g) {
          eng.gravityTick();
          acc -= g;
          if (eng.over) break;
        }
        force();
      }
      if (eng.over) {
        setOver(true);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [started]);

  // Controles de teclado.
  useEffect(() => {
    if (!started) return;
    function onKey(e: KeyboardEvent) {
      const eng = engineRef.current!;
      if (eng.over) return;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          eng.move(-1);
          afterInput();
          break;
        case "ArrowRight":
          e.preventDefault();
          eng.move(1);
          afterInput();
          break;
        case "ArrowDown":
          e.preventDefault();
          eng.softDrop();
          afterInput();
          break;
        case "ArrowUp":
        case "x":
        case "X":
          e.preventDefault();
          eng.rotate(1);
          afterInput();
          break;
        case "z":
        case "Z":
          e.preventDefault();
          eng.rotate(-1);
          afterInput();
          break;
        case " ":
          e.preventDefault();
          eng.hardDrop();
          afterInput();
          break;
        case "p":
        case "P":
          setPaused((p) => !p);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started]);

  const grid = engine.render();
  const nextMatrix = engine.nextPieceMatrix();

  return (
    <div className="flex flex-col items-center gap-4">
      {/* HUD: puntaje / lineas / nivel + proxima pieza */}
      <div className="flex w-full max-w-[320px] items-stretch justify-between gap-3 text-sm">
        <Stat label="Puntaje" value={engine.score} big />
        <Stat label="Lineas" value={engine.lines} />
        <Stat label="Nivel" value={engine.effectiveLevel()} />
        <NextPreview matrix={nextMatrix} />
      </div>

      {/* Tablero */}
      <div className="relative">
        <div
          className="grid gap-px rounded-lg border border-[--color-border] bg-black/40 p-1"
          style={{
            width: "min(86vw, 260px)",
            gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          }}
        >
          {grid.map((row, r) =>
            row.map((cell, c) => (
              <div
                key={`${r}-${c}`}
                className="aspect-square rounded-[2px]"
                style={{
                  backgroundColor: cell ? PIECE_COLORS[cell - 1] : "#10141f",
                }}
              />
            )),
          )}
        </div>

        {/* Pantalla: antes de empezar */}
        {!started && (
          <StartScreen
            emoji="🟦"
            title="TETRIS"
            instructions="Apilá las piezas y hacé líneas. Cuantos más puntos, mejor. ¡Se pone más rápido!"
            onStart={() => setStarted(true)}
          />
        )}

        {/* Pantalla: pausa */}
        {started && paused && !over && (
          <GameOverlay>
            <h3 className="font-pixel text-base text-[--color-gold]">PAUSA</h3>
            <button
              onClick={() => setPaused(false)}
              className="btn3d btn3d--magenta mt-4"
            >
              SEGUIR ▶
            </button>
          </GameOverlay>
        )}

        {/* Pantalla: game over */}
        {over && (
          <GameOverScreen
            headline="¡GAME OVER! 💥"
            score={engine.score}
            onConfirm={() =>
              onFinish({
                score: engine.score,
                lines: engine.lines,
                level: engine.level,
              })
            }
          />
        )}
      </div>

      {/* Controles tactiles (utiles en celular) */}
      {started && !over && (
        <div className="grid w-full max-w-[320px] grid-cols-5 gap-2">
          <TouchBtn onClick={() => { engine.move(-1); afterInput(); }} label="◀" />
          <TouchBtn onClick={() => { engine.rotate(1); afterInput(); }} label="↻" />
          <TouchBtn onClick={() => { engine.move(1); afterInput(); }} label="▶" />
          <TouchBtn onClick={() => { engine.softDrop(); afterInput(); }} label="▼" />
          <TouchBtn onClick={() => { engine.hardDrop(); afterInput(); }} label="⤓" />
        </div>
      )}

      {/* Ayuda de teclado (en compu) */}
      <p className="hidden text-center text-xs text-slate-500 sm:block">
        Teclado: ← → mover · ↑/X rotar · ↓ bajar · Espacio = caida rapida · P =
        pausa
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  big,
}: {
  label: string;
  value: number;
  big?: boolean;
}) {
  return (
    <div className="flex-1 rounded-lg border border-[--color-border] bg-[--color-surface] px-2 py-1 text-center">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`font-extrabold ${big ? "text-lg" : "text-base"}`}>
        {value}
      </div>
    </div>
  );
}

function NextPreview({ matrix }: { matrix: number[][] }) {
  return (
    <div className="rounded-lg border border-[--color-border] bg-[--color-surface] px-2 py-1 text-center">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        Sigue
      </div>
      <div className="mt-1 flex flex-col items-center gap-px">
        {matrix.map((row, r) => (
          <div key={r} className="flex gap-px">
            {row.map((cell, c) => (
              <div
                key={c}
                className="h-2 w-2 rounded-[1px]"
                style={{ backgroundColor: cell ? "#8b93a7" : "transparent" }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TouchBtn({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="select-none rounded-xl border border-[--color-border] bg-[--color-surface] py-4 text-xl font-bold active:bg-[--color-surface-2]"
    >
      {label}
    </button>
  );
}

