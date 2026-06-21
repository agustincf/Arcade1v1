"use client";

import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getGame } from "@/app/lib/games";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";
import {
  BET_AMOUNTS,
  getPayout,
  PLATFORM_FEE,
  DEFAULT_BET,
  TABLE_META,
  matchBars,
  onlinePlayers,
  type MatchSpeed,
} from "@/app/lib/config";

export function TableClient({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = use(params);
  const game = getGame(gameId);
  const router = useRouter();
  const search = useSearchParams();
  const { t } = useT();

  const betParam = Number(search.get("bet"));
  const initial = BET_AMOUNTS.includes(betParam as (typeof BET_AMOUNTS)[number])
    ? betParam
    : DEFAULT_BET;
  const [selected, setSelected] = useState<number>(initial);
  const [online, setOnline] = useState<number | null>(null);
  useEffect(() => setOnline(onlinePlayers()), []);

  if (!game || game.status !== "live") {
    return (
      <div className="text-center">
        <Link href="/" className="font-screen mt-4 inline-block text-xl text-[--color-accent-2]">
          {t("back")}
        </Link>
      </div>
    );
  }

  const meta = TABLE_META[selected];

  function buscarRival() {
    router.push(`/game/${gameId}/match?bet=${selected}`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="font-screen text-xl text-[--color-accent-2] hover:underline">
        {t("back")}
      </Link>

      <div className="win mt-3">
        <div className="win-title">
          <span>
            {t(`game.${game.id}.name`).toUpperCase()} · {t("table.choose")}
          </span>
          <span className="chip">
            <span className="blink">🟢</span> {t("table.online", { n: online ?? "···" })}
          </span>
        </div>

        <div className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <GameIcon id={game.id} size={52} />
            <p className="font-screen text-xl text-slate-200">{t("table.q")}</p>
          </div>

          {/* Mesas */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {BET_AMOUNTS.map((bet) => {
              const { prize } = getPayout(bet);
              const m = TABLE_META[bet];
              const active = selected === bet;
              return (
                <button
                  key={bet}
                  onClick={() => setSelected(bet)}
                  className={`win relative p-3 text-center transition ${
                    active
                      ? "-translate-y-1 outline outline-[3px] outline-[--color-gold] outline-offset-2"
                      : "hover:-translate-y-0.5"
                  }`}
                >
                  {active && (
                    <span className="absolute bottom-1 right-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-[#0a0518] bg-[--color-gold] text-xs font-extrabold text-[#1a0033]">
                      ✓
                    </span>
                  )}
                  <div className="font-pixel text-base text-[--color-gold]">{bet}</div>
                  <div className="font-screen text-base text-slate-400">USDC</div>
                  {m.premium && (
                    <div className="font-screen text-sm text-[--color-accent]">{t("table.vip")}</div>
                  )}
                  <div className="font-screen text-base text-[--color-win]">
                    {t("table.win", { n: prize })}
                  </div>
                  <div className="mt-2 flex items-center justify-center gap-1">
                    <SignalBars speed={m.speed} />
                    <span className="font-screen text-sm text-slate-400">
                      👥 {m.playersWaiting}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Nudge de CRO */}
          <div className="mt-4 rounded border-2 border-[#0a0518] bg-[#0a0518] p-3 text-center">
            <p className="font-screen text-lg text-[--color-accent-2]">
              {meta.premium
                ? t("table.nudgeVip", { n: meta.playersWaiting })
                : t("table.nudgeNormal", { n: meta.playersWaiting, bet: selected })}
            </p>
          </div>

          {/* CTA */}
          <div className="mt-4">
            <button onClick={buscarRival} className="btn3d btn3d--magenta w-full">
              {t("table.cta", { bet: selected })}
            </button>
            <p className="font-screen mt-2 text-center text-base text-slate-400">
              {t("table.norisk")}
            </p>
          </div>

          {/* Desglose del pozo */}
          <div className="win mt-4">
            <div className="win-title win-title--cyan">
              <span>{t("table.pot")}</span>
            </div>
            <div className="font-screen p-4 text-lg">
              <Row label={t("table.yourBet")} value={`${selected} USDC`} />
              <Row label={t("table.rivalBet")} value={`${selected} USDC`} />
              <Row label={t("table.totalPot")} value={`${getPayout(selected).pot} USDC`} />
              <Row
                label={t("table.fee", { pct: PLATFORM_FEE * 100 })}
                value={`- ${getPayout(selected).fee} USDC`}
              />
              <div className="my-2 border-t-2 border-dashed border-[--color-border]" />
              <Row
                label={t("table.prize")}
                value={`${getPayout(selected).prize} USDC`}
                highlight
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SignalBars({ speed }: { speed: MatchSpeed }) {
  const n = matchBars(speed);
  const color =
    speed === "rapido"
      ? "var(--color-win)"
      : speed === "medio"
        ? "var(--color-gold)"
        : "var(--color-lose)";
  return (
    <span className="flex items-end gap-0.5">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            height: `${i * 3 + 3}px`,
            backgroundColor: i <= n ? color : "var(--color-border)",
          }}
          className="w-1 rounded-sm"
        />
      ))}
    </span>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-slate-400">{label}</span>
      <span className={highlight ? "font-pixel text-sm text-[--color-win]" : "text-slate-100"}>
        {value}
      </span>
    </div>
  );
}
