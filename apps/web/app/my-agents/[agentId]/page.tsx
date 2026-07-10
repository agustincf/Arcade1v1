"use client";

// Detalle de un agente hosteado: stats, parámetros, historial de partidas
// (con link para MIRAR cada una) y administración firmada (pausar/borrar).

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSignMessage } from "wagmi";
import { agentAuthMessage } from "@arcade1v1/game-sdk/auth";
import { getStrategy } from "@arcade1v1/strategies";
import { useT } from "@/app/lib/i18n";
import { useWallet } from "@/app/lib/wallet";
import { GameIcon } from "@/app/components/GameIcon";
import { shortAddress, playerLabel } from "@/app/lib/wallet";
import {
  getAgent,
  getAgentMatches,
  agentAction,
  warmUpArbiter,
  type AgentView,
  type AgentMatchSummary,
} from "@/app/lib/arbiter";

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const { t } = useT();
  const router = useRouter();
  const { address } = useWallet();
  const { signMessageAsync } = useSignMessage();
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [matches, setMatches] = useState<AgentMatchSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setAgent(await getAgent(agentId));
      setMatches(await getAgentMatches(agentId));
    } catch {
      setNotFound(true);
    }
  }, [agentId]);

  useEffect(() => {
    warmUpArbiter();
    refresh();
  }, [refresh]);

  const isOwner = agent && address && agent.owner.toLowerCase() === address.toLowerCase();

  async function doAction(action: "pause" | "resume" | "delete") {
    if (!agent) return;
    if (action === "delete" && !window.confirm(t("agent.deleteConfirm"))) return;
    setBusy(true);
    try {
      const ts = Date.now();
      const signature = await signMessageAsync({
        message: agentAuthMessage(action, agent.id, agent.owner, ts),
      });
      await agentAction(agent.id, { action, signature, ts });
      if (action === "delete") router.push("/my-agents");
      else await refresh();
    } catch {
      /* firma cancelada o red caída: sin cambios */
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-base text-(--color-muted)">{t("agent.notFound")}</p>
        <Link href="/my-agents" className="btn3d btn3d--cyan mt-5 inline-block">
          {t("back")}
        </Link>
      </div>
    );
  }
  if (!agent) {
    return (
      <p className="py-10 text-center text-base text-(--color-muted-2)">{t("match.connecting")}</p>
    );
  }

  const def = getStrategy(agent.strategyId);

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/my-agents"
        className="text-sm font-medium text-(--color-accent-2) hover:underline"
      >
        {t("back")}
      </Link>

      {/* Cabecera del agente */}
      <div className="win mt-3">
        <div className="win-title">
          <span>
            {agent.avatar} {agent.name.toUpperCase()}
          </span>
          <span
            className={`chip ${agent.active ? "!text-(--color-lime)" : "!text-(--color-muted-3)"}`}
          >
            {agent.active ? t("myagents.active") : t("myagents.paused")}
          </span>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-4">
            <GameIcon id={agent.game} size={44} />
            <div className="text-base">
              <p className="text-(--color-muted-bright)">{t(`game.${agent.game}.name`)}</p>
              <p className="mt-1 text-sm text-(--color-muted-2)">
                ELO <b className="font-pixel text-(--color-gold)">{agent.rating}</b> ·{" "}
                {agent.stats.wins}W {agent.stats.losses}L {agent.stats.draws}D ·{" "}
                {t("agent.ladderId")}: {shortAddress(agent.address)}
              </p>
            </div>
          </div>

          {/* Parámetros de la estrategia */}
          {def && (
            <div className="win mt-4 p-4 text-sm">
              <p className="font-pixel text-px10 text-(--color-accent-2)">{t(def.labelKey)}</p>
              {def.params.map((p) => (
                <div key={p.key} className="mt-2 flex justify-between">
                  <span className="text-(--color-muted-2)">{t(p.labelKey)}</span>
                  <span className="text-(--color-text)">
                    {Array.isArray(agent.params[p.key])
                      ? (agent.params[p.key] as string[])
                          .map((o) => t(`strat.opt.${o}`))
                          .join(" → ")
                      : p.kind === "choice"
                        ? t(`strat.opt.${String(agent.params[p.key])}`)
                        : String(agent.params[p.key])}
                  </span>
                </div>
              ))}
            </div>
          )}

          {isOwner && (
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => doAction(agent.active ? "pause" : "resume")}
                disabled={busy}
                className="btn3d btn3d--cyan flex-1 disabled:opacity-50"
              >
                {agent.active ? `❚❚ ${t("agent.pause")}` : `▶ ${t("agent.resume")}`}
              </button>
              <button
                onClick={() => doAction("delete")}
                disabled={busy}
                className="btn3d btn3d--magenta flex-1 disabled:opacity-50"
              >
                🗑 {t("agent.delete")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Historial */}
      <div className="win mt-4">
        <div className="win-title win-title--cyan">
          <span>{t("agent.history")}</span>
        </div>
        <div className="p-4">
          {matches.length === 0 ? (
            <p className="py-4 text-center text-sm text-(--color-muted-2)">
              {t("agent.noMatches")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {matches.map((m) => (
                <div
                  key={m.matchId}
                  className="win flex items-center justify-between gap-2 p-2 text-sm"
                >
                  <span
                    className={`font-pixel text-px10 ${
                      m.outcome === "win"
                        ? "text-(--color-win)"
                        : m.outcome === "loss"
                          ? "text-(--color-lose)"
                          : "text-(--color-muted-2)"
                    }`}
                  >
                    {m.outcome === "win" ? "WIN" : m.outcome === "loss" ? "LOSS" : "DRAW"}
                  </span>
                  <span className="text-(--color-muted-bright)">
                    {m.yourScore ?? "?"} - {m.rivalScore ?? "?"}
                  </span>
                  <span className="text-(--color-muted-2)">
                    {t("agent.vs")} {m.opponent ? playerLabel(m.opponent, m.name, m.avatar) : "?"}
                  </span>
                  {typeof m.ratingDelta === "number" && (
                    <span
                      className={m.ratingDelta >= 0 ? "text-(--color-win)" : "text-(--color-lose)"}
                    >
                      {m.ratingDelta >= 0 ? "+" : ""}
                      {m.ratingDelta}
                    </span>
                  )}
                  <Link
                    href={`/watch/${m.matchId}`}
                    className="font-medium text-(--color-accent-2) hover:underline"
                  >
                    🎬 {t("agent.watch")}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
