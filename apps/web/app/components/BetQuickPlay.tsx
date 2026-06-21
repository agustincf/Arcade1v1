"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BET_AMOUNTS, TABLE_META } from "@/app/lib/config";
import { GAMES } from "@/app/lib/games";

// Montos clickeables del home: al tocar uno, se abre un popup que pregunta
// a que juego querés jugar con ese monto, y te lleva directo.
export function BetQuickPlay() {
  const router = useRouter();
  const [bet, setBet] = useState<number | null>(null);
  const live = GAMES.filter((g) => g.status === "live");

  return (
    <>
      <p className="font-screen mt-5 text-center text-lg text-slate-400">
        Jugá rápido — elegí un monto:
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {BET_AMOUNTS.map((b) => (
          <button
            key={b}
            onClick={() => setBet(b)}
            className="chip cursor-pointer transition hover:brightness-125"
          >
            💰 {b} USDC {TABLE_META[b]?.recommended ? "🔥" : ""}
          </button>
        ))}
      </div>

      {bet !== null && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setBet(null)}
        >
          <div
            className="win w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="win-title">
              <span>¿A QUÉ JUGÁS · {bet} USDC?</span>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 gap-3">
                {live.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => router.push(`/game/${g.id}?bet=${bet}`)}
                    className="win flex items-center gap-3 p-3 text-left transition hover:-translate-y-0.5"
                  >
                    <span className="text-3xl">{g.emoji}</span>
                    <span className="font-pixel text-sm text-[--color-accent]">
                      {g.name}
                    </span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setBet(null)}
                className="btn3d btn3d--cyan mt-4 w-full"
              >
                CANCELAR
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
