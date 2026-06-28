"use client";

import { useState } from "react";
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
    if (picker.mode === "free") router.push(`/game/${gameId}/match?free=1`);
    else router.push(`/game/${gameId}?bet=${picker.bet}`);
  }

  return (
    <>
      <p className="font-screen mt-5 text-center text-lg text-[--color-muted-2]">{t("quick.prompt")}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {BET_AMOUNTS.map((b) => (
          <button
            key={b}
            onClick={() => setPicker({ mode: "bet", bet: b })}
            className="chip cursor-pointer transition hover:brightness-125"
          >
            💰 {b} USDC
          </button>
        ))}
      </div>

      <div className="mt-4 text-center">
        <button onClick={() => setPicker({ mode: "free" })} className="btn3d btn3d--cyan">
          {t("free.btn")}
        </button>
        <p className="font-screen mt-1 text-base text-[--color-muted-3]">{t("free.sub")}</p>
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
                    className="win flex items-center gap-3 p-3 text-left transition hover:-translate-y-0.5"
                  >
                    <GameIcon id={g.id} size={34} />
                    <span className="font-pixel text-sm text-[--color-accent]">
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
