"use client";

import { useState } from "react";
import { LocaleLink as Link, useLocalePath } from "@/app/components/LocaleLink";
import { useRouter } from "next/navigation";
import { GAMES } from "@/app/lib/games";
import { GameIcon } from "@/app/components/GameIcon";
import { PixelIcon } from "@/app/components/PixelIcon";
import { useT } from "@/app/lib/i18n";

export function BetQuickPlay() {
  const router = useRouter();
  const lp = useLocalePath();
  const { t } = useT();
  const [picking, setPicking] = useState(false);
  const live = GAMES.filter((g) => g.status === "live");

  // "Probar gratis" va a la LADDER GRATIS (bet=0): rival real + ELO, sin
  // depósito. El modo práctica offline sigue vivo en ?free=1.
  function go(gameId: string) {
    router.push(lp(`/game/${gameId}/match?bet=0`));
  }

  return (
    <>
      {/* Hero "dos puertas": crear un agente o probar los juegos, y nada más.
          El stake se elige en la mesa de cada juego (con premio a la vista),
          así que acá no compite con la decisión principal. */}
      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
        <Link href="/build" className="btn3d btn3d--magenta inline-block whitespace-nowrap">
          <PixelIcon name="agent" className="mr-2" />
          {t("build.cta")}
        </Link>
        <span className="rotulo flex items-center gap-3 text-(--color-muted-3)">
          <span aria-hidden className="h-px w-10 bg-(--color-border) sm:hidden" />
          {t("hero.or")}
          <span aria-hidden className="h-px w-10 bg-(--color-border) sm:hidden" />
        </span>
        <button onClick={() => setPicking(true)} className="btn3d btn3d--cyan whitespace-nowrap">
          <PixelIcon name="gamepad" className="mr-2" />
          {t("free.btn")}
        </button>
      </div>
      {picking && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-(--color-scrim) p-4"
          onClick={() => setPicking(false)}
        >
          <div className="win w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="win-title">
              <span>{t("quick.titleFree")}</span>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 gap-3">
                {live.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => go(g.id)}
                    className="win flex items-center gap-3 p-2 pr-3 text-left transition hover:-translate-y-0.5 hover:border-(--color-accent)"
                  >
                    <span className="pantalla h-10 w-10 shrink-0 rounded-sm">
                      <GameIcon id={g.id} size={32} />
                    </span>
                    <span className="font-pixel text-px8 leading-relaxed text-(--color-text)">
                      {t(`game.${g.id}.name`)}
                    </span>
                  </button>
                ))}
              </div>
              <button onClick={() => setPicking(false)} className="btn3d btn3d--cyan mt-4 w-full">
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
