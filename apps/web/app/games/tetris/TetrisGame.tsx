"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import {
  TetrisEngine,
  COLS,
  PIECE_COLORS,
  type TetrisAction,
  type ReplayTetris,
} from "@arcade1v1/game-sdk/tetris";
import { StartScreen, GameOverScreen, GameOverlay } from "@/app/games/_shared/ui";
import { sfx, ensureAudio } from "@/app/lib/sound";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";

const STEP = 1000 / 60; // un tick cada 1/60 de segundo (paso fijo, determinístico)

export interface TetrisResult {
  score: number;
  lines: number;
  level: number;
  replay: ReplayTetris;
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

  // Cola de teclas (se aplican en el tick) + grabacion del replay.
  const pending = useRef<TetrisAction[]>([]);
  const inputs = useRef<{ t: number; a: TetrisAction }[]>([]);
  const tickRef = useRef(0);

  // Efectos visuales (flash de lineas, cartel de puntos, sacudida). Viven fuera
  // del motor: el replay no cambia. El componente ya re-renderiza cada frame.
  const fx = useRef<{
    flashRows: number[];
    flashT0: number;
    popup: { txt: string; sub?: string; t0: number } | null;
    shakeT0: number;
    shakeMag: number;
  }>({ flashRows: [], flashT0: 0, popup: null, shakeT0: 0, shakeMag: 0 });

  const engine = engineRef.current;

  function enqueue(a: TetrisAction) {
    if (engineRef.current!.over || pausedRef.current) return;
    pending.current.push(a);
    if (a === "cw" || a === "ccw") sfx.rotate();
    else if (a === "h") sfx.drop();
    else if (a === "l" || a === "r") sfx.move();
  }

  // Reloj de PASO FIJO: cada tick aplica las teclas encoladas y avanza gravedad.
  // Graba cada tecla con su numero de tick -> el servidor re-simula igual.
  useEffect(() => {
    if (!started) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (tnow: number) => {
      const dt = Math.min(tnow - last, 100); // tope si la pestaña estuvo en 2do plano
      last = tnow;
      const eng = engineRef.current!;
      if (!eng.over && !pausedRef.current) {
        acc += dt;
        while (acc >= STEP) {
          // Foto previa para detectar eventos (lineas, nivel) y saber DONDE
          // aterrizo la pieza (las lineas limpiadas tocan filas del fantasma).
          const prevLines = eng.lines;
          const prevScore = eng.score;
          const prevLevel = eng.level;
          const ghostRows = [...new Set((eng.ghost()?.cells ?? []).map(([r]) => r))].sort(
            (a, b) => b - a,
          );
          while (pending.current.length) {
            const a = pending.current.shift()!;
            eng.apply(a);
            inputs.current.push({ t: tickRef.current, a });
          }
          eng.tick();
          tickRef.current += 1;
          acc -= STEP;

          const cleared = eng.lines - prevLines;
          if (cleared > 0) {
            const now = performance.now();
            fx.current.flashRows = ghostRows.slice(0, cleared);
            fx.current.flashT0 = now;
            fx.current.popup = {
              txt: `+${eng.score - prevScore}`,
              sub: cleared === 4 ? "TETRIS!" : undefined,
              t0: now,
            };
            fx.current.shakeT0 = now;
            fx.current.shakeMag = cleared === 4 ? 5 : 2;
            if (cleared === 4) sfx.tetris();
            else sfx.clear();
          }
          if (eng.level > prevLevel) sfx.levelUp();

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

  // Teclado: encola acciones (se aplican en el proximo tick).
  useEffect(() => {
    if (!started) return;
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          enqueue("l");
          break;
        case "ArrowRight":
          e.preventDefault();
          enqueue("r");
          break;
        case "ArrowDown":
          e.preventDefault();
          enqueue("s");
          break;
        case "ArrowUp":
        case "x":
        case "X":
          e.preventDefault();
          enqueue("cw");
          break;
        case "z":
        case "Z":
          e.preventDefault();
          enqueue("ccw");
          break;
        case " ":
          e.preventDefault();
          enqueue("h");
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
  const ghostSet = new Set(ghost?.cells.map(([r, c]) => `${r},${c}`) ?? []);

  // Animaciones de los efectos (el componente re-renderiza cada frame).
  const now = performance.now();
  const flashAlpha = Math.max(0, 1 - (now - fx.current.flashT0) / 320);
  const popupT = fx.current.popup ? (now - fx.current.popup.t0) / 800 : 1;
  const popupAlpha = popupT >= 1 ? 0 : Math.min(1, (1 - popupT) * 2.5);
  const shakeLeft = Math.max(0, 1 - (now - fx.current.shakeT0) / 260);
  const shakeMag = shakeLeft * fx.current.shakeMag;
  const shakeStyle =
    shakeMag > 0.2
      ? `translate(${(Math.random() - 0.5) * shakeMag}px, ${(Math.random() - 0.5) * shakeMag}px)`
      : undefined;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* HUD: puntaje / lineas / nivel + proxima pieza */}
      <div className="flex w-full max-w-[320px] items-stretch justify-between gap-3 text-sm">
        <Stat label={t("g.score")} value={engine.score} big />
        <Stat label={t("g.lines")} value={engine.lines} />
        <Stat label={t("g.level")} value={engine.level} />
        <NextPreview
          matrix={nextMatrix}
          color={PIECE_COLORS[engine.peekNextType()]}
          label={t("g.next")}
        />
      </div>

      {/* Tablero */}
      <div className="relative">
        <div
          className="grid gap-px rounded-lg border border-(--color-border) bg-black/40 p-1"
          style={{
            width: "min(86vw, 260px)",
            gridTemplateColumns: `repeat(${COLS}, 1fr)`,
            transform: shakeStyle,
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

        {/* FX: destello de las lineas limpiadas */}
        {flashAlpha > 0 &&
          fx.current.flashRows.map((r) => (
            <div
              key={r}
              className="pointer-events-none absolute left-1 right-1 rounded-sm bg-white"
              style={{
                top: `calc(${(r / grid.length) * 100}% + 1px)`,
                height: `${100 / grid.length}%`,
                opacity: flashAlpha,
                boxShadow: "0 0 14px #ffffff",
              }}
            />
          ))}

        {/* FX: cartel de puntos (y TETRIS! con 4 lineas) */}
        {popupAlpha > 0 && fx.current.popup && (
          <div
            className="pointer-events-none absolute inset-x-0 top-1/3 text-center"
            style={{ opacity: popupAlpha, transform: `translateY(-${popupT * 18}px)` }}
          >
            {fx.current.popup.sub && (
              <div
                className="font-pixel text-xl text-(--color-gold)"
                style={{ textShadow: "0 0 12px #ffd23d" }}
              >
                {fx.current.popup.sub}
              </div>
            )}
            <div
              className="font-pixel text-lg text-white"
              style={{ textShadow: "0 0 8px #ffffff" }}
            >
              {fx.current.popup.txt}
            </div>
          </div>
        )}

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
            <h3 className="font-pixel text-base text-(--color-gold)">{t("g.pause")}</h3>
            <button onClick={() => setPaused(false)} className="btn3d btn3d--magenta mt-4">
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
                replay: { seed, ticks: tickRef.current, inputs: inputs.current },
              })
            }
          />
        )}
      </div>

      {/* Controles tactiles (utiles en celular) */}
      {started && !over && (
        <div className="grid w-full max-w-[320px] grid-cols-5 gap-2">
          <TouchBtn onClick={() => enqueue("l")} label="◀" />
          <TouchBtn onClick={() => enqueue("cw")} label="↻" />
          <TouchBtn onClick={() => enqueue("r")} label="▶" />
          <TouchBtn onClick={() => enqueue("s")} label="▼" />
          <TouchBtn onClick={() => enqueue("h")} label="⤓" />
        </div>
      )}

      {/* Ayuda de teclado (en compu) */}
      <p className="hidden text-center text-xs text-(--color-muted-3) sm:block">
        {t("g.tetris.keys")}
      </p>
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: number; big?: boolean }) {
  return (
    <div className="flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1 text-center">
      <div className="text-px10 uppercase tracking-wide text-(--color-muted-3)">{label}</div>
      <div className={`font-extrabold ${big ? "text-lg" : "text-base"}`}>{value}</div>
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
    <div className="rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1 text-center">
      <div className="text-px10 uppercase tracking-wide text-(--color-muted-3)">{label}</div>
      <div className="mt-1 flex flex-col items-center gap-px">
        {matrix.map((row, r) => (
          <div key={r} className="flex gap-px">
            {row.map((cell, c) => (
              <div
                key={c}
                className="h-2 w-2 rounded-[1px]"
                style={{
                  backgroundColor: cell ? color : "transparent",
                  boxShadow: cell ? "inset 0.5px 0.5px 0 rgba(255,255,255,0.5)" : undefined,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const TETRIS_LABEL: Record<string, string> = {
  "◀": "Mover a la izquierda",
  "▶": "Mover a la derecha",
  "↻": "Rotar",
  "▼": "Bajar",
  "⤓": "Soltar",
};

function TouchBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={TETRIS_LABEL[label] ?? label}
      className="select-none rounded-xl border border-(--color-border) bg-(--color-surface) py-4 text-xl font-bold active:bg-(--color-surface-2)"
    >
      <span aria-hidden="true">{label}</span>
    </button>
  );
}
