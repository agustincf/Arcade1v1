"use client";

import { useEffect, useRef, useState } from "react";
import { RacingEngine, RACING_CONST } from "./engine";
import { StartScreen, GameOverScreen } from "@/app/games/_shared/ui";
import { sfx, ensureAudio } from "@/app/lib/sound";

const { WIDTH, HEIGHT } = RACING_CONST;
const HORIZON = 150; // linea del horizonte (donde "nace" la ruta)

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

  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let lastScore = -1;

    // --- Proyeccion en perspectiva (pseudo-3D) ---
    const roadWidthAt = (y: number) => {
      const t = (y - HORIZON) / (HEIGHT - HORIZON);
      return 46 + t * (WIDTH - 24 - 46);
    };
    const laneCenterAt = (lane: number, y: number) =>
      WIDTH / 2 + (lane - 1) * (roadWidthAt(y) / 3.1);
    const projY = (engineY: number) =>
      HORIZON + (engineY / HEIGHT) * (HEIGHT - HORIZON);
    const depthScale = (y: number) => {
      const t = (y - HORIZON) / (HEIGHT - HORIZON);
      return 0.32 + t * 0.85;
    };

    const rr = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
    };

    function drawCar(
      cx: number,
      cy: number,
      scale: number,
      body: string,
      player = false,
    ) {
      const w = 42 * scale;
      const h = 30 * scale;
      const x = cx - w / 2;
      const y = cy - h / 2;
      const s = scale;
      // sombra
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(cx, cy + h * 0.5, w * 0.55, h * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      // ruedas
      ctx.fillStyle = "#0a0510";
      ctx.fillRect(x - 2 * s, y + 3 * s, 5 * s, h - 6 * s);
      ctx.fillRect(x + w - 3 * s, y + 3 * s, 5 * s, h - 6 * s);
      // aleron
      ctx.fillStyle = body;
      ctx.fillRect(x - 1 * s, y - 4 * s, w + 2 * s, 4 * s);
      // carroceria
      ctx.fillStyle = body;
      rr(x, y, w, h, 5 * s);
      ctx.fill();
      // brillo (sheen)
      const sheen = ctx.createLinearGradient(x, y, x, y + h);
      sheen.addColorStop(0, "rgba(255,255,255,0.55)");
      sheen.addColorStop(0.5, "rgba(255,255,255,0)");
      sheen.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = sheen;
      rr(x, y, w, h, 5 * s);
      ctx.fill();
      ctx.lineWidth = Math.max(1, 1.5 * s);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      rr(x, y, w, h, 5 * s);
      ctx.stroke();
      // luneta trasera
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      rr(x + w * 0.2, y + h * 0.2, w * 0.6, h * 0.42, 3 * s);
      ctx.fill();
      // luces
      ctx.fillStyle = player ? "#ff3b3b" : "#fff3a0";
      ctx.fillRect(x + 4 * s, y + h - 5 * s, 8 * s, 3 * s);
      ctx.fillRect(x + w - 12 * s, y + h - 5 * s, 8 * s, 3 * s);
    }

    const draw = () => {
      const eng = engineRef.current!;

      // --- Cielo atardecer ---
      const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
      sky.addColorStop(0, "#1a0f3a");
      sky.addColorStop(0.55, "#7a1f8f");
      sky.addColorStop(1, "#ff7a4d");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, WIDTH, HORIZON);
      // sol
      ctx.fillStyle = "#ffd23d";
      ctx.beginPath();
      ctx.arc(WIDTH / 2, HORIZON - 6, 40, 0, Math.PI * 2);
      ctx.fill();
      // rayas del sol (retro)
      ctx.fillStyle = "#1a0f3a";
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(WIDTH / 2 - 40, HORIZON - 22 + i * 8, 80, 3);
      }
      // montañas silueta
      ctx.fillStyle = "#2a1450";
      ctx.beginPath();
      ctx.moveTo(0, HORIZON);
      ctx.lineTo(50, HORIZON - 34);
      ctx.lineTo(95, HORIZON);
      ctx.lineTo(150, HORIZON - 46);
      ctx.lineTo(210, HORIZON);
      ctx.lineTo(265, HORIZON - 30);
      ctx.lineTo(WIDTH, HORIZON);
      ctx.fill();

      // --- Suelo (pasto + ruta en perspectiva, con rayas que se mueven) ---
      const phase = eng.roadOffset * 0.25;
      for (let y = HORIZON; y < HEIGHT; y++) {
        const t = (y - HORIZON) / (HEIGHT - HORIZON);
        const z = 1 / (t + 0.06);
        const stripe = Math.floor(z * 3.4 - phase);
        const odd = ((stripe % 2) + 2) % 2 === 1;
        // pasto
        ctx.fillStyle = odd ? "#173d24" : "#123018";
        ctx.fillRect(0, y, WIDTH, 1);
        // ruta
        const rw = roadWidthAt(y);
        const rl = WIDTH / 2 - rw / 2;
        ctx.fillStyle = odd ? "#3a3550" : "#322c48";
        ctx.fillRect(rl, y, rw, 1);
        // rumble (bordes)
        const rb = Math.max(2, rw * 0.07);
        ctx.fillStyle = odd ? "#ff3df0" : "#ffffff";
        ctx.fillRect(rl, y, rb, 1);
        ctx.fillRect(rl + rw - rb, y, rb, 1);
        // linea central punteada
        if (odd) {
          ctx.fillStyle = "#ffd23d";
          ctx.fillRect(WIDTH / 2 - rw * 0.012 - 1, y, Math.max(1, rw * 0.024), 1);
        }
      }

      // --- Obstaculos (de lejos a cerca para que se tapen bien) ---
      const obs = [...eng.obstacles].sort((a, b) => a.y - b.y);
      for (const o of obs) {
        const sy = projY(o.y);
        if (sy < HORIZON - 2) continue;
        drawCar(laneCenterAt(o.lane, sy), sy, depthScale(sy), OBST_COLORS[o.kind]);
      }

      // --- Auto del jugador ---
      const psy = projY(eng.carY);
      drawCar(laneCenterAt(eng.carLane, psy), psy, depthScale(psy), "#39ff7a", true);

      // --- HUD puntaje (en la esquina, fuera de la pista) ---
      ctx.textAlign = "left";
      ctx.fillStyle = "#27e8ff";
      ctx.font = "bold 11px ui-sans-serif, system-ui";
      ctx.fillText("PTS", 10, 22);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#0a0518";
      ctx.lineWidth = 4;
      ctx.font = "bold 30px ui-sans-serif, system-ui";
      ctx.strokeText(String(eng.score), 10, 50);
      ctx.fillText(String(eng.score), 10, 50);
    };

    const loop = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      const eng = engineRef.current!;
      eng.update(dt);
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
