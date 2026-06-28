"use client";

import { useEffect, useState } from "react";
import { GAMES } from "@/app/lib/games";
import { GameIcon } from "@/app/components/GameIcon";
import { getLeaderboard, type LeaderRow } from "@/app/lib/arbiter";
import { useT } from "@/app/lib/i18n";
import { useWallet } from "@/app/lib/wallet";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`);

export default function LeaderboardPage() {
  const { t } = useT();
  const { address } = useWallet();
  const [game, setGame] = useState(GAMES[0].id);
  const [rows, setRows] = useState<LeaderRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    let cancel = false;
    getLeaderboard(game, 50).then((r) => {
      if (!cancel) setRows(r);
    });
    return () => {
      cancel = true;
    };
  }, [game]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-pixel text-2xl text-[--color-gold] neon-gold">{t("lb.title")}</h1>
      <p className="font-screen mt-2 text-lg text-[--color-muted]">{t("lb.subtitle")}</p>

      {/* Selector de juego */}
      <div className="mt-4 flex flex-wrap gap-2">
        {GAMES.map((g) => (
          <button
            key={g.id}
            onClick={() => setGame(g.id)}
            className={`btn3d ${game === g.id ? "btn3d--magenta" : "btn3d--cyan"} flex items-center gap-2 !px-3 !py-2 !text-xs`}
          >
            <GameIcon id={g.id} size={16} />
            {t(`game.${g.id}.name`)}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div className="win mt-4">
        <div className="win-title">
          <span>{t(`game.${game}.name`).toUpperCase()} · RANKING</span>
          <span className="chip !text-[--color-gold]">{t("lb.rating")}</span>
        </div>
        <div className="p-3">
          {rows === null ? (
            <p className="font-screen py-8 text-center text-lg text-[--color-accent-2]">…</p>
          ) : rows.length === 0 ? (
            <p className="font-screen py-8 text-center text-lg text-[--color-muted]">{t("lb.empty")}</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {rows.map((row, i) => {
                const mine = !!address && row.address.toLowerCase() === address.toLowerCase();
                return (
                  <li
                    key={row.address}
                    className={`flex items-center justify-between rounded-lg border-2 px-3 py-2 ${
                      mine
                        ? "border-[--color-gold] bg-[--color-surface-2]"
                        : "border-[--color-ink] bg-[--color-surface-2]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-pixel w-8 text-center text-sm text-[--color-muted-bright]">
                        {medal(i)}
                      </span>
                      <span className="font-screen text-base text-[--color-muted-bright]">
                        {short(row.address)}
                        {mine && <span className="ml-2 text-[--color-lime]">({t("lb.you")})</span>}
                      </span>
                    </div>
                    <span className="font-pixel text-sm text-[--color-gold]">{row.rating}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      <p className="font-screen mt-3 text-center text-base text-[--color-muted-3]">{t("lb.note")}</p>
    </div>
  );
}
