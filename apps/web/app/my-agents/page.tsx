"use client";

// MIS AGENTES: el "garage" del usuario. Lista sus agentes hosteados con ELO,
// historial W/L y pausa/reanudar. Todo lo administrativo va firmado.

import { useCallback, useEffect, useState } from "react";
import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { useSignMessage } from "wagmi";
import { agentAuthMessage } from "@arcade1v1/game-sdk/auth";
import { useT } from "@/app/lib/i18n";
import { useWallet } from "@/app/lib/wallet";
import { GameIcon } from "@/app/components/GameIcon";
import { listAgents, agentAction, warmUpArbiter, type AgentView } from "@/app/lib/arbiter";
import { failureText } from "@/app/lib/errors";
import { ProfileEditor } from "./ProfileEditor";

export default function MyAgentsPage() {
  const { t } = useT();
  const { address, connect } = useWallet();
  const { signMessageAsync } = useSignMessage();
  const [agents, setAgents] = useState<AgentView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Motivo del fallo, visible: pausar/reanudar fallaba EN SILENCIO (firma
  // cancelada o rechazo del server) y el botón parecía roto.
  const [err, setErr] = useState<{ key: string; vars?: Record<string, string | number> } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setAgents(await listAgents(address));
    } catch {
      setAgents([]);
    }
  }, [address]);

  useEffect(() => {
    warmUpArbiter();
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggle(a: AgentView) {
    setBusy(a.id);
    setErr(null);
    const action = a.active ? "pause" : "resume";
    const ts = Date.now();
    let signature: string;
    try {
      signature = await signMessageAsync({
        message: agentAuthMessage(action, a.id, a.owner, ts),
      });
    } catch (e) {
      setErr(failureText("sign", e));
      setBusy(null);
      return;
    }
    try {
      await agentAction(a.id, { action, signature, ts });
      await refresh();
    } catch (e) {
      setErr(failureText("server", e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm font-medium text-(--color-accent-2) hover:underline">
        {t("back")}
      </Link>

      {/* Tu perfil humano (nombre + avatar): vive acá, el hub del que ya entró. */}
      {address && (
        <div className="mt-3">
          <ProfileEditor address={address} />
        </div>
      )}

      <div className="win mt-3">
        <div className="win-title">
          <span>{t("myagents.title")}</span>
          <span className="chip !text-(--color-lime)">{agents?.length ?? "…"}</span>
        </div>
        <div className="p-5">
          {!address ? (
            <div className="py-8 text-center">
              <p className="text-base font-medium text-(--color-accent-2)">
                {t("myagents.connect")}
              </p>
              <button onClick={connect} className="btn3d btn3d--magenta mt-5">
                {t("connect")}
              </button>
            </div>
          ) : agents === null ? (
            <p className="py-8 text-center text-base text-(--color-muted-2)">
              {t("match.connecting")}
            </p>
          ) : agents.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-base text-(--color-muted)">{t("myagents.empty")}</p>
              <Link href="/build" className="btn3d btn3d--magenta mt-5 inline-block">
                🤖 {t("myagents.buildFirst")}
              </Link>
            </div>
          ) : (
            <>
              {err && (
                <p className="mb-3 text-center text-sm text-(--color-lose)">
                  {t(err.key, err.vars)}
                </p>
              )}
              <div className="flex flex-col gap-3">
                {agents.map((a) => (
                  <div key={a.id} className="win flex items-center gap-3 p-3">
                    <span className="text-3xl">{a.avatar}</span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/my-agents/${a.id}`}
                        className="font-pixel block truncate text-xs text-(--color-text) hover:text-(--color-accent-2)"
                      >
                        {a.name}
                      </Link>
                      <div className="mt-1 flex items-center gap-2 text-sm text-(--color-muted-2)">
                        <GameIcon id={a.game} size={16} />
                        <span>
                          ELO <b className="text-(--color-gold)">{a.rating}</b>
                        </span>
                        <span>
                          {a.stats.wins}W · {a.stats.losses}L · {a.stats.draws}D
                        </span>
                      </div>
                    </div>
                    <span
                      className={`chip ${a.active ? "!text-(--color-lime)" : "!text-(--color-muted-3)"}`}
                    >
                      {a.active ? t("myagents.active") : t("myagents.paused")}
                    </span>
                    <button
                      onClick={() => toggle(a)}
                      disabled={busy === a.id}
                      className="btn3d btn3d--sm btn3d--cyan disabled:opacity-50"
                    >
                      {a.active ? "❚❚" : "▶"}
                    </button>
                  </div>
                ))}
              </div>
              <Link
                href="/build"
                className="btn3d btn3d--magenta mt-5 inline-block w-full text-center"
              >
                + {t("myagents.buildAnother")}
              </Link>
            </>
          )}
        </div>
      </div>

      <p className="mt-3 text-center text-sm leading-relaxed text-(--color-muted-2)">
        {t("myagents.note")}
      </p>
    </div>
  );
}
