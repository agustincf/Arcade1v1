"use client";

import { use, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getGame } from "@/app/lib/games";
import { getPayout } from "@/app/lib/config";
import { TetrisGame, type TetrisResult } from "@/app/games/tetris/TetrisGame";
import { FlappyGame, type FlappyResult } from "@/app/games/flappy/FlappyGame";
import { RacingGame, type RacingResult } from "@/app/games/racing/RacingGame";

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
  const bet = Number(search.get("bet") ?? 0);
  const payout = getPayout(bet);

  const seed = useMemo(() => Math.floor(Math.random() * 1_000_000_000), []);

  const [youScore, setYouScore] = useState<number | null>(null);
  const [rivalScore, setRivalScore] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  if (!game) return null;

  function finishMatch(myScore: number) {
    const rival = Math.max(0, Math.round(myScore * (0.6 + Math.random() * 0.9)));
    setYouScore(myScore);
    setRivalScore(rival);
    setOutcome(myScore > rival ? "win" : myScore < rival ? "lose" : "draw");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="font-screen text-xl text-[--color-accent-2] hover:underline">
        ← Salir
      </Link>

      {/* Marcador */}
      <div className="win mt-3">
        <div className="win-title">
          <span>{game.name.toUpperCase()} · MESA {bet} USDC</span>
          <span className="chip !text-[--color-gold]">POZO {payout.pot}</span>
        </div>
        <div className="flex items-center justify-between p-4">
          <ScoreSide label="VOS" emoji="🙂" score={youScore} />
          <span className="font-pixel text-base text-[--color-gold] blink">VS</span>
          <ScoreSide label="RIVAL" emoji="👤" score={rivalScore} right />
        </div>
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
            <TetrisGame seed={seed} onFinish={(r: TetrisResult) => finishMatch(r.score)} />
          ) : game.id === "flappy" ? (
            <FlappyGame seed={seed} onFinish={(r: FlappyResult) => finishMatch(r.score)} />
          ) : game.id === "racing" ? (
            <RacingGame seed={seed} onFinish={(r: RacingResult) => finishMatch(r.score)} />
          ) : (
            <p className="font-screen py-10 text-center text-xl text-slate-400">
              Este juego todavía no está disponible.
            </p>
          )}
        </div>
      </div>

      {/* Dialogo de resultado */}
      {outcome !== null && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4">
          <div className="win w-full max-w-sm">
            <div
              className={`win-title ${outcome === "win" ? "" : outcome === "lose" ? "win-title--cyan" : "win-title--cyan"}`}
            >
              <span>RESULTADO.EXE</span>
              <span className="win-dots">
                <span className="win-dot" />
              </span>
            </div>
            <div className="p-6 text-center">
              <div className="text-6xl">
                {outcome === "win" ? "🏆" : outcome === "lose" ? "💀" : "🤝"}
              </div>
              <h2
                className={`font-pixel mt-3 text-lg ${
                  outcome === "win"
                    ? "text-[--color-win]"
                    : outcome === "lose"
                      ? "text-[--color-lose]"
                      : "text-slate-100"
                }`}
              >
                {outcome === "win" ? "¡GANASTE!" : outcome === "lose" ? "PERDISTE" : "EMPATE"}
              </h2>

              {/* Puntajes */}
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

              {/* Dinero */}
              <div className="win mt-5">
                <div className="win-title">
                  <span>CAJA.LOG</span>
                </div>
                <div className="font-screen p-4 text-lg">
                  {outcome === "win" && (
                    <>
                      <Money label="Pozo" value={`${payout.pot} USDC`} />
                      <Money label="Comisión (10%)" value={`- ${payout.fee} USDC`} />
                      <div className="my-2 border-t-2 border-dashed border-[--color-border]" />
                      <div className="flex justify-between">
                        <span className="text-slate-300">Cobrás</span>
                        <span className="font-pixel text-sm text-[--color-win]">
                          {payout.prize} USDC
                        </span>
                      </div>
                    </>
                  )}
                  {outcome === "lose" && (
                    <p className="text-slate-300">
                      Esta vez se llevó {bet} USDC. La revancha te espera. 😤
                    </p>
                  )}
                  {outcome === "draw" && (
                    <p className="text-slate-300">
                      Empate: se devuelve {bet} USDC a cada uno (sin comisión).
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => router.push(`/game/${gameId}`)}
                  className="btn3d btn3d--magenta flex-1"
                >
                  REVANCHA
                </button>
                <button
                  onClick={() => router.push("/")}
                  className="btn3d btn3d--cyan flex-1"
                >
                  INICIO
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreSide({
  label,
  emoji,
  score,
  right,
}: {
  label: string;
  emoji: string;
  score: number | null;
  right?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${right ? "flex-row-reverse" : ""}`}>
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-[#0a0518] bg-[--color-surface-2] text-xl">
        {emoji}
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
