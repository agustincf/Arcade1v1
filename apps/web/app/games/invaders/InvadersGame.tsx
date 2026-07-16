"use client";

import { useEffect, useRef, useState } from "react";
import {
  InvadersEngine,
  INVADERS_CONST,
  INVADERS_DT,
  type InvaderAction,
  type ReplayInvaders,
} from "@arcade1v1/game-sdk/invaders";
import { StartScreen, GameOverScreen } from "@/app/games/_shared/ui";
import { sfx, ensureAudio } from "@/app/lib/sound";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";

const {
  WIDTH,
  HEIGHT,
  ALIEN_W,
  ALIEN_H,
  PLAYER_W,
  PLAYER_H,
  PLAYER_Y,
  BULLET_H,
  BOMB_H,
  SB,
  UFO_W,
  UFO_H,
  UFO_Y,
} = INVADERS_CONST;
const STEP = INVADERS_DT * 1000;
const ROW_COLOR = ["#ff3df0", "#27e8ff", "#ffd23d", "#39ff7a"];
// Estrellas de fondo (posiciones fijas).
const STARS = Array.from({ length: 36 }, (_, i) => ({
  x: (i * 71) % WIDTH,
  y: (i * 137) % HEIGHT,
  s: (i % 3) + 1,
}));

export interface InvadersResult {
  score: number;
  replay: ReplayInvaders;
}

export function InvadersGame({
  seed,
  onFinish,
  onStarted,
}: {
  seed: number;
  onFinish: (result: InvadersResult) => void;
  onStarted?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<InvadersEngine | null>(null);
  if (engineRef.current === null) engineRef.current = new InvadersEngine(seed);

  const { t } = useT();
  const [started, setStarted] = useState(false);
  const [over, setOver] = useState(false);
  const [score, setScore] = useState(0);

  const inputs = useRef<{ t: number; a: InvaderAction }[]>([]);
  const tickRef = useRef(0);
  const pending = useRef<InvaderAction[]>([]);
  const keys = useRef({ left: false, right: false, fire: false });

  function enqueue(a: InvaderAction) {
    if (engineRef.current!.over) return;
    pending.current.push(a);
    if (a === "f1") sfx.flap();
  }

  useEffect(() => {
    if (!started) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastScore = -1;

    function drawAlien(x: number, y: number, color: string, frame: number) {
      ctx.fillStyle = color;
      ctx.fillRect(x + 2, y + 3, ALIEN_W - 4, ALIEN_H - 5); // cuerpo
      ctx.fillRect(x + 5, y, ALIEN_W - 10, 4); // cabeza
      // patas (wiggle)
      if (frame) {
        ctx.fillRect(x, y + ALIEN_H - 3, 3, 3);
        ctx.fillRect(x + ALIEN_W - 3, y + ALIEN_H - 3, 3, 3);
      } else {
        ctx.fillRect(x + 2, y + ALIEN_H - 3, 3, 3);
        ctx.fillRect(x + ALIEN_W - 5, y + ALIEN_H - 3, 3, 3);
      }
      // ojos
      ctx.fillStyle = "#0a0518";
      ctx.fillRect(x + 5, y + 5, 2, 2);
      ctx.fillRect(x + ALIEN_W - 7, y + 5, 2, 2);
    }

    const draw = () => {
      const eng = engineRef.current!;
      const frame = Math.floor(tickRef.current / 22) % 2;
      // espacio + estrellas
      ctx.fillStyle = "#0a0518";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      for (const st of STARS) {
        ctx.fillStyle = (tickRef.current + st.x) % 90 < 45 ? "#4b3b80" : "#6d5efc";
        ctx.fillRect(st.x, st.y, st.s, st.s);
      }
      // OVNI bonus
      if (eng.ufo) {
        ctx.fillStyle = "#ff3df0";
        ctx.fillRect(eng.ufo.x, UFO_Y + 3, UFO_W, UFO_H - 3);
        ctx.fillRect(eng.ufo.x + 5, UFO_Y, UFO_W - 10, 4);
        ctx.fillStyle = "#ffd23d";
        for (let i = 2; i < UFO_W - 2; i += 5) ctx.fillRect(eng.ufo.x + i, UFO_Y + 6, 2, 2);
      }
      // aliens
      for (const al of eng.aliveAliens()) drawAlien(al.x, al.y, ROW_COLOR[al.row], frame);
      // escudos (bunkers)
      ctx.fillStyle = "#39ff7a";
      for (const s of eng.shields) ctx.fillRect(s.x, s.y, SB, SB);
      // balas del jugador
      ctx.fillStyle = "#27e8ff";
      for (const b of eng.bullets) ctx.fillRect(b.x - 1, b.y, 2, BULLET_H);
      // bombas
      ctx.fillStyle = "#ff4d6d";
      for (const b of eng.bombs) ctx.fillRect(b.x - 1, b.y, 3, BOMB_H);
      // nave
      const px = eng.playerX - PLAYER_W / 2;
      ctx.fillStyle = "#39ff7a";
      ctx.fillRect(px, PLAYER_Y, PLAYER_W, PLAYER_H);
      ctx.fillRect(eng.playerX - 2, PLAYER_Y - 5, 4, 5);
      // HUD
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px ui-sans-serif, system-ui";
      ctx.textAlign = "left";
      ctx.fillText(String(eng.score), 8, 16);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd23d";
      ctx.fillText("WAVE " + eng.wave, WIDTH / 2, 16);
      // vidas
      ctx.fillStyle = "#39ff7a";
      for (let i = 0; i < eng.lives; i++) ctx.fillRect(WIDTH - 14 - i * 14, 8, 10, 6);
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
      }
      draw();
      if (eng.over) {
        sfx.crash();
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
    function onDownKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (!keys.current.left) {
          keys.current.left = true;
          enqueue("l1");
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!keys.current.right) {
          keys.current.right = true;
          enqueue("r1");
        }
      } else if (e.key === " ") {
        e.preventDefault();
        if (!keys.current.fire) {
          keys.current.fire = true;
          enqueue("f1"); // mantener apretado = disparo automatico
        }
      }
    }
    function onUpKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        keys.current.left = false;
        enqueue("l0");
      } else if (e.key === "ArrowRight") {
        keys.current.right = false;
        enqueue("r0");
      } else if (e.key === " ") {
        keys.current.fire = false;
        enqueue("f0");
      }
    }
    window.addEventListener("keydown", onDownKey);
    window.addEventListener("keyup", onUpKey);
    return () => {
      window.removeEventListener("keydown", onDownKey);
      window.removeEventListener("keyup", onUpKey);
    };
  }, [started]);

  // Botones tactiles: mantener para mover, tocar para disparar.
  const hold = (a: InvaderAction) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      enqueue(a);
    },
  });

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative overflow-hidden rounded-lg border-2 border-(--color-ink)"
        style={{ width: "min(86vw, 320px)" }}
      >
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="block h-auto w-full touch-none"
        />

        {!started && (
          <StartScreen
            icon={<GameIcon id="invaders" size={56} />}
            title={t("g.invaders.title")}
            instructions={t("g.invaders.instr")}
            onStart={() => {
              ensureAudio();
              onStarted?.();
              setStarted(true);
            }}
          />
        )}
        {over && (
          <GameOverScreen
            headline={t("g.invaders.over")}
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
        <div className="grid w-full max-w-[320px] grid-cols-3 gap-2">
          <button
            {...hold("l1")}
            onPointerUp={() => enqueue("l0")}
            onPointerLeave={() => enqueue("l0")}
            aria-label="Mover a la izquierda"
            className="btn3d btn3d--cyan !text-2xl"
          >
            <span aria-hidden="true">◀</span>
          </button>
          <button
            {...hold("f1")}
            onPointerUp={() => enqueue("f0")}
            onPointerLeave={() => enqueue("f0")}
            aria-label="Disparar"
            className="btn3d btn3d--magenta !text-xl"
          >
            <span aria-hidden="true">🔫</span>
          </button>
          <button
            {...hold("r1")}
            onPointerUp={() => enqueue("r0")}
            onPointerLeave={() => enqueue("r0")}
            aria-label="Mover a la derecha"
            className="btn3d btn3d--cyan !text-2xl"
          >
            <span aria-hidden="true">▶</span>
          </button>
        </div>
      )}

      <p className="font-screen text-center text-base text-(--color-muted-3)">
        {t("g.invaders.hint")}
      </p>
    </div>
  );
}
