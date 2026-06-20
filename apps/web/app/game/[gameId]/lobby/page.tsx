"use client";

import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getGame } from "@/app/lib/games";
import { getPayout } from "@/app/lib/config";

export default function LobbyPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = use(params);
  const game = getGame(gameId);
  const router = useRouter();
  const search = useSearchParams();
  const bet = Number(search.get("bet") ?? 0);

  const [status, setStatus] = useState<"searching" | "found">("searching");
  const [dots, setDots] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setStatus("found"), 3000);
    const d = setInterval(() => setDots((x) => (x.length >= 3 ? "" : x + ".")), 400);
    return () => {
      clearTimeout(t);
      clearInterval(d);
    };
  }, []);

  if (!game) return null;

  return (
    <div className="mx-auto max-w-md">
      <Link
        href={`/game/${gameId}`}
        className="font-screen text-xl text-[--color-accent-2] hover:underline"
      >
        ← Cancelar
      </Link>

      <div className="win mt-3">
        <div className="win-title">
          <span>MATCHMAKING.EXE</span>
          <span className="win-dots">
            <span className="win-dot" />
            <span className="win-dot" />
            <span className="win-dot" />
          </span>
        </div>

        <div className="p-8 text-center">
          <div className="text-6xl">{game.emoji}</div>
          <p className="font-screen mt-2 text-lg text-slate-300">
            {game.name} · Mesa {bet} USDC · Pozo {getPayout(bet).pot} USDC
          </p>

          {status === "searching" ? (
            <>
              <div className="relative mx-auto mt-8 h-16 w-16">
                <span className="absolute inset-0 animate-spin rounded-full border-4 border-[--color-border] border-t-[--color-accent]" />
              </div>
              <h1 className="font-pixel mt-6 text-sm text-[--color-accent-2] neon-cyan">
                BUSCANDO RIVAL{dots}
              </h1>
              <p className="font-screen mt-2 text-lg text-slate-400">
                Cruzándote con alguien que se la banca igual que vos...
              </p>
            </>
          ) : (
            <>
              <div className="mt-8 flex items-center justify-center gap-4">
                <Avatar label="VOS" you />
                <span className="font-pixel text-base text-[--color-gold] blink">VS</span>
                <Avatar label="RIVAL" />
              </div>
              <h1 className="font-pixel mt-6 text-sm text-[--color-win]">
                ¡APARECIÓ TU RIVAL!
              </h1>
              <button
                onClick={() => router.push(`/game/${gameId}/match?bet=${bet}`)}
                className="btn3d btn3d--magenta mt-6 w-full"
              >
                ► AL ATAQUE
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Avatar({ label, you }: { label: string; you?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-lg border-2 border-[#0a0518] text-2xl ${
          you ? "bg-[--color-accent]" : "bg-[--color-surface-2]"
        }`}
      >
        {you ? "🙂" : "👤"}
      </div>
      <span className="font-pixel text-[10px] text-slate-200">{label}</span>
    </div>
  );
}
