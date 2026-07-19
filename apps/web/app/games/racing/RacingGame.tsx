"use client";

import { useEffect, useRef, useState } from "react";
import {
  RacingEngine,
  RACING_CONST,
  RACING_DT,
  RACING_RULES_V,
  type RaceAction,
  type ReplayRacing,
} from "@arcade1v1/game-sdk/racing";
import { StartScreen, GameOverScreen } from "@/app/games/_shared/ui";
import { sfx, ensureAudio } from "@/app/lib/sound";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";

const { WIDTH, HEIGHT } = RACING_CONST;
const HORIZON = 150; // linea del horizonte (donde "nace" la ruta)
const STEP = RACING_DT * 1000; // ms por tick

export interface RacingResult {
  score: number;
  replay: ReplayRacing;
}

const OBST_COLORS = ["#ff4d6d", "#ffd23d", "#27e8ff"];

export function RacingGame({
  seed,
  onFinish,
  onStarted,
}: {
  seed: number;
  onFinish: (result: RacingResult) => void;
  onStarted?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<RacingEngine | null>(null);
  if (engineRef.current === null) engineRef.current = new RacingEngine(seed);

  const { t } = useT();
  const [started, setStarted] = useState(false);
  const [over, setOver] = useState(false);
  const [score, setScore] = useState(0);

  // Grabacion del replay (anti-trampa).
  const inputs = useRef<{ t: number; a: RaceAction }[]>([]);
  const tickRef = useRef(0);
  const pending = useRef<RaceAction[]>([]);
  const touch = useRef<{ x: number; y: number } | null>(null);

  function enqueue(a: RaceAction) {
    if (engineRef.current!.over) return;
    pending.current.push(a);
    if (a !== "j") sfx.move(); // el salto suena recién al despegar de verdad
  }

  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastScore = -1;

    // --- Estado visual (fuera del motor: no toca el replay ni la colision) ---
    // El motor cambia de carril de golpe (regla discreta, justa para el
    // benchmark); el auto DIBUJADO lo persigue con un resorte: se desliza con
    // inercia y se inclina al doblar. La fisica jugable no cambia.
    let visualLane = engineRef.current!.carLane;
    let laneVel = 0;
    const particles: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
      max: number;
      size: number;
      color: string;
    }[] = [];
    const popups: { x: number; y: number; txt: string; life: number; color: string }[] = [];
    let flash = 0;
    let shake = 0;
    let deathWait = -1;
    let speedLineOff = 0;
    let prevLvl = 0;

    function burst(x: number, y: number, colors: string[], n: number, force = 1) {
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const v = (0.8 + Math.random() * 2.2) * force;
        const life = 20 + Math.floor(Math.random() * 18);
        particles.push({
          x,
          y,
          vx: Math.cos(ang) * v,
          vy: Math.sin(ang) * v - 0.8,
          life,
          max: life,
          size: Math.random() < 0.35 ? 4 : 3,
          color: colors[Math.floor(Math.random() * colors.length)],
        });
      }
    }

    // --- Proyeccion en perspectiva (pseudo-3D) ---
    const roadWidthAt = (y: number) => {
      const t = (y - HORIZON) / (HEIGHT - HORIZON);
      return 46 + t * (WIDTH - 24 - 46);
    };
    const laneCenterAt = (lane: number, y: number) =>
      WIDTH / 2 + (lane - 1) * (roadWidthAt(y) / 3.1);
    // Proyeccion con perspectiva real: lejos se mueve lento, cerca acelera.
    const projY = (engineY: number) =>
      HORIZON + Math.pow(Math.max(0, engineY) / HEIGHT, 1.9) * (HEIGHT - HORIZON);
    const depthScale = (y: number) => {
      const t = (y - HORIZON) / (HEIGHT - HORIZON);
      return 0.3 + t * 1.0;
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
      jumpArc = 0,
      tilt = 0,
    ) {
      ctx.save();
      if (tilt) {
        // inclinacion al doblar (alrededor del centro del auto)
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.translate(-cx, -cy);
      }
      const lift = 26 * jumpArc * scale; // el cuerpo sube; la sombra NO
      const s = scale * (1 + 0.3 * jumpArc);
      const w = 42 * s;
      const h = 30 * s;
      const x = cx - w / 2;
      const y = cy - h / 2 - lift;
      // sombra (queda en el piso y se achica al despegar)
      ctx.fillStyle = `rgba(0,0,0,${0.35 - 0.18 * jumpArc})`;
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy + 30 * scale * 0.5,
        w * (0.55 - 0.15 * jumpArc),
        h * 0.28,
        0,
        0,
        Math.PI * 2,
      );
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
      ctx.restore();
    }

    const draw = () => {
      const eng = engineRef.current!;

      ctx.save();
      if (shake > 0) {
        ctx.translate((Math.random() - 0.5) * shake * 0.8, (Math.random() - 0.5) * shake * 0.8);
        shake -= 1;
      }

      // --- Cielo atardecer ---
      const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
      sky.addColorStop(0, "#1a0f3a");
      sky.addColorStop(0.55, "#7a1f8f");
      sky.addColorStop(1, "#ff7a4d");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, WIDTH, HORIZON);
      // estrellas en lo alto
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      for (let i = 0; i < 14; i++) {
        const sx = (i * 89) % WIDTH;
        const sy = (i * 31) % 55;
        ctx.fillRect(sx, sy, i % 3 === 0 ? 2 : 1, i % 3 === 0 ? 2 : 1);
      }
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

      // --- Suelo (pasto + ruta en perspectiva, en bandas que se mueven) ---
      const cx = WIDTH / 2;
      const quad = (
        lt: number,
        rt: number,
        lb: number,
        rb: number,
        yTop: number,
        yBot: number,
        color: string,
      ) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(lt, yTop);
        ctx.lineTo(rt, yTop);
        ctx.lineTo(rb, yBot);
        ctx.lineTo(lb, yBot);
        ctx.closePath();
        ctx.fill();
      };
      let yb = HEIGHT;
      let dy = 44;
      let band = Math.floor(eng.roadOffset / 3); // desplaza las bandas
      while (yb > HORIZON) {
        const yTop = Math.max(HORIZON, yb - dy);
        const odd = ((band % 2) + 2) % 2 === 0;
        const rwT = roadWidthAt(yTop);
        const rwB = roadWidthAt(yb);
        // pasto
        ctx.fillStyle = odd ? "#173d24" : "#123018";
        ctx.fillRect(0, yTop, WIDTH, yb - yTop);
        // ruta
        quad(
          cx - rwT / 2,
          cx + rwT / 2,
          cx - rwB / 2,
          cx + rwB / 2,
          yTop,
          yb,
          odd ? "#3a3550" : "#322c48",
        );
        // rumble (bordes neon)
        const rbT = Math.max(2, rwT * 0.08);
        const rbB = Math.max(2, rwB * 0.08);
        const rc = odd ? "#ff3df0" : "#ffffff";
        quad(cx - rwT / 2, cx - rwT / 2 + rbT, cx - rwB / 2, cx - rwB / 2 + rbB, yTop, yb, rc);
        quad(cx + rwT / 2 - rbT, cx + rwT / 2, cx + rwB / 2 - rbB, cx + rwB / 2, yTop, yb, rc);
        // linea central
        if (odd) {
          const dwT = Math.max(1, rwT * 0.03);
          const dwB = Math.max(1, rwB * 0.03);
          quad(cx - dwT / 2, cx + dwT / 2, cx - dwB / 2, cx + dwB / 2, yTop, yb, "#ffd23d");
        }
        yb = yTop;
        dy = Math.max(6, dy * 0.86);
        band++;
      }

      // --- Obstaculos (de lejos a cerca para que se tapen bien) ---
      const obs = [...eng.obstacles].sort((a, b) => a.y - b.y);
      for (const o of obs) {
        const sy = projY(o.y);
        if (sy < HORIZON - 2) continue;
        if (o.jumpable) {
          // valla baja con franjas amarillo/negro
          const sc = depthScale(sy);
          const w = 46 * sc;
          const h = 12 * sc;
          const bx = laneCenterAt(o.lane, sy) - w / 2;
          ctx.fillStyle = "#0a0510";
          ctx.fillRect(bx, sy - h, w, h);
          ctx.fillStyle = "#ffd23d";
          const stripe = w / 5;
          for (let i = 0; i < 5; i += 2) ctx.fillRect(bx + i * stripe, sy - h, stripe, h);
          ctx.fillStyle = "#0a0510";
          ctx.fillRect(bx, sy - h - 3 * sc, 3 * sc, h + 3 * sc);
          ctx.fillRect(bx + w - 3 * sc, sy - h - 3 * sc, 3 * sc, h + 3 * sc);
        } else {
          drawCar(laneCenterAt(o.lane, sy), sy, depthScale(sy), OBST_COLORS[o.kind]);
        }
      }
      // monedas
      for (const c of eng.coins) {
        if (c.taken) continue;
        const sy = projY(c.y);
        if (sy < HORIZON - 2) continue;
        const sc = depthScale(sy);
        ctx.fillStyle = "#ffd23d";
        ctx.shadowColor = "#ffd23d";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(laneCenterAt(c.lane, sy), sy - 8 * sc, 7 * sc, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      // auto del jugador: sigue el carril con resorte (inercia + inclinacion)
      const psy = projY(eng.carY);
      const jumpArc = Math.sin(Math.PI * eng.jumpProgress());
      const px = laneCenterAt(visualLane, psy);
      const tilt = Math.max(-0.3, Math.min(0.3, laneVel * 1.5));
      // chispas de derrape mientras el auto se desliza por el piso
      if (!eng.airborne && !eng.over && Math.abs(laneVel) > 0.035) {
        const side = laneVel > 0 ? -1 : 1;
        particles.push({
          x: px + side * 16,
          y: psy + 16,
          vx: side * (0.5 + Math.random()),
          vy: 0.6 + Math.random() * 0.8,
          life: 12 + Math.floor(Math.random() * 8),
          max: 18,
          size: 2,
          color: Math.random() < 0.5 ? "#ffffff" : "#27e8ff",
        });
      }
      drawCar(px, psy, depthScale(psy), "#39ff7a", true, jumpArc, tilt);

      // lineas de velocidad cuando la cosa se pone rapida
      const spd = eng.speed();
      if (spd > 330) {
        const a = Math.min(1, (spd - 330) / 150) * 0.3;
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        speedLineOff = (speedLineOff + spd * 0.004) % 60;
        for (let i = 0; i < 5; i++) {
          const ly = HORIZON + 20 + ((i * 73 + speedLineOff * 9) % (HEIGHT - HORIZON - 40));
          const len = 16 + (i % 3) * 8;
          ctx.fillRect(8 + (i % 2) * 10, ly, 2, len);
          ctx.fillRect(WIDTH - 10 - (i % 2) * 10, ly, 2, len);
        }
      }

      // particulas
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08;
        p.life -= 1;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = p.life / p.max;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      // carteles flotantes (+1 moneda, SPEED UP)
      ctx.textAlign = "center";
      for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        p.y -= 0.5;
        p.life -= 1;
        if (p.life <= 0) {
          popups.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.min(1, p.life / 18);
        ctx.font = p.txt.startsWith("+")
          ? "bold 14px ui-sans-serif, system-ui"
          : "bold 20px ui-sans-serif, system-ui";
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.fillText(p.txt, p.x, p.y);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;

      // destello del choque
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,120,60,${(flash / 8) * 0.35})`;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        flash -= 1;
      }
      ctx.restore();

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
      const dt = Math.min(t - last, 100);
      last = t;
      const eng = engineRef.current!;
      // Paso fijo determinístico: aplica los cambios de carril y avanza por ticks.
      if (!eng.over) {
        acc += dt;
        while (acc >= STEP) {
          // Foto previa para detectar eventos del tick (despegue, aterrizaje,
          // monedas, subida de velocidad) sin tocar el motor.
          const prevAir = eng.airborne;
          const prevScore = eng.score;
          const prevPassed = eng.passedCount;
          while (pending.current.length) {
            const a = pending.current.shift()!;
            if (a === "l") eng.moveLeft();
            else if (a === "r") eng.moveRight();
            else eng.jump();
            inputs.current.push({ t: tickRef.current, a });
          }
          eng.update(RACING_DT);
          tickRef.current += 1;
          acc -= STEP;

          if (!prevAir && eng.airborne) sfx.jump();
          if (prevAir && !eng.airborne && !eng.over) {
            sfx.land();
            const psy = projY(eng.carY);
            burst(laneCenterAt(visualLane, psy), psy + 14, ["#ffffff", "#8a97a6"], 8, 0.7);
          }
          // monedas del tick: puntos que no vienen de obstaculos superados
          const coinsTaken = eng.score - prevScore - (eng.passedCount - prevPassed);
          if (coinsTaken > 0) {
            sfx.point();
            const psy = projY(eng.carY);
            const cxp = laneCenterAt(visualLane, psy);
            burst(cxp, psy - 20, ["#ffd23d", "#fff3a0"], 10, 0.9);
            popups.push({
              x: cxp,
              y: psy - 46,
              txt: `+${coinsTaken}`,
              life: 45,
              color: "#ffd23d",
            });
          }
          const lvl = Math.floor(eng.elapsedMs / 8000);
          if (lvl > prevLvl) {
            prevLvl = lvl;
            sfx.levelUp();
            popups.push({
              x: WIDTH / 2,
              y: HEIGHT / 2 - 40,
              txt: "SPEED UP!",
              life: 60,
              color: "#27e8ff",
            });
          }

          if (eng.over) break;
        }
      }

      // Resorte del carril visual (por frame): inercia + leve rebote.
      const targetLane = eng.carLane;
      laneVel = laneVel * 0.68 + (targetLane - visualLane) * 0.18;
      visualLane += laneVel;
      if (Math.abs(targetLane - visualLane) < 0.002 && Math.abs(laneVel) < 0.002) {
        visualLane = targetLane;
        laneVel = 0;
      }

      if (eng.score !== lastScore) {
        lastScore = eng.score;
        setScore(eng.score);
      }
      draw();
      if (eng.over) {
        // Choque: explosion, sacudida y un respiro antes del cartel de fin.
        if (deathWait < 0) {
          const psy = projY(eng.carY);
          const cxp = laneCenterAt(visualLane, psy);
          burst(cxp, psy, ["#ff7a3d", "#ffd23d", "#ff4d6d"], 26, 1.6);
          burst(cxp, psy, ["#ffffff", "#8a97a6"], 12, 1.1);
          flash = 8;
          shake = 14;
          deathWait = 45;
          sfx.crash();
        }
        deathWait -= 1;
        if (deathWait <= 0) {
          setOver(true);
          return;
        }
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
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        enqueue("l");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        enqueue("r");
      } else if (e.key === "ArrowUp" || e.key === " " || e.key === "w" || e.key === "W") {
        e.preventDefault();
        enqueue("j");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative overflow-hidden rounded-lg border-2 border-(--color-ink)"
        style={{ width: "min(86vw, 320px)" }}
        onPointerDown={(e) => (touch.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          if (!touch.current) return;
          const dy = e.clientY - touch.current.y;
          touch.current = null;
          if (dy < -24) enqueue("j");
        }}
      >
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="block h-auto w-full touch-none"
        />

        {!started && (
          <StartScreen
            icon={<GameIcon id="racing" size={56} />}
            title={t("g.racing.title")}
            instructions={t("g.racing.instr")}
            onStart={() => {
              ensureAudio();
              onStarted?.();
              setStarted(true);
            }}
          />
        )}

        {over && (
          <GameOverScreen
            headline={t("g.racing.over")}
            score={score}
            onConfirm={() =>
              onFinish({
                score,
                replay: { seed, ticks: tickRef.current, inputs: inputs.current, v: RACING_RULES_V },
              })
            }
          />
        )}
      </div>

      {/* Controles tactiles */}
      {started && !over && (
        <div className="grid w-full max-w-[320px] grid-cols-3 gap-3">
          <button
            onClick={() => enqueue("l")}
            aria-label="Mover a la izquierda"
            className="btn3d btn3d--cyan !text-2xl"
          >
            <span aria-hidden="true">◀</span>
          </button>
          <button
            onClick={() => enqueue("j")}
            aria-label="Saltar"
            className="btn3d btn3d--cyan !text-2xl"
          >
            <span aria-hidden="true">⤒</span>
          </button>
          <button
            onClick={() => enqueue("r")}
            aria-label="Mover a la derecha"
            className="btn3d btn3d--cyan !text-2xl"
          >
            <span aria-hidden="true">▶</span>
          </button>
        </div>
      )}

      <p className="font-screen text-center text-base text-(--color-muted-3)">
        {t("g.racing.hint")}
      </p>
    </div>
  );
}
