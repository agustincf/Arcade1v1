"use client";

import { useEffect, useState } from "react";
import { LEADERBOARD_TABS } from "@/app/lib/games";
import { GameIcon } from "@/app/components/GameIcon";
import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { getLeaderboard, type LeaderRow } from "@/app/lib/arbiter";
import { useT } from "@/app/lib/i18n";
import { useWallet } from "@/app/lib/wallet";
import { HelpTip } from "@/app/components/onboarding/HelpTip";
import { HouseChip } from "@/app/components/HouseChip";
import { WebhookChip } from "@/app/components/WebhookChip";
import { PixelIcon } from "@/app/components/PixelIcon";
import { TablaPorModelo } from "@/app/components/aleph/TablaPorModelo";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
// El podio va en el número, no en un emoji de medalla (cada sistema dibuja la
// suya): oro, plata y bronce con los colores de la paleta.
const podium = (i: number) =>
  i === 0
    ? "text-(--color-gold)"
    : i === 1
      ? "text-(--color-muted-bright)"
      : i === 2
        ? "text-(--color-accent)"
        : "text-(--color-muted-3)";

export default function LeaderboardPage() {
  const { t } = useT();
  const { address } = useWallet();
  const [game, setGame] = useState(LEADERBOARD_TABS[0].id);
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
      <h1 className="font-pixel text-px16 leading-relaxed text-(--color-text-strong) sm:text-px24">
        {t("lb.title")}
      </h1>
      <p className="mt-2 text-base text-(--color-muted)">
        {t("lb.subtitle")} <HelpTip k="elo" /> ·{" "}
        <Link href="/watch" className="font-medium text-(--color-accent-2) hover:underline">
          <PixelIcon name="play" className="mr-1.5" />
          {t("watch.cta")}
        </Link>
      </p>

      {/* Selector de juego */}
      <div className="mt-5 flex flex-wrap gap-2">
        {LEADERBOARD_TABS.map((g) => (
          <button
            key={g.id}
            onClick={() => setGame(g.id)}
            className={`btn3d btn3d--sm ${game === g.id ? "btn3d--magenta" : "btn3d--cyan"} flex items-center gap-2 !px-3 !py-2`}
          >
            {/* El sprite va sobre su pantallita de tinta: en la pestaña activa
                (coral) el invader coral desaparecía. */}
            <span className="rounded-[2px] bg-(--color-ink) p-0.5 leading-none">
              <GameIcon id={g.id} size={16} />
            </span>
            {t(`game.${g.id}.name`)}
          </button>
        ))}
      </div>

      {/* Aleph no es un cartucho y su ELO se calcula distinto (K/(N−1) contra
          toda la mesa, no contra un rival). Decirlo acá evita que alguien lea
          los dos rankings como si fueran la misma escala. */}
      {game === "aleph" && (
        <p className="mt-3 text-sm leading-relaxed text-(--color-muted-3)">
          {t("aleph.lb.note")}{" "}
          <Link href="/aleph" className="font-medium text-(--color-accent-2) hover:underline">
            {t("aleph.lb.link")}
          </Link>
        </p>
      )}
      {game === "aleph" && <TablaPorModelo t={t} className="mt-4" />}

      {/* Tabla */}
      <div className="win mt-4">
        <div className="win-title">
          <span>{t(`game.${game}.name`).toUpperCase()} · RANKING</span>
          <span className="chip chip--money">{t("lb.rating")}</span>
        </div>
        <div className="p-3">
          {rows === null ? (
            <p className="py-8 text-center text-base text-(--color-accent-2)">…</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-base text-(--color-muted)">{t("lb.empty")}</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {rows.map((row, i) => {
                const mine = !!address && row.address.toLowerCase() === address.toLowerCase();
                return (
                  <li
                    key={row.address}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${
                      mine
                        ? "border-(--color-accent) bg-(--color-surface-2)"
                        : "border-transparent bg-(--color-surface-2)"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`font-pixel w-8 text-center text-px16 ${podium(i)}`}>
                        {i + 1}
                      </span>
                      <span className="font-mono text-sm text-(--color-muted-bright)">
                        {row.name ? (
                          <>
                            <span className="mr-1">{row.avatar}</span>
                            {row.agentId ? (
                              <Link
                                href={`/my-agents/${row.agentId}`}
                                className="font-sans text-(--color-accent-2) hover:underline"
                              >
                                {row.name}
                              </Link>
                            ) : (
                              <span className="font-sans">{row.name}</span>
                            )}{" "}
                            <span className="text-(--color-muted-3)">· {short(row.address)}</span>
                          </>
                        ) : (
                          short(row.address)
                        )}
                        {row.house && (
                          <span className="ml-2 align-middle">
                            <HouseChip />
                          </span>
                        )}
                        {row.byo && (
                          <span className="ml-2 align-middle">
                            <WebhookChip />
                          </span>
                        )}
                        {mine && (
                          <span className="ml-2 font-sans font-semibold text-(--color-accent)">
                            ({t("lb.you")})
                          </span>
                        )}
                      </span>
                    </div>
                    <span className="font-pixel text-px16 text-(--color-gold)">{row.rating}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      <p className="mt-3 text-center text-sm text-(--color-muted-3)">{t("lb.note")}</p>
    </div>
  );
}
