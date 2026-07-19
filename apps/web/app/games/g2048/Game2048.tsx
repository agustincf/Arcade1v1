"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { Game2048 as Engine, SIZE, type Dir, type Replay2048 } from "@arcade1v1/game-sdk/g2048";
import { StartScreen, GameOverScreen } from "@/app/games/_shared/ui";
import { sfx, ensureAudio } from "@/app/lib/sound";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";

export interface Result2048 {
  score: number;
  replay?: Replay2048; // semilla + movimientos, para que el servidor verifique
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

function tileColor(v: number) {
  return TILE_COLORS[v] ?? "#ffd23d";
}

export function Game2048Component({
  seed,
  onFinish,
  onStarted,
}: {
  seed: number;
  onFinish: (result: Result2048) => void;
  onStarted?: () => void;
}) {
  const engineRef = useRef<Engine | null>(null);
  if (engineRef.current === null) engineRef.current = new Engine(seed);

  const { t } = useT();
  const [, force] = useReducer((x) => x + 1, 0);
  const [started, setStarted] = useState(false);
  const [over, setOver] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const moves = useRef<Dir[]>([]); // se graba cada movimiento (para el replay)

  // Cartel flotante de puntos / hito (visual: el replay no cambia).
  const [fxPopup, setFxPopup] = useState<{ id: number; txt: string; sub?: string } | null>(null);
  const popupId = useRef(0);

  const engine = engineRef.current;

  function doMove(dir: Dir) {
    const eng = engineRef.current!;
    if (eng.over) return;
    const prevScore = eng.score;
    const prevMax = Math.max(...eng.board.flat());
    if (eng.move(dir)) {
      moves.current.push(dir);
      const delta = eng.score - prevScore;
      const newMax = Math.max(...eng.board.flat());
      const hito = newMax > prevMax && newMax >= 128;
      if (hito) {
        sfx.milestone();
        popupId.current += 1;
        setFxPopup({ id: popupId.current, txt: `+${delta}`, sub: `¡${newMax}!` });
      } else if (delta > 0) {
        sfx.merge(Math.log2(delta));
        popupId.current += 1;
        setFxPopup({ id: popupId.current, txt: `+${delta}` });
      } else {
        sfx.move();
      }
      force();
      if (eng.over) setOver(true);
    }
  }

  useEffect(() => {
    if (!started) return;
    function onKey(e: KeyboardEvent) {
      const map: Record<string, Dir> = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      };
      const dir = map[e.key];
      if (dir) {
        e.preventDefault();
        doMove(dir);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started]);

  function onPointerDown(e: React.PointerEvent) {
    touch.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!touch.current) return;
    const dx = e.clientX - touch.current.x;
    const dy = e.clientY - touch.current.y;
    touch.current = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? "right" : "left");
    else doMove(dy > 0 ? "down" : "up");
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full max-w-[320px] items-center justify-between">
        <span className="font-pixel text-sm text-(--color-gold)">2048</span>
        <span className="font-screen text-xl text-(--color-muted-bright)">
          {t("g.score")}: <b className="text-(--color-accent-2)">{engine.score}</b>
        </span>
      </div>

      <div className="relative">
        <div
          className="grid touch-none gap-2 rounded-lg border-2 border-(--color-ink) bg-(--color-ink) p-2"
          style={{
            width: "min(86vw, 320px)",
            gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
          }}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          {engine.board.map((row, r) =>
            row.map((v, c) => (
              <div key={`${r}-${c}`} className="aspect-square">
                {v === 0 ? (
                  <div className="h-full w-full rounded-[4px] bg-[rgba(75,59,128,0.18)]" />
                ) : (
                  // key por valor: al cambiar la celda, la ficha re-monta y "popea"
                  <Tile key={v} value={v} />
                )}
              </div>
            )),
          )}
        </div>

        {/* Cartel flotante: puntos del movimiento y fichas hito */}
        {fxPopup && (
          <div
            key={fxPopup.id}
            className="rise-fade pointer-events-none absolute inset-x-0 top-1/3 text-center"
            onAnimationEnd={() => setFxPopup(null)}
          >
            {fxPopup.sub && (
              <div
                className="font-pixel text-2xl text-(--color-gold)"
                style={{ textShadow: "0 0 14px #ffd23d" }}
              >
                {fxPopup.sub}
              </div>
            )}
            <div
              className="font-pixel text-lg text-white"
              style={{ textShadow: "0 0 8px #ffffff" }}
            >
              {fxPopup.txt}
            </div>
          </div>
        )}

        {!started && (
          <StartScreen
            icon={<GameIcon id="2048" size={56} />}
            title={t("g.2048.title")}
            instructions={t("g.2048.instr")}
            onStart={() => {
              ensureAudio();
              onStarted?.();
              setStarted(true);
            }}
          />
        )}

        {over && (
          <GameOverScreen
            headline={t("g.2048.over")}
            score={engine.score}
            onConfirm={() =>
              onFinish({
                score: engine.score,
                replay: { seed, moves: moves.current },
              })
            }
          />
        )}
      </div>

      {/* Controles tactiles */}
      {started && !over && (
        <div className="grid w-full max-w-[200px] grid-cols-3 grid-rows-2 gap-2">
          <span />
          <DirBtn onClick={() => doMove("up")} label="▲" />
          <span />
          <DirBtn onClick={() => doMove("left")} label="◀" />
          <DirBtn onClick={() => doMove("down")} label="▼" />
          <DirBtn onClick={() => doMove("right")} label="▶" />
        </div>
      )}

      <p className="font-screen text-center text-base text-(--color-muted-3)">{t("g.2048.hint")}</p>
    </div>
  );
}

function Tile({ value }: { value: number }) {
  const color = tileColor(value);
  const dark = value <= 4;
  const size = value >= 1000 ? "text-base" : value >= 100 ? "text-xl" : "text-2xl";
  return (
    <div
      className="tile-pop flex h-full w-full items-center justify-center rounded-[4px]"
      style={{
        backgroundColor: color,
        backgroundImage:
          "linear-gradient(140deg, rgba(255,255,255,0.5), rgba(255,255,255,0) 45%, rgba(0,0,0,0.4))",
        boxShadow: `inset 1.5px 1.5px 0 rgba(255,255,255,0.4), inset -1.5px -1.5px 0 rgba(0,0,0,0.4), 0 0 6px ${color}`,
      }}
    >
      <span
        className={`font-screen font-bold ${size}`}
        style={{ color: dark ? "#e8e2ff" : "#1a0033" }}
      >
        {value}
      </span>
    </div>
  );
}

const DIR_LABEL: Record<string, string> = {
  "▲": "Mover arriba",
  "▼": "Mover abajo",
  "◀": "Mover a la izquierda",
  "▶": "Mover a la derecha",
};

function DirBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={DIR_LABEL[label] ?? label}
      className="btn3d btn3d--cyan !py-3 !text-xl"
    >
      <span aria-hidden="true">{label}</span>
    </button>
  );
}
