"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { TetrisEngine, COLS, ROWS, PIECE_COLORS } from "./engine";
import { StartScreen, GameOverScreen, GameOverlay } from "@/app/games/_shared/ui";
import { sfx, ensureAudio } from "@/app/lib/sound";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";

export interface TetrisResult {
  score: number;
  lines: number;
  level: number;
}

export function TetrisGame({
  seed,
  onFinish,
  onStarted,
}: {
  seed: number;
  onFinish: (result: TetrisResult) => void;
  onStarted?: () => void;
}) {
  const engineRef = useRef<TetrisEngine | null>(null);
  if (engineRef.current === null) engineRef.current = new TetrisEngine(seed);

  const { t } = useT();
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
      // Tope: si la pestaña estuvo en segundo plano, evita un "salto" de piezas.
      const dt = Math.min(t - last, 100);
      last = t;
      const eng = engineRef.current!;
      if (!eng.over && !pausedRef.current) {
        acc += dt;
        const g = eng.gravityMs();
        let moved = false;
        while (acc >= g) {
          eng.gravityTick();
          acc -= g;
          moved = true;
          if (eng.over) break;
        }
        if (moved) force(); // re-render solo cuando algo cambió
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
          sfx.rotate();
          afterInput();
          break;
        case "z":
        case "Z":
          e.preventDefault();
          eng.rotate(-1);
          sfx.rotate();
          afterInput();
          break;
        case " ":
          e.preventDefault();
          eng.hardDrop();
          sfx.drop();
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
  const ghost = engine.ghost();
  const ghostSet = new Set(
    ghost?.cells.map(([r, c]) => `${r},${c}`) ?? [],
  );

  return (
    <div className="flex flex-col items-center gap-4">
      {/* HUD: puntaje / lineas / nivel + proxima pieza */}
      <div className="flex w-full max-w-[320px] items-stretch justify-between gap-3 text-sm">
        <Stat label={t("g.score")} value={engine.score} big />
        <Stat label={t("g.lines")} value={engine.lines} />
        <Stat label={t("g.level")} value={engine.level} />
        <NextPreview matrix={nextMatrix} color={PIECE_COLORS[engine.peekNextType()]} label={t("g.next")} />
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
              <div key={`${r}-${c}`} className="aspect-square">
                {cell ? (
                  <Block color={PIECE_COLORS[cell - 1]} />
                ) : ghostSet.has(`${r},${c}`) && ghost ? (
                  <Ghost color={ghost.color} />
                ) : (
                  <div className="h-full w-full rounded-[2px] bg-[rgba(75,59,128,0.12)] shadow-[inset_0_0_0_1px_rgba(75,59,128,0.25)]" />
                )}
              </div>
            )),
          )}
        </div>

        {/* Pantalla: antes de empezar */}
        {!started && (
          <StartScreen
            icon={<GameIcon id="tetris" size={56} />}
            title={t("g.tetris.title")}
            instructions={t("g.tetris.instr")}
            onStart={() => {
              ensureAudio();
              onStarted?.();
              setStarted(true);
            }}
          />
        )}

        {/* Pantalla: pausa */}
        {started && paused && !over && (
          <GameOverlay>
            <h3 className="font-pixel text-base text-[--color-gold]">{t("g.pause")}</h3>
            <button
              onClick={() => setPaused(false)}
              className="btn3d btn3d--magenta mt-4"
            >
              {t("g.resume")}
            </button>
          </GameOverlay>
        )}

        {/* Pantalla: game over */}
        {over && (
          <GameOverScreen
            headline={t("g.tetris.over")}
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
          <TouchBtn onClick={() => { engine.rotate(1); sfx.rotate(); afterInput(); }} label="↻" />
          <TouchBtn onClick={() => { engine.move(1); afterInput(); }} label="▶" />
          <TouchBtn onClick={() => { engine.softDrop(); afterInput(); }} label="▼" />
          <TouchBtn onClick={() => { engine.hardDrop(); sfx.drop(); afterInput(); }} label="⤓" />
        </div>
      )}

      {/* Ayuda de teclado (en compu) */}
      <p className="hidden text-center text-xs text-slate-500 sm:block">
        {t("g.tetris.keys")}
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

/** Pieza fantasma: contorno tenue donde va a caer la pieza actual. */
function Ghost({ color }: { color: string }) {
  return (
    <div
      className="h-full w-full rounded-[3px]"
      style={{
        backgroundColor: `${color}22`,
        boxShadow: `inset 0 0 0 1.5px ${color}99`,
      }}
    />
  );
}

/** Una ficha glossy con brillo neon (mismo lenguaje visual que la plataforma). */
function Block({ color }: { color: string }) {
  return (
    <div
      className="h-full w-full rounded-[3px]"
      style={{
        backgroundColor: color,
        backgroundImage:
          "linear-gradient(140deg, rgba(255,255,255,0.6), rgba(255,255,255,0) 42%, rgba(0,0,0,0.42))",
        boxShadow: `inset 1.5px 1.5px 0 rgba(255,255,255,0.5), inset -1.5px -1.5px 0 rgba(0,0,0,0.45), 0 0 5px ${color}`,
      }}
    />
  );
}

function NextPreview({
  matrix,
  color,
  label,
}: {
  matrix: number[][];
  color: string;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-[--color-border] bg-[--color-surface] px-2 py-1 text-center">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 flex flex-col items-center gap-px">
        {matrix.map((row, r) => (
          <div key={r} className="flex gap-px">
            {row.map((cell, c) => (
              <div
                key={c}
                className="h-2 w-2 rounded-[1px]"
                style={{
                  backgroundColor: cell ? color : "transparent",
                  boxShadow: cell
                    ? "inset 0.5px 0.5px 0 rgba(255,255,255,0.5)"
                    : undefined,
                }}
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

