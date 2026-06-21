"use client";

import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getGame } from "@/app/lib/games";
import { getPayout, PLATFORM_FEE } from "@/app/lib/config";
import { GameIcon } from "@/app/components/GameIcon";
import { TetrisGame, type TetrisResult } from "@/app/games/tetris/TetrisGame";
import { FlappyGame, type FlappyResult } from "@/app/games/flappy/FlappyGame";
import { RacingGame, type RacingResult } from "@/app/games/racing/RacingGame";
import { Game2048Component, type Result2048 } from "@/app/games/g2048/Game2048";

type Outcome = "win" | "lose" | "draw" | null;

export default function MatchPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = use(params);
  const game = getGame(gameId);
  const router = useRouter();
  const search = useSearchParams();
  const free = search.get("free") === "1";
  const bet = Number(search.get("bet") ?? 0);
  const payout = getPayout(bet);

  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [round, setRound] = useState(0); // para reiniciar el juego en "jugar de nuevo"
  const [playing, setPlaying] = useState(false);
  const [youScore, setYouScore] = useState<number | null>(null);
  const [rivalScore, setRivalScore] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [freeDone, setFreeDone] = useState(false);
  const [forfeit, setForfeit] = useState(false);

  // Aviso del navegador si intenta cerrar/recargar con la partida (de plata) en curso.
  useEffect(() => {
    if (free) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (playing && outcome === null) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [playing, outcome, free]);

  if (!game) return null;

  function finishMatch(score: number) {
    setPlaying(false);
    setYouScore(score);
    if (free) {
      setFreeDone(true);
      return;
    }
    const rival = Math.max(0, Math.round(score * (0.6 + Math.random() * 0.9)));
    setRivalScore(rival);
    setOutcome(score > rival ? "win" : score < rival ? "lose" : "draw");
  }

  // Salir de la pantalla. Si abandonás una partida de plata empezada -> perdés.
  function handleExit() {
    if (free || !playing || outcome !== null) {
      router.push("/");
      return;
    }
    const ok = window.confirm(
      "Si salís ahora ABANDONÁS la partida y perdés: el pozo va para tu rival. ¿Salir igual?",
    );
    if (!ok) return;
    setPlaying(false);
    setForfeit(true);
    setRivalScore(youScore ?? 0);
    setOutcome("lose");
  }

  function replayFree() {
    setSeed(Math.floor(Math.random() * 1e9));
    setRound((r) => r + 1);
    setYouScore(null);
    setFreeDone(false);
    setPlaying(false);
  }

  const gameProps = {
    seed,
    onStarted: () => setPlaying(true),
  };

  return (
    <div className="mx-auto max-w-2xl">
      <button
        onClick={handleExit}
        className="font-screen text-xl text-[--color-accent-2] hover:underline"
      >
        ← Salir
      </button>

      {/* Marcador */}
      <div className="win mt-3">
        <div className="win-title">
          <span>
            {game.name.toUpperCase()} · {free ? "MODO LIBRE" : `MESA ${bet} USDC`}
          </span>
          {free ? (
            <span className="chip !text-[--color-lime]">GRATIS</span>
          ) : (
            <span className="chip !text-[--color-gold]">POZO {payout.pot}</span>
          )}
        </div>
        {!free && (
          <div className="flex items-center justify-between p-4">
            <ScoreSide label="VOS" score={youScore} />
            <span className="font-pixel text-base text-[--color-gold] blink">VS</span>
            <ScoreSide label="RIVAL" score={rivalScore} right />
          </div>
        )}
        {free && (
          <p className="font-screen px-4 py-3 text-center text-lg text-slate-300">
            Probá el juego gratis, sin apostar. Cuando quieras, jugá por USDC.
          </p>
        )}
      </div>

      {/* Area de juego */}
      <div className="win mt-4">
        <div className="win-title win-title--cyan">
          <span>JUGANDO.EXE</span>
          <span className="win-dots">
            <span className="win-dot" />
            <span className="win-dot" />
          </span>
        </div>
        <div className="p-5">
          {game.id === "tetris" ? (
            <TetrisGame key={round} {...gameProps} onFinish={(r: TetrisResult) => finishMatch(r.score)} />
          ) : game.id === "flappy" ? (
            <FlappyGame key={round} {...gameProps} onFinish={(r: FlappyResult) => finishMatch(r.score)} />
          ) : game.id === "racing" ? (
            <RacingGame key={round} {...gameProps} onFinish={(r: RacingResult) => finishMatch(r.score)} />
          ) : game.id === "2048" ? (
            <Game2048Component key={round} {...gameProps} onFinish={(r: Result2048) => finishMatch(r.score)} />
          ) : (
            <p className="font-screen py-10 text-center text-xl text-slate-400">
              Este juego todavía no está disponible.
            </p>
          )}
        </div>
      </div>

      {!free && (
        <p className="font-screen mt-3 text-center text-base text-slate-500">
          Te emparejamos con un rival por orden de llegada. Si nadie aparece en 1
          hora, se te devuelve todo.
        </p>
      )}

      {/* Resultado MODO LIBRE */}
      {freeDone && (
        <Modal>
          <div className="flex justify-center">
            <GameIcon id={game.id} size={56} />
          </div>
          <h2 className="font-pixel mt-3 text-lg text-[--color-accent-2] neon-cyan">
            ¡BUEN INTENTO!
          </h2>
          <p className="font-screen mt-3 text-xl text-slate-200">Tu puntaje</p>
          <p className="font-pixel text-3xl text-[--color-gold]">{youScore}</p>
          <p className="font-screen mt-3 text-lg text-slate-300">
            ¿Listo para jugártelo en serio? Apostá y ganá USDC de verdad.
          </p>
          <div className="mt-5 flex flex-col gap-3">
            <button
              onClick={() => router.push(`/game/${gameId}`)}
              className="btn3d btn3d--magenta w-full"
            >
              💰 JUGAR POR USDC
            </button>
            <div className="flex gap-3">
              <button onClick={replayFree} className="btn3d btn3d--cyan flex-1">
                JUGAR DE NUEVO
              </button>
              <button
                onClick={() => router.push("/")}
                className="btn3d btn3d--cyan flex-1"
              >
                INICIO
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Resultado partida de plata */}
      {outcome !== null && (
        <Modal>
          <div className="text-6xl">
            {forfeit ? "🏳️" : outcome === "win" ? "🏆" : outcome === "lose" ? "💀" : "🤝"}
          </div>
          <h2
            className={`font-pixel mt-3 text-lg ${
              outcome === "win" ? "text-[--color-win]" : outcome === "draw" ? "text-slate-100" : "text-[--color-lose]"
            }`}
          >
            {forfeit ? "ABANDONASTE" : outcome === "win" ? "¡GANASTE!" : outcome === "lose" ? "PERDISTE" : "EMPATE"}
          </h2>

          {forfeit ? (
            <p className="font-screen mt-4 text-lg text-slate-300">
              Dejaste la partida. El pozo de {payout.pot} USDC va para tu rival.
            </p>
          ) : (
            <>
              <div className="font-screen mt-4 flex items-center justify-center gap-6 text-xl">
                <div>
                  <div className="text-slate-400">VOS</div>
                  <div className="font-pixel text-base text-[--color-accent-2]">{youScore}</div>
                </div>
                <div className="text-slate-500">vs</div>
                <div>
                  <div className="text-slate-400">RIVAL</div>
                  <div className="font-pixel text-base text-slate-200">{rivalScore}</div>
                </div>
              </div>
              <div className="win mt-5">
                <div className="win-title"><span>CAJA.LOG</span></div>
                <div className="font-screen p-4 text-lg">
                  {outcome === "win" && (
                    <>
                      <Money label="Pozo" value={`${payout.pot} USDC`} />
                      <Money label={`Comisión (${PLATFORM_FEE * 100}%)`} value={`- ${payout.fee} USDC`} />
                      <div className="my-2 border-t-2 border-dashed border-[--color-border]" />
                      <div className="flex justify-between">
                        <span className="text-slate-300">Cobrás</span>
                        <span className="font-pixel text-sm text-[--color-win]">{payout.prize} USDC</span>
                      </div>
                    </>
                  )}
                  {outcome === "lose" && (
                    <p className="text-slate-300">Esta vez se llevó {bet} USDC. La revancha te espera. 😤</p>
                  )}
                  {outcome === "draw" && (
                    <p className="text-slate-300">Empate: se devuelve {bet} USDC a cada uno (sin comisión).</p>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="mt-5 flex gap-3">
            {!forfeit && (
              <button onClick={() => router.push(`/game/${gameId}`)} className="btn3d btn3d--magenta flex-1">
                REVANCHA
              </button>
            )}
            <button onClick={() => router.push("/")} className="btn3d btn3d--cyan flex-1">
              INICIO
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4">
      <div className="win w-full max-w-sm">
        <div className="win-title">
          <span>RESULTADO.EXE</span>
          <span className="win-dots">
            <span className="win-dot" />
          </span>
        </div>
        <div className="p-6 text-center">{children}</div>
      </div>
    </div>
  );
}

function ScoreSide({
  label,
  score,
  right,
}: {
  label: string;
  score: number | null;
  right?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${right ? "flex-row-reverse" : ""}`}>
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-[#0a0518] bg-[--color-surface-2] text-xl">
        {right ? "👤" : "🙂"}
      </div>
      <div className={right ? "text-right" : ""}>
        <div className="font-pixel text-[10px] text-slate-400">{label}</div>
        <div className="font-pixel text-base text-[--color-gold]">{score ?? "--"}</div>
      </div>
    </div>
  );
}

function Money({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-100">{value}</span>
    </div>
  );
}
