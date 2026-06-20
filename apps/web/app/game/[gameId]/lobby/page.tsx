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

  // Simulacion: "encuentra" un rival despues de unos segundos.
  useEffect(() => {
    const t = setTimeout(() => setStatus("found"), 3000);
    return () => clearTimeout(t);
  }, []);

  if (!game) return null;

  return (
    <div className="mx-auto max-w-md text-center">
      <Link
        href={`/game/${gameId}`}
        className="text-sm text-slate-400 hover:text-white"
      >
        ← Cancelar y volver
      </Link>

      <div className="mt-10 rounded-2xl border border-[--color-border] bg-[--color-surface] p-8">
        <div className="text-5xl">{game.emoji}</div>
        <p className="mt-2 text-sm text-slate-400">
          {game.name} · Mesa de {bet} USDC · Pozo {getPayout(bet).pot} USDC
        </p>

        {status === "searching" ? (
          <>
            {/* Spinner */}
            <div className="relative mx-auto mt-8 h-16 w-16">
              <span className="absolute inset-0 animate-spin rounded-full border-4 border-[--color-border] border-t-[--color-accent]" />
            </div>
            <h1 className="mt-6 text-xl font-bold">Buscando rival...</h1>
            <p className="mt-1 text-sm text-slate-400">
              Te emparejamos con alguien que apuesta lo mismo.
            </p>
          </>
        ) : (
          <>
            <div className="mt-8 flex items-center justify-center gap-4">
              <Avatar label="Vos" you />
              <span className="text-2xl font-black text-slate-500">VS</span>
              <Avatar label="Rival" />
            </div>
            <h1 className="mt-6 text-xl font-bold text-[--color-win]">
              ¡Rival encontrado!
            </h1>
            <button
              onClick={() => router.push(`/game/${gameId}/match?bet=${bet}`)}
              className="mt-6 w-full rounded-xl bg-[--color-accent] px-5 py-4 font-semibold text-white hover:opacity-90"
            >
              Empezar partida →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Avatar({ label, you }: { label: string; you?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold ${
          you
            ? "bg-[--color-accent] text-white"
            : "bg-[--color-surface-2] text-slate-300"
        }`}
      >
        {you ? "🙂" : "👤"}
      </div>
      <span className="text-sm">{label}</span>
    </div>
  );
}
