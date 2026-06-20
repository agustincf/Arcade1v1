"use client";

import { use, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getGame } from "@/app/lib/games";
import { getPayout } from "@/app/lib/config";

type Result = "win" | "lose" | null;

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

  const [score, setScore] = useState({ you: 0, rival: 0 });
  const [result, setResult] = useState<Result>(null);

  if (!game) return null;

  // Simulacion: deciden un resultado al azar.
  function simularResultado() {
    const youWin = Math.random() > 0.5;
    setScore({
      you: youWin ? 3 : 1,
      rival: youWin ? 1 : 3,
    });
    setResult(youWin ? "win" : "lose");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm text-slate-400 hover:text-white">
        ← Salir
      </Link>

      {/* Marcador */}
      <div className="mt-3 flex items-center justify-between rounded-2xl border border-[--color-border] bg-[--color-surface] px-6 py-4">
        <ScoreSide label="Vos" emoji="🙂" score={score.you} />
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {game.name}
          </div>
          <div className="text-xs text-amber-300">Pozo {payout.pot} USDC</div>
        </div>
        <ScoreSide label="Rival" emoji="👤" score={score.rival} right />
      </div>

      {/* Area de juego (placeholder) */}
      <div className="mt-5 flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-[--color-border] bg-[--color-surface]/50 p-8 text-center">
        <div className="text-6xl">{game.emoji}</div>
        <p className="mt-4 max-w-sm text-slate-400">
          Aca va a vivir el juego de <b>{game.name}</b>.
          {game.id === "tetris"
            ? " El Tetris jugable se construye en la Fase 2."
            : " El juego jugable se construye en la Fase 3."}
        </p>
        {!result && (
          <button
            onClick={simularResultado}
            className="mt-6 rounded-xl bg-[--color-accent] px-6 py-3 font-semibold text-white hover:opacity-90"
          >
            Simular resultado de la partida
          </button>
        )}
      </div>

      {/* Modal de resultado */}
      {result && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[--color-border] bg-[--color-surface] p-8 text-center">
            <div className="text-6xl">{result === "win" ? "🏆" : "😞"}</div>
            <h2
              className={`mt-4 text-2xl font-extrabold ${
                result === "win" ? "text-[--color-win]" : "text-[--color-lose]"
              }`}
            >
              {result === "win" ? "¡Ganaste!" : "Perdiste"}
            </h2>

            {result === "win" ? (
              <div className="mt-4 rounded-xl bg-[--color-surface-2] p-4 text-sm">
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Pozo</span>
                  <span>{payout.pot} USDC</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Comision (10%)</span>
                  <span>- {payout.fee} USDC</span>
                </div>
                <div className="mt-2 flex justify-between border-t border-[--color-border] pt-2 text-lg font-extrabold text-[--color-win]">
                  <span>Cobras</span>
                  <span>{payout.prize} USDC</span>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">
                Perdiste tu apuesta de {bet} USDC. ¡A la proxima!
              </p>
            )}

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
  score: number;
  right?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${right ? "flex-row-reverse" : ""}`}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[--color-surface-2] text-xl">
        {emoji}
      </div>
      <div className={right ? "text-right" : ""}>
        <div className="text-sm text-slate-400">{label}</div>
        <div className="text-2xl font-extrabold">{score}</div>
      </div>
    </div>
  );
}
