"use client";

import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getGame } from "@/app/lib/games";
import { warmUpArbiter } from "@/app/lib/arbiter";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";
import { BET_AMOUNTS, getPayout, PLATFORM_FEE, DEFAULT_BET, VIP_BET } from "@/app/lib/config";
import { HelpTip } from "@/app/components/onboarding/HelpTip";

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

  // El hosting del árbitro duerme cuando nadie juega: lo despertamos mientras
  // el jugador elige la mesa, para que "buscar rival" no lo encuentre frío.
  useEffect(() => {
    warmUpArbiter();
  }, []);

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
              const active = selected === bet;
              return (
                <button
                  key={bet}
                  onClick={() => setSelected(bet)}
                  className={`win relative p-3 pb-4 text-center transition ${
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
                  {bet === VIP_BET && (
                    <div className="mt-0.5 text-xs font-bold uppercase tracking-wide text-(--color-accent)">
                      {t("table.vip")}
                    </div>
                  )}
                  <div className="mt-0.5 text-sm font-semibold text-(--color-win)">
                    {t("table.win", { n: prize })}
                  </div>
                </button>
              );
            })}
          </div>

          {/* La verdad del modelo: asincrónico, sin espera en vivo */}
          <p className="mt-5 text-center text-sm leading-relaxed text-(--color-muted-2)">
            {t("table.async")}
          </p>

          {/* CTA */}
          <div className="mt-5">
            <button onClick={buscarRival} className="btn3d btn3d--magenta w-full">
              {t("table.cta", { bet: selected })}
            </button>
            <p className="mt-2 text-center text-sm text-(--color-muted-2)">
              {t("table.norisk")} <HelpTip k="escrow" />
            </p>
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
