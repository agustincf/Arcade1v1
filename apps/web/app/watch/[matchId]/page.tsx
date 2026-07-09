"use client";

// Ver una partida decidida: los DOS intentos lado a lado, reproducidos con el
// motor real (mismo determinismo que el anti-trampa del árbitro).

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/app/lib/i18n";
import { GameIcon } from "@/app/components/GameIcon";
import { shortAddress } from "@/app/lib/wallet";
import { getPublicReplay, warmUpArbiter, type PublicReplay } from "@/app/lib/arbiter";
import { ReplayPlayer } from "@/app/components/replay/ReplayPlayer";

export default function WatchMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = use(params);
  const { t } = useT();
  const [data, setData] = useState<PublicReplay | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    warmUpArbiter();
    getPublicReplay(matchId)
      .then(setData)
      .catch(() => setError(true));
  }, [matchId]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <p className="py-8 text-base text-(--color-muted)">{t("watch.notFound")}</p>
        <Link href="/watch" className="btn3d btn3d--cyan inline-block">
          {t("back")}
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <p className="py-10 text-center text-base text-(--color-muted-2)">{t("match.connecting")}</p>
    );
  }

  const [p1, p2] = data.players;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/watch" className="text-sm font-medium text-(--color-accent-2) hover:underline">
        {t("back")}
      </Link>

      <div className="win mt-3">
        <div className="win-title">
          <span className="flex items-center gap-2">
            <GameIcon id={data.game} size={18} /> {t(`game.${data.game}.name`).toUpperCase()} ·{" "}
            {t("watch.title")}
          </span>
          {data.outcome === "draw" ? (
            <span className="chip !text-(--color-muted-2)">{t("match.draw")}</span>
          ) : (
            <span className="chip !text-(--color-gold)">
              🏆 {data.winner ? shortAddress(data.winner) : ""}
            </span>
          )}
        </div>
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          {[p1, p2].map((p, i) => (
            <div key={i} className="flex flex-col items-center">
              <ReplayPlayer
                game={data.game}
                replay={p.replay}
                label={`${shortAddress(p.address)}${
                  data.winner?.toLowerCase() === p.address.toLowerCase() ? " 🏆" : ""
                }`}
              />
            </div>
          ))}
        </div>
        <p className="px-5 pb-5 text-center text-sm leading-relaxed text-(--color-muted-2)">
          {t("watch.note")}
        </p>
      </div>
    </div>
  );
}
