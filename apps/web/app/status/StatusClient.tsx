"use client";

// Página pública de estado: consume GET /stats del árbitro y muestra métricas
// REALES (nada sintético, regla de la casa): estado del servidor + uptime,
// partidas creadas/decididas (total y hoy), envíos rechazados por el anti-trampa
// y agentes hosteados activos, con un desglose de los últimos días.

import { useEffect, useState } from "react";
import { useT } from "@/app/lib/i18n";
import { getStats, type StatsView } from "@/app/lib/arbiter";

/** Uptime legible a partir de segundos: "2d 3h", "5h 12m", "44m", "30s". */
function fmtUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Fecha epoch(ms) a "YYYY-MM-DD" (UTC, igual que las claves diarias del server). */
function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="win flex flex-col gap-1 p-4">
      <span className="text-sm text-(--color-muted-2)">{label}</span>
      <span className="font-pixel text-lg text-(--color-gold)">{value}</span>
      {sub && <span className="text-sm text-(--color-muted-3)">{sub}</span>}
    </div>
  );
}

export function StatusClient() {
  const { t } = useT();
  const [stats, setStats] = useState<StatsView | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancel = false;
    setStats(null);
    setError(false);
    getStats()
      .then((s) => {
        if (!cancel) setStats(s);
      })
      .catch(() => {
        if (!cancel) setError(true);
      });
    return () => {
      cancel = true;
    };
  }, [reload]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-pixel text-xl leading-relaxed text-(--color-text-strong)">
        {t("status.title")}
      </h1>
      <p className="mt-2 text-base text-(--color-muted)">{t("status.subtitle")}</p>

      {error ? (
        <div className="win mt-6 p-6 text-center">
          <p className="text-base text-(--color-muted)">{t("status.error")}</p>
          <button onClick={() => setReload((n) => n + 1)} className="btn3d btn3d--cyan mt-4">
            {t("status.retry")}
          </button>
        </div>
      ) : !stats ? (
        <p className="py-10 text-center text-base text-(--color-accent-2)">{t("status.loading")}</p>
      ) : (
        <>
          {/* Estado del servidor */}
          <div className="win mt-6">
            <div className="win-title">
              <span>{t("status.server")}</span>
              <span className="chip !text-(--color-lime)">● {t("status.online")}</span>
            </div>
            <div className="p-4 text-base text-(--color-muted)">
              {t("status.uptimeLine", { uptime: fmtUptime(stats.uptimeSeconds) })}
            </div>
          </div>

          {/* Tarjetas de métricas */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile
              label={t("status.matchesCreated")}
              value={String(stats.totals.matchesCreated)}
              sub={t("status.todayN", { n: stats.today.matchesCreated })}
            />
            <StatTile
              label={t("status.matchesSettled")}
              value={String(stats.totals.matchesSettled)}
              sub={t("status.todayN", { n: stats.today.matchesSettled })}
            />
            <StatTile
              label={t("status.activeAgents")}
              value={String(stats.activeAgents)}
              sub={t("status.live")}
            />
            <StatTile
              label={t("status.rejects")}
              value={String(stats.totals.verificationsRejected)}
              sub={t("status.todayN", { n: stats.today.verificationsRejected })}
            />
          </div>
          <p className="mt-2 text-sm text-(--color-muted-3)">{t("status.rejectsHint")}</p>

          {/* Desglose por día */}
          {stats.daily.length > 0 && (
            <div className="win mt-4">
              <div className="win-title win-title--cyan">
                <span>{t("status.byDay")}</span>
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between px-2 pb-2 text-sm text-(--color-muted-3)">
                  <span>{t("status.colDate")}</span>
                  <span className="flex gap-6">
                    <span className="w-16 text-right">{t("status.colCreated")}</span>
                    <span className="w-16 text-right">{t("status.colSettled")}</span>
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {stats.daily
                    .slice(-10)
                    .reverse()
                    .map((row) => (
                      <div
                        key={row.date}
                        className="flex items-center justify-between rounded-lg bg-(--color-surface-2) px-3 py-2 text-sm"
                      >
                        <span className="font-mono text-(--color-muted-bright)">{row.date}</span>
                        <span className="flex gap-6">
                          <span className="w-16 text-right font-pixel text-px10 text-(--color-gold)">
                            {row.matchesCreated}
                          </span>
                          <span className="w-16 text-right font-pixel text-px10 text-(--color-accent-2)">
                            {row.matchesSettled}
                          </span>
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          <p className="mt-4 text-center text-sm text-(--color-muted-3)">
            {t("status.since", { date: fmtDate(stats.since) })}
          </p>
          <p className="mt-1 text-center text-sm text-(--color-muted-3)">{t("status.note")}</p>
        </>
      )}
    </div>
  );
}
