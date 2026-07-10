"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BET_AMOUNTS } from "@/app/lib/config";
import { GAMES } from "@/app/lib/games";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";

type Picker = { mode: "bet"; bet: number } | { mode: "free" } | null;

export function BetQuickPlay() {
  const router = useRouter();
  const { t } = useT();
  const [picker, setPicker] = useState<Picker>(null);
  const live = GAMES.filter((g) => g.status === "live");

  function go(gameId: string) {
    if (!picker) return;
    // "Jugar gratis" ahora va a la LADDER GRATIS (bet=0): rival real + ELO,
    // sin depósito. El modo práctica offline sigue vivo en ?free=1.
    if (picker.mode === "free") router.push(`/game/${gameId}/match?bet=0`);
    else router.push(`/game/${gameId}?bet=${picker.bet}`);
  }

  return (
    <>
      {/* CTAs principales: construir un agente / probar los juegos. En mobile
          van apilados a tamaño completo, separados por un "── o ──" pixel. */}
      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
        {/* v2: el CTA principal lleva al BUILDER no-code (crear un agente acá
            mismo), no a la doc técnica. /agents sigue linkeado más abajo. */}
        <Link href="/build" className="btn3d btn3d--magenta inline-block whitespace-nowrap">
          🤖 {t("build.cta")}
        </Link>
        <span className="font-pixel flex items-center gap-3 text-[9px] text-(--color-muted-3)">
          <span aria-hidden className="h-px w-10 bg-(--color-border) sm:hidden" />
          {t("hero.or")}
          <span aria-hidden className="h-px w-10 bg-(--color-border) sm:hidden" />
        </span>
        <button
          onClick={() => setPicker({ mode: "free" })}
          className="btn3d btn3d--cyan whitespace-nowrap"
        >
          {t("free.btn")}
        </button>
      </div>

      {/* Embudo v2: mirar partidas / mis agentes — entender antes de apostar */}
      <div className="mt-4 flex items-center justify-center gap-5 text-sm font-medium">
        <Link
          href="/watch"
          className="text-(--color-accent-2) transition hover:text-(--color-text)"
        >
          🎬 {t("watch.cta")}
        </Link>
        <Link
          href="/my-agents"
          className="text-(--color-accent-2) transition hover:text-(--color-text)"
        >
          🗂 {t("nav.myagents")}
        </Link>
      </div>

      {/* Partidas con stake: botones dorados apretables, siempre en una fila */}
      <div className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
        <span className="text-sm font-medium uppercase tracking-wide text-(--color-muted-2)">
          {t("quick.prompt")}
        </span>
        <div className="flex w-full max-w-sm justify-center gap-2 sm:w-auto sm:max-w-none">
          {BET_AMOUNTS.map((b) => (
            <button
              key={b}
              onClick={() => setPicker({ mode: "bet", bet: b })}
              className="btn3d btn3d--sm flex-1 whitespace-nowrap sm:flex-none"
            >
              {b} USDC
            </button>
          ))}
        </div>
      </div>

      {picker !== null && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPicker(null)}
        >
          <div className="win w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="win-title">
              <span>
                {picker.mode === "free"
                  ? t("quick.titleFree")
                  : t("quick.titleBet", { bet: picker.bet })}
              </span>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 gap-3">
                {live.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => go(g.id)}
                    className="win flex items-center gap-3 p-3 text-left transition hover:-translate-y-0.5 hover:border-(--color-accent)"
                  >
                    <GameIcon id={g.id} size={34} />
                    <span className="font-pixel text-xs text-(--color-text)">
                      {t(`game.${g.id}.name`)}
                    </span>
                  </button>
                ))}
              </div>
              <button onClick={() => setPicker(null)} className="btn3d btn3d--cyan mt-4 w-full">
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
