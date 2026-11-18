"use client";

import { useEffect, useRef, useState } from "react";
import {
  InvadersEngine,
  INVADERS_CONST,
  INVADERS_DT,
  type InvaderAction,
  type ReplayInvaders,
} from "@arcade1v1/game-sdk/invaders";
import { LiveSession } from "@arcade1v1/game-sdk/live-play";
import { invadersLive } from "@arcade1v1/game-sdk/invaders-live";
import { StartScreen, GameOverScreen } from "@/app/games/_shared/ui";
import { sfx, ensureAudio } from "@/app/lib/sound";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";
import { dtCap } from "@/app/games/_shared/strict";
import { heldDiff, liveErrorReason, type LiveController } from "@/app/lib/live";
import {
  ROW_COLOR,
  drawAlien,
  drawShip,
  drawUfo,
  drawShieldBlock,
  drawBullet,
  drawBomb,
} from "./sprites";
import { PixelIcon } from "@/app/components/PixelIcon";

const { WIDTH, HEIGHT, ALIEN_W, ALIEN_H, PLAYER_Y, BULLET_H, BOMB_H, UFO_W, UFO_H, UFO_Y } =
  INVADERS_CONST;
const STEP = INVADERS_DT * 1000;
// Puntaje por fila, SOLO para los carteles flotantes (la verdad vive en el motor).
const ROW_POINTS = [30, 20, 15, 10];
// Estrellas de fondo (posiciones fijas, titilan por seno).
const STARS = Array.from({ length: 44 }, (_, i) => ({
  x: (i * 71) % WIDTH,
  y: (i * 137) % HEIGHT,
  s: (i % 3) + 1,
  ph: (i * 0.7) % (Math.PI * 2),
}));

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}
interface Popup {
  x: number;
  y: number;
  txt: string;
  life: number;
}

/** Con semilla: el replay para enviar. En vivo: el puntaje ya lo confirmó el
 *  árbitro, y vuelve todo lo revelado para comprobar el secreto al decidirse. */
export type InvadersResult =
  | { score: number; replay: ReplayInvaders; live?: undefined }
  | { score: number; replay?: undefined; live: { reveals: number[] } };

export function InvadersGame({
  seed,
  live,
  onFinish,
  onStarted,
  onAttemptClosed,
  strict,
}: {
  /** Práctica o partida con semilla (reglas v1). */
  seed?: number;
  /** Partida EN VIVO: cada bloque de azar llega del árbitro (ver LiveSession). */
  live?: LiveController;
  onFinish: (result: InvadersResult) => void;
  onStarted?: () => void;
  /** En vivo: el árbitro cerró el intento (el puntaje ya quedó anotado), antes
   *  de que el jugador confirme el cartel de fin. */
  onAttemptClosed?: () => void;
  /** Mesa de plata: sin pausa y con puesta al día tras un alt-tab. */
  strict?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<InvadersEngine | null>(null);
  // En vivo el motor nace con la sesión, al abrir el intento.
  if (engineRef.current === null && !live) engineRef.current = new InvadersEngine(seed ?? 0);
  const sessionRef = useRef<LiveSession<InvadersEngine> | null>(null);

  const { t } = useT();
  // El bucle lee el modo por ref: cambiar de prop no debe reiniciar la partida.
  const strictRef = useRef(!!strict);
  strictRef.current = !!strict;
  // Avisos del modo en vivo, dibujados en el canvas (por ref: cambiar de idioma
  // no debe reiniciar la partida).
  const connectingRef = useRef(t("g.invaders.liveConnecting"));
  connectingRef.current = t("g.invaders.liveConnecting");
  const confirmingRef = useRef(t("g.invaders.liveConfirming"));
  confirmingRef.current = t("g.invaders.liveConfirming");
  const onAttemptClosedRef = useRef(onAttemptClosed);
  onAttemptClosedRef.current = onAttemptClosed;
  const [started, setStarted] = useState(false);
  const [over, setOver] = useState(false);
  const [score, setScore] = useState(0);
  // En vivo: abriendo el intento (firma), por qué no se pudo abrir y si la
  // sesión se desincronizó del árbitro.
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<{
    key: string;
    vars?: Record<string, string | number>;
  } | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  const inputs = useRef<{ t: number; a: InvaderAction }[]>([]);
  const tickRef = useRef(0);
  const pending = useRef<InvaderAction[]>([]);
  const keys = useRef({ left: false, right: false, fire: false });

  /** Apretar o soltar una tecla. Con semilla se anota el cambio tal cual (el
   *  replay de siempre); en vivo el bucle manda en cada tick la diferencia entre
   *  estas teclas y las del motor (`heldDiff`). */
  function press(key: "left" | "right" | "fire", on: boolean) {
    keys.current[key] = on;
    if (!engineRef.current || engineRef.current.over) return;
    const k = key === "left" ? "l" : key === "right" ? "r" : "f";
    pending.current.push(`${k}${on ? 1 : 0}` as InvaderAction);
  }

  useEffect(() => {
    if (!started) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastScore = -1;

    // --- Estado visual (fuera del motor: no toca el replay) ---
    const particles: Particle[] = [];
    const popups: Popup[] = [];
    let shake = 0; // frames de sacudida
    let flash = 0; // frames de destello rojo
    let muzzle = 0; // frames de fogonazo del cañon
    let waveBanner = 0; // frames del cartel de oleada
    let beatCount = 0; // latido de la formacion
    let beatNote = 0;
    // En vivo: desde cuándo falta el azar del próximo tick, qué aviso mostrar y
    // si ya se avisó que el árbitro cerró el intento.
    let stalledSince: number | null = null;
    let liveNotice: "connecting" | "confirming" | null = null;
    let closedNotified = false;
    let ended = false;

    function boom(x: number, y: number, color: string, n: number, force = 1) {
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const v = (0.6 + Math.random() * 1.8) * force;
        const life = 18 + Math.floor(Math.random() * 14);
        particles.push({
          x,
          y,
          vx: Math.cos(ang) * v,
          vy: Math.sin(ang) * v - 0.4,
          life,
          max: life,
          size: Math.random() < 0.3 ? 3 : 2,
          color,
        });
      }
    }

    // Diffs de estado alrededor de cada tick para disparar efectos y sonidos.
    function runTick() {
      const eng = engineRef.current!;
      const prevAliens = eng.aliveAliens();
      const prevShields = eng.shields.slice();
      const prevLives = eng.lives;
      const prevWave = eng.wave;
      const prevUfo = eng.ufo ? { x: eng.ufo.x } : null;
      const prevScore = eng.score;
      const prevBullets = eng.bullets.length;

      const session = sessionRef.current;
      if (session) {
        // La sesión aplica las teclas que cambiaron (con los topes del juego),
        // las anota y compromete en segundo plano.
        session.step(heldDiff(keys.current, eng.held));
        tickRef.current = session.tick;
      } else {
        eng.tick();
        tickRef.current += 1;
      }

      // Disparo concretado (salio una bala nueva del cañon)
      if (eng.bullets.length > prevBullets) {
        sfx.shoot();
        muzzle = 3;
      }

      // Aliens caidos: buscar cual de los previos ya no esta (la formacion se
      // mueve <2px por tick, alcanza con aparear por fila + distancia).
      const post = eng.aliveAliens();
      for (const a of prevAliens) {
        const sigue = post.some(
          (b) => b.row === a.row && Math.abs(b.x - a.x) < 8 && Math.abs(b.y - a.y) < 12,
        );
        if (!sigue && eng.wave === prevWave) {
          const cx = a.x + ALIEN_W / 2;
          const cy = a.y + ALIEN_H / 2;
          boom(cx, cy, ROW_COLOR[a.row % ROW_COLOR.length], 16);
          popups.push({ x: cx, y: cy, txt: `+${ROW_POINTS[a.row] ?? 10}`, life: 45 });
          sfx.zap();
        }
      }

      // OVNI derribado (desaparecio Y hubo puntos; si sale de pantalla no suma)
      if (prevUfo && !eng.ufo && eng.score >= prevScore + 100) {
        const cx = prevUfo.x + UFO_W / 2;
        boom(cx, UFO_Y + UFO_H / 2, "#ff3df0", 30, 1.5);
        boom(cx, UFO_Y + UFO_H / 2, "#ffd23d", 14, 1.2);
        popups.push({ x: cx, y: UFO_Y + UFO_H, txt: "+100", life: 60 });
        sfx.ufoHit();
      }

      // Bloques de escudo rotos
      if (eng.shields.length < prevShields.length && eng.wave === prevWave) {
        const postSet = new Set(eng.shields);
        for (const s of prevShields) if (!postSet.has(s)) boom(s.x + 2, s.y + 2, "#2fd167", 6, 0.7);
      }

      // Golpe al jugador
      if (eng.lives < prevLives) {
        boom(eng.playerX, PLAYER_Y + 6, "#39ff7a", 26, 1.6);
        boom(eng.playerX, PLAYER_Y + 6, "#ffffff", 10, 1.2);
        shake = 14;
        flash = 10;
        sfx.hitPlayer();
      }

      // Oleada nueva
      if (eng.wave > prevWave) {
        waveBanner = 110;
        sfx.clear();
      }

      // Latido clasico: mas rapido cuanto menos aliens quedan
      const alive = post.length || 1;
      beatCount += 1;
      if (beatCount >= 10 + alive * 2.2) {
        beatCount = 0;
        beatNote = 1 - beatNote;
        sfx.beat(beatNote);
      }
      // Zumbido periodico del OVNI en vuelo
      if (eng.ufo && tickRef.current % 16 === 0) sfx.ufoBlip();
    }

    const drawBackground = (tick: number) => {
      const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
      bg.addColorStop(0, "#05020f");
      bg.addColorStop(0.6, "#0a0518");
      bg.addColorStop(1, "#140a2e");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      // nebulosas tenues
      let neb = ctx.createRadialGradient(70, 130, 0, 70, 130, 120);
      neb.addColorStop(0, "rgba(255,61,240,0.07)");
      neb.addColorStop(1, "rgba(255,61,240,0)");
      ctx.fillStyle = neb;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      neb = ctx.createRadialGradient(260, 320, 0, 260, 320, 140);
      neb.addColorStop(0, "rgba(39,232,255,0.06)");
      neb.addColorStop(1, "rgba(39,232,255,0)");
      ctx.fillStyle = neb;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      // estrellas titilantes
      for (const st of STARS) {
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(tick * 0.02 + st.ph));
        ctx.fillStyle = st.s === 3 ? `rgba(214,205,255,${tw})` : `rgba(109,94,252,${tw})`;
        ctx.fillRect(st.x, st.y, st.s, st.s);
      }
      // planeta lejano con anillo
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#43308f";
      ctx.beginPath();
      ctx.arc(284, 84, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#6d5efc";
      ctx.beginPath();
      ctx.arc(280, 80, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#8f7bff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(284, 84, 20, 5, -0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };

    const draw = () => {
      const eng = engineRef.current!;
      const tick = tickRef.current;
      const frame = Math.floor(tick / 22) % 2;

      ctx.save();
      if (shake > 0) {
        ctx.translate((Math.random() - 0.5) * shake * 0.7, (Math.random() - 0.5) * shake * 0.7);
        shake -= 1;
      }

      drawBackground(tick);

      // OVNI bonus
      if (eng.ufo) drawUfo(ctx, eng.ufo.x, UFO_Y, tick);
      // formacion
      for (const al of eng.aliveAliens()) drawAlien(ctx, al.x, al.y, al.row, frame);
      // escudos
      for (const s of eng.shields) drawShieldBlock(ctx, s.x, s.y);
      // proyectiles
      for (const b of eng.bullets) drawBullet(ctx, b.x, b.y, BULLET_H);
      for (const b of eng.bombs) drawBomb(ctx, b.x, b.y, BOMB_H, (tick >> 2) & 1);
      // nave + fogonazo
      drawShip(ctx, eng.playerX, PLAYER_Y);
      if (muzzle > 0) {
        ctx.fillStyle = `rgba(255,255,255,${muzzle / 3})`;
        ctx.beginPath();
        ctx.arc(eng.playerX, PLAYER_Y - 6, 3 + muzzle, 0, Math.PI * 2);
        ctx.fill();
        muzzle -= 1;
      }
      // linea de piso
      ctx.fillStyle = "rgba(57,255,122,0.5)";
      ctx.fillRect(0, HEIGHT - 6, WIDTH, 1);

      // particulas
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.04;
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

      // carteles flotantes de puntaje
      ctx.textAlign = "center";
      ctx.font = "bold 11px ui-sans-serif, system-ui";
      for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        p.y -= 0.35;
        p.life -= 1;
        if (p.life <= 0) {
          popups.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.min(1, p.life / 20);
        ctx.fillStyle = "#ffd23d";
        ctx.fillText(p.txt, p.x, p.y);
      }
      ctx.globalAlpha = 1;

      // HUD
      ctx.textAlign = "left";
      ctx.fillStyle = "#8b80c9";
      ctx.font = "bold 8px ui-sans-serif, system-ui";
      ctx.fillText("SCORE", 8, 12);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 15px ui-sans-serif, system-ui";
      ctx.fillText(String(eng.score), 8, 27);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd23d";
      ctx.font = "bold 11px ui-sans-serif, system-ui";
      ctx.fillText(`WAVE ${eng.wave}`, WIDTH / 2, 14);
      // vidas como mini-naves
      for (let i = 0; i < eng.lives; i++) {
        const lx = WIDTH - 16 - i * 15;
        ctx.fillStyle = "#39ff7a";
        ctx.beginPath();
        ctx.moveTo(lx - 5, 15);
        ctx.lineTo(lx, 8);
        ctx.lineTo(lx + 5, 15);
        ctx.closePath();
        ctx.fill();
      }

      // cartel de oleada nueva
      if (waveBanner > 0) {
        const a = waveBanner > 90 ? (110 - waveBanner) / 20 : Math.min(1, waveBanner / 30);
        ctx.globalAlpha = a;
        ctx.fillStyle = "#ffd23d";
        ctx.font = "bold 26px ui-sans-serif, system-ui";
        ctx.shadowColor = "#ffd23d";
        ctx.shadowBlur = 16;
        ctx.fillText(`WAVE ${eng.wave}`, WIDTH / 2, HEIGHT / 2 - 10);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        waveBanner -= 1;
      }

      // destello al recibir un golpe
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,77,109,${(flash / 10) * 0.28})`;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        flash -= 1;
      }

      if (liveNotice) {
        ctx.fillStyle = "rgba(5,2,15,0.7)";
        ctx.fillRect(0, HEIGHT / 2 + 14, WIDTH, 34);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 14px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText(
          liveNotice === "connecting" ? connectingRef.current : confirmingRef.current,
          WIDTH / 2,
          HEIGHT / 2 + 36,
        );
      }
      ctx.restore();
    };

    const loop = (tnow: number) => {
      const dt = Math.min(tnow - last, dtCap(strictRef.current));
      last = tnow;
      const eng = engineRef.current!;
      const session = sessionRef.current;
      if (!eng.over && !session?.result && !session?.error) {
        acc += dt;
        while (acc >= STEP) {
          // EN VIVO: sin el azar del próximo tick no se avanza. El juego se
          // congela (y avisa) en vez de adelantarse de golpe cuando llega.
          if (session && !session.canStep()) {
            acc = Math.min(acc, STEP);
            if (stalledSince === null) stalledSince = tnow;
            break;
          }
          stalledSince = null;
          if (session) {
            // En vivo mandan las teclas apretadas (ver `press`), no la cola.
            pending.current.length = 0;
          } else {
            while (pending.current.length) {
              const a = pending.current.shift()!;
              eng.apply(a);
              inputs.current.push({ t: tickRef.current, a });
            }
          }
          runTick();
          acc -= STEP;
          if (eng.over) break;
        }
      }

      // En vivo: compromete en segundo plano; al terminar, pide el cierre.
      session?.pump();
      if (session?.result && !closedNotified) {
        closedNotified = true;
        onAttemptClosedRef.current?.();
      }
      liveNotice =
        !session || session.error
          ? null
          : eng.over && !session.result
            ? "confirming"
            : stalledSince !== null && tnow - stalledSince > 300
              ? "connecting"
              : null;

      if (eng.score !== lastScore) {
        lastScore = eng.score;
        setScore(eng.score);
      }
      draw();
      if (eng.over || session?.result || session?.error) {
        if (!ended) {
          ended = true;
          if (eng.over) sfx.crash();
        }
        // En vivo el cartel espera el cierre del árbitro: su puntaje manda. Si
        // la sesión se cortó, no hay puntaje que confirmar: el intento sigue
        // abierto en el árbitro y se retoma recargando (ver el aviso de abajo).
        if (session?.error) {
          setLiveError(liveErrorReason(session.error.message));
          return;
        }
        if (!session || session.result) {
          if (session?.result) setScore(session.result.score);
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

  useEffect(() => {
    if (!started) return;
    function onDownKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (!keys.current.left) press("left", true);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!keys.current.right) press("right", true);
      } else if (e.key === " ") {
        e.preventDefault();
        if (!keys.current.fire) press("fire", true); // mantener apretado = disparo automatico
      }
    }
    function onUpKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") press("left", false);
      else if (e.key === "ArrowRight") press("right", false);
      else if (e.key === " ") press("fire", false);
    }
    window.addEventListener("keydown", onDownKey);
    window.addEventListener("keyup", onUpKey);
    return () => {
      window.removeEventListener("keydown", onDownKey);
      window.removeEventListener("keyup", onUpKey);
    };
  }, [started]);

  // EMPEZAR. En vivo primero se abre el intento (la página firma y llama al
  // árbitro); recién con eso arranca la partida.
  async function begin() {
    ensureAudio();
    if (live) {
      if (opening) return;
      setOpening(true);
      setOpenError(null);
      try {
        const start = await live.open();
        const session = new LiveSession(invadersLive, start, live.commit);
        sessionRef.current = session;
        engineRef.current = session.engine;
        tickRef.current = session.tick;
      } catch (e) {
        setOpenError(live.describeError(e));
        return;
      } finally {
        setOpening(false);
      }
    }
    onStarted?.();
    setStarted(true);
  }

  // Botones tactiles: mantener para mover, tocar para disparar.
  const hold = (key: "left" | "right" | "fire") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      press(key, true);
    },
    onPointerUp: () => press(key, false),
    onPointerLeave: () => press(key, false),
  });

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative overflow-hidden rounded-lg border-2 border-(--color-ink)"
        style={{ width: "min(100%, 320px)" }}
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
            instructions={
              opening
                ? t("g.invaders.liveSign")
                : openError
                  ? t(openError.key, openError.vars)
                  : t("g.invaders.instr")
            }
            onStart={() => void begin()}
          />
        )}
        {over && (
          <GameOverScreen
            headline={t("g.invaders.over")}
            score={score}
            recorded={!!live}
            onConfirm={() => {
              const session = sessionRef.current;
              if (session) onFinish({ score, live: { reveals: session.reveals } });
              else
                onFinish({
                  score,
                  replay: { seed: seed ?? 0, ticks: tickRef.current, inputs: inputs.current },
                });
            }}
          />
        )}
      </div>

      {started && !over && (
        <div className="grid w-full max-w-[320px] grid-cols-3 gap-2">
          <button
            {...hold("left")}
            aria-label="Mover a la izquierda"
            className="btn3d btn3d--cyan !text-2xl"
          >
            <span aria-hidden="true">◀</span>
          </button>
          <button {...hold("fire")} aria-label="Disparar" className="btn3d btn3d--magenta !text-xl">
            <PixelIcon name="cannon" px={2} />
          </button>
          <button
            {...hold("right")}
            aria-label="Mover a la derecha"
            className="btn3d btn3d--cyan !text-2xl"
          >
            <span aria-hidden="true">▶</span>
          </button>
        </div>
      )}

      {liveError && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-center text-sm wrap-anywhere text-(--color-lose)">
            {t("g.invaders.liveError", { reason: liveError })}
          </p>
          <button className="btn3d btn3d--cyan" onClick={() => window.location.reload()}>
            {t("g.invaders.liveReload")}
          </button>
        </div>
      )}
      <p className="font-screen text-center text-base text-(--color-muted-3)">
        {t("g.invaders.hint")}
      </p>
    </div>
  );
}
