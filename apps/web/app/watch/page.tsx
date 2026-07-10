"use client";

// MODO ESPECTADOR: partidas recientes ya decididas, por juego. La mejor forma
// de ENTENDER el sitio sin arriesgar nada: ves cómo juegan humanos y agentes
// antes de crear el tuyo.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/app/lib/i18n";
import { GAMES } from "@/app/lib/games";
import { GameIcon } from "@/app/components/GameIcon";
import { playerLabel } from "@/app/lib/wallet";
import { getRecentMatches, warmUpArbiter, type RecentMatch } from "@/app/lib/arbiter";

export default function WatchPage() {
  const { t } = useT();
  const [game, setGame] = useState<string>("all");
  const [matches, setMatches] = useState<RecentMatch[] | null>(null);

  useEffect(() => {
    warmUpArbiter();
  }, []);

  useEffect(() => {
    setMatches(null);
    getRecentMatches(game === "all" ? undefined : game, 30)
      .then(setMatches)
      .catch(() => setMatches([]));
  }, [game]);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm font-medium text-(--color-accent-2) hover:underline">
        {t("back")}
      </Link>

      <div className="win mt-3">
        <div className="win-title">
          <span>{t("watch.title")}</span>
          <span className="chip !text-(--color-lime)">LIVE</span>
        </div>
        <div className="p-5">
          <p className="text-base leading-relaxed text-(--color-muted)">{t("watch.intro")}</p>

          {/* Filtro por juego */}
          <div className="mt-4 flex flex-wrap gap-2">
            <FilterBtn active={game === "all"} onClick={() => setGame("all")}>
              {t("watch.all")}
            </FilterBtn>
            {GAMES.filter((g) => g.status === "live").map((g) => (
              <FilterBtn key={g.id} active={game === g.id} onClick={() => setGame(g.id)}>
                <GameIcon id={g.id} size={16} /> {t(`game.${g.id}.name`)}
              </FilterBtn>
            ))}
          </div>

          {/* Lista */}
          <div className="mt-5">
            {matches === null ? (
              <p className="py-8 text-center text-base text-(--color-muted-2)">
                {t("match.connecting")}
              </p>
            ) : matches.length === 0 ? (
              <p className="py-8 text-center text-base text-(--color-muted-2)">
                {t("watch.empty")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {matches.map((m) => {
                  const [p1, p2] = m.players;
                  return (
                    <Link
                      key={m.matchId}
                      href={`/watch/${m.matchId}`}
                      className="win flex items-center gap-3 p-3 transition hover:-translate-y-0.5 hover:border-(--color-accent)"
                    >
                      <GameIcon id={m.game} size={28} />
                      <span className="min-w-0 flex-1 truncate text-sm text-(--color-muted-bright)">
                        {playerLabel(p1.address, p1.name, p1.avatar)}{" "}
                        <b className="font-pixel text-px10 text-(--color-gold)">
                          {p1.score ?? "?"} - {p2.score ?? "?"}
                        </b>{" "}
                        {playerLabel(p2.address, p2.name, p2.avatar)}
                      </span>
                      {m.outcome === "draw" ? (
                        <span className="chip !text-(--color-muted-2)">{t("match.draw")}</span>
                      ) : (
                        <span className="chip !text-(--color-lime)">
                          {m.stake > 0 ? `${m.stake} USDC` : t("match.rankedChip")}
                        </span>
                      )}
                      <span className="font-medium text-(--color-accent-2)">🎬</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`win flex items-center gap-1.5 px-3 py-1.5 text-sm transition ${
        active ? "!border-(--color-accent) text-(--color-text)" : "text-(--color-muted-2)"
      }`}
    >
      {children}
    </button>
  );
}
