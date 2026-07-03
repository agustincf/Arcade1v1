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
  SHOW_SYNTHETIC_ACTIVITY,
  type MatchSpeed,
} from "@/app/lib/config";

export function TableClient({ params }: { params: Promise<{ gameId: string }> }) {
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
        <Link
          href="/"
          className="mt-4 inline-block text-sm font-medium text-(--color-accent-2) hover:underline"
        >
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
      <Link href="/" className="text-sm font-medium text-(--color-accent-2) hover:underline">
        {t("back")}
      </Link>

      <div className="win mt-3">
        <div className="win-title">
          <span>
            {t(`game.${game.id}.name`).toUpperCase()} · {t("table.choose")}
          </span>
          {SHOW_SYNTHETIC_ACTIVITY && (
            <span className="chip">
              <span className="blink">●</span> {t("table.online", { n: online ?? "···" })}
            </span>
          )}
        </div>

        <div className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <GameIcon id={game.id} size={52} />
            <p className="text-base font-medium text-(--color-muted-bright)">{t("table.q")}</p>
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
                      ? "-translate-y-1 !border-(--color-accent) shadow-[0_0_0_1px_var(--color-accent)]"
                      : "hover:-translate-y-0.5 hover:border-(--color-muted-3)"
                  }`}
                >
                  {active && (
                    <span className="absolute bottom-1.5 right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-(--color-accent) text-xs font-extrabold text-(--color-ink-2)">
                      ✓
                    </span>
                  )}
                  <div className="font-pixel text-base text-(--color-gold)">{bet}</div>
                  <div className="text-xs font-medium uppercase tracking-wide text-(--color-muted-2)">
                    USDC
                  </div>
                  {m.premium && (
                    <div className="mt-0.5 text-xs font-bold uppercase tracking-wide text-(--color-accent)">
                      {t("table.vip")}
                    </div>
                  )}
                  <div className="mt-0.5 text-sm font-semibold text-(--color-win)">
                    {t("table.win", { n: prize })}
                  </div>
                  {SHOW_SYNTHETIC_ACTIVITY && (
                    <div className="mt-2 flex items-center justify-center gap-1.5">
                      <SignalBars speed={m.speed} />
                      <span className="text-xs text-(--color-muted-2)">{m.playersWaiting}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Nudge de CRO (usa contadores sintéticos: solo fuera de mainnet) */}
          {SHOW_SYNTHETIC_ACTIVITY && (
            <div className="mt-5 rounded-lg border border-(--color-border) bg-(--color-ink) p-3 text-center">
              <p className="text-sm font-medium text-(--color-accent-2)">
                {meta.premium
                  ? t("table.nudgeVip", { n: meta.playersWaiting })
                  : t("table.nudgeNormal", { n: meta.playersWaiting, bet: selected })}
              </p>
            </div>
          )}

          {/* CTA */}
          <div className="mt-5">
            <button onClick={buscarRival} className="btn3d btn3d--magenta w-full">
              {t("table.cta", { bet: selected })}
            </button>
            <p className="mt-2 text-center text-sm text-(--color-muted-2)">{t("table.norisk")}</p>
          </div>

          {/* Desglose del pozo */}
          <div className="win mt-5">
            <div className="win-title win-title--cyan">
              <span>{t("table.pot")}</span>
            </div>
            <div className="p-4 text-base">
              <Row label={t("table.yourBet")} value={`${selected} USDC`} />
              <Row label={t("table.rivalBet")} value={`${selected} USDC`} />
              <Row label={t("table.totalPot")} value={`${getPayout(selected).pot} USDC`} />
              <Row
                label={t("table.fee", { pct: PLATFORM_FEE * 100 })}
                value={`- ${getPayout(selected).fee} USDC`}
              />
              <div className="my-2 border-t border-(--color-border)" />
              <Row label={t("table.prize")} value={`${getPayout(selected).prize} USDC`} highlight />
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

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-(--color-muted-2)">{label}</span>
      <span className={highlight ? "font-pixel text-sm text-(--color-win)" : "text-(--color-text)"}>
        {value}
      </span>
    </div>
  );
}
