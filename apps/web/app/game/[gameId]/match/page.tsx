"use client";

import { use, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getGame } from "@/app/lib/games";
import { getPayout } from "@/app/lib/config";
import { TetrisGame, type TetrisResult } from "@/app/games/tetris/TetrisGame";

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

  // Semilla compartida: en la partida real, los dos jugadores reciben la misma
  // (mismas piezas para ambos). Por ahora se genera una al azar para la demo.
  const seed = useMemo(() => Math.floor(Math.random() * 1_000_000_000), []);

  const [youScore, setYouScore] = useState<number | null>(null);
  const [rivalScore, setRivalScore] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  if (!game) return null;

  // Cuando el jugador termina su intento: se simula el rival y se decide.
  function finishMatch(myScore: number) {
    const rival = Math.max(0, Math.round(myScore * (0.6 + Math.random() * 0.9)));
    setYouScore(myScore);
    setRivalScore(rival);
    setOutcome(myScore > rival ? "win" : myScore < rival ? "lose" : "draw");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm text-slate-400 hover:text-white">
        ← Salir
      </Link>

      {/* Marcador */}
      <div className="mt-3 flex items-center justify-between rounded-2xl border border-[--color-border] bg-[--color-surface] px-6 py-4">
        <ScoreSide label="Vos" emoji="🙂" score={youScore} />
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {game.name}
          </div>
          <div className="text-xs text-amber-300">Pozo {payout.pot} USDC</div>
        </div>
        <ScoreSide label="Rival" emoji="👤" score={rivalScore} right />
      </div>

      {/* Area de juego */}
      <div className="mt-5">
        {game.id === "tetris" ? (
          <div className="rounded-2xl border border-[--color-border] bg-[--color-surface]/50 p-5">
            <TetrisGame seed={seed} onFinish={(r: TetrisResult) => finishMatch(r.score)} />
          </div>
        ) : (
          // Flappy todavia no esta hecho (Fase 3): placeholder + simulacion.
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-[--color-border] bg-[--color-surface]/50 p-8 text-center">
            <div className="text-6xl">{game.emoji}</div>
            <p className="mt-4 max-w-sm text-slate-400">
              El juego de <b>{game.name}</b> se construye en la Fase 3.
            </p>
            {outcome === null && (
              <button
                onClick={() => finishMatch(Math.floor(Math.random() * 50))}
                className="mt-6 rounded-xl bg-[--color-accent] px-6 py-3 font-semibold text-white hover:opacity-90"
              >
                Simular resultado
              </button>
            )}
          </div>
        )}
      </div>

      {/* Modal de resultado */}
      {outcome !== null && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[--color-border] bg-[--color-surface] p-8 text-center">
            <div className="text-6xl">
              {outcome === "win" ? "🏆" : outcome === "lose" ? "😞" : "🤝"}
            </div>
            <h2
              className={`mt-4 text-2xl font-extrabold ${
                outcome === "win"
                  ? "text-[--color-win]"
                  : outcome === "lose"
                    ? "text-[--color-lose]"
                    : "text-slate-200"
              }`}
            >
              {outcome === "win"
                ? "¡Ganaste!"
                : outcome === "lose"
                  ? "Perdiste"
                  : "Empate"}
            </h2>

            {/* Puntajes */}
            <div className="mt-4 flex items-center justify-center gap-6 text-sm">
              <div>
                <div className="text-slate-400">Vos</div>
                <div className="text-2xl font-extrabold">{youScore}</div>
              </div>
              <div className="text-slate-500">vs</div>
              <div>
                <div className="text-slate-400">Rival</div>
                <div className="text-2xl font-extrabold">{rivalScore}</div>
              </div>
            </div>

            {/* Desglose del dinero */}
            <div className="mt-5 rounded-xl bg-[--color-surface-2] p-4 text-sm">
              {outcome === "win" && (
                <>
                  <Money label="Pozo" value={`${payout.pot} USDC`} />
                  <Money label="Comision (10%)" value={`- ${payout.fee} USDC`} />
                  <div className="mt-2 flex justify-between border-t border-[--color-border] pt-2 text-lg font-extrabold text-[--color-win]">
                    <span>Cobras</span>
                    <span>{payout.prize} USDC</span>
                  </div>
                </>
              )}
              {outcome === "lose" && (
                <p className="text-slate-400">
                  Perdiste tu apuesta de {bet} USDC. ¡A la proxima!
                </p>
              )}
              {outcome === "draw" && (
                <p className="text-slate-300">
                  Empate: se les devuelve {bet} USDC a cada uno (sin comision).
                </p>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => router.push(`/game/${gameId}`)}
                className="flex-1 rounded-xl bg-[--color-accent] px-4 py-3 font-semibold text-white hover:opacity-90"
              >
                Jugar de nuevo
              </button>
              <button
                onClick={() => router.push("/")}
                className="flex-1 rounded-xl border border-[--color-border] px-4 py-3 font-semibold hover:bg-[--color-surface-2]"
              >
                Inicio
              </button>
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
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[--color-surface-2] text-xl">
        {emoji}
      </div>
      <div className={right ? "text-right" : ""}>
        <div className="text-sm text-slate-400">{label}</div>
        <div className="text-2xl font-extrabold">{score ?? "—"}</div>
      </div>
    </div>
  );
}

function Money({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-slate-400">{label}</span>
      <span>{value}</span>
    </div>
  );
}
