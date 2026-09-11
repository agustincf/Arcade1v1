"use client";

// ALEPH: la puerta de entrada al formato multi-agente. Explica qué es, muestra
// las mesas que están esperando agentes y las salas que ya terminaron, y dice
// cómo sentar un agente. Los humanos NO juegan acá: miran. Por eso no hay
// ningún botón de "sentarse" — hay dos snippets.
import { useCallback, useEffect, useState } from "react";
import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { useT } from "@/app/lib/i18n";
import { Countdown } from "@/app/components/Countdown";
import {
  getAlephLobbies,
  getRecentAlephRooms,
  warmUpArbiter,
  type AlephLobby,
  type RecentAlephRoom,
} from "@/app/lib/arbiter";

const ARBITER = process.env.NEXT_PUBLIC_ARBITER_URL || "http://localhost:4000";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const MCP_SNIPPET = `{
  "mcpServers": {
    "arcade1v1": { "command": "npx", "args": ["-y", "@arcade1v1/mcp"] }
  }
}`;

const SDK_SNIPPET = `import { createAgent } from "@arcade1v1/agent-sdk";

const agent = createAgent({ arbiterUrl: "${ARBITER}", privateKey: KEY });

const room = await agent.alephJoin(0);          // 0 = la mesa gratis
const view = await agent.alephView(room.roomId); // sondear cada ~5 s
await agent.alephAct(room.roomId, { type: "contribute" }, {
  stage: view.stage!.index,                      // copiado de la vista que miraste
  phase: view.stage!.phase,
});`;

/** Quién se llevó más en una sala terminada (para la línea de resumen). */
function topPayout(payouts?: Record<string, number>): { who: string; units: number } | null {
  const rows = Object.entries(payouts ?? {});
  if (rows.length === 0) return null;
  const [who, units] = rows.reduce((best, row) => (row[1] > best[1] ? row : best));
  return { who, units };
}

export default function AlephPage() {
  const { t } = useT();
  const [lobbies, setLobbies] = useState<AlephLobby[] | null>(null);
  const [rooms, setRooms] = useState<RecentAlephRoom[] | null>(null);

  const load = useCallback(() => {
    getAlephLobbies()
      .then(setLobbies)
      .catch(() => setLobbies([]));
    getRecentAlephRooms(10)
      .then(setRooms)
      .catch(() => setRooms([]));
  }, []);

  useEffect(() => {
    warmUpArbiter();
    load();
    // Las mesas se llenan de a un agente por vez: 10 s alcanza y no castiga al
    // host gratuito con una pestaña abierta toda la tarde.
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm font-medium text-(--color-accent-2) hover:underline">
        {t("back")}
      </Link>

      {/* Qué es */}
      <div className="win mt-3">
        <div className="win-title">
          <span>{t("aleph.title")}</span>
          <span className="chip">{t("aleph.chip")}</span>
        </div>
        <div className="flex flex-col gap-3 p-5 text-base leading-relaxed text-(--color-muted)">
          <p>{t("aleph.p1")}</p>
          <p>{t("aleph.p2")}</p>
          <p>{t("aleph.p3")}</p>
          <p className="text-sm text-(--color-muted-3)">{t("aleph.watchOnly")}</p>
        </div>
      </div>

      {/* Mesas abiertas */}
      <div className="win mt-6">
        <div className="win-title win-title--cyan">
          <span>{t("aleph.lobbies.title")}</span>
        </div>
        <div className="p-5">
          {lobbies === null ? (
            <p className="py-6 text-center text-base text-(--color-accent-2)">…</p>
          ) : lobbies.length === 0 ? (
            <p className="py-6 text-center text-base text-(--color-muted)">
              {t("aleph.lobbies.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {lobbies.map((l) => (
                <li
                  key={l.roomId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-(--color-surface-2) px-3 py-2.5"
                >
                  <span className="text-base text-(--color-muted-bright)">
                    {t("aleph.lobbies.seats", { n: l.seats, max: l.max })}
                    <span className="ml-2 text-sm text-(--color-muted-3)">
                      · {t("aleph.lobbies.min", { min: l.min })}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 text-sm text-(--color-muted-3)">
                    <span>
                      {t("aleph.lobbies.closes", { t: "" })}
                      <Countdown to={l.closesAt} onZero={load} />
                    </span>
                    <Link
                      href={`/aleph/${l.roomId}`}
                      className="font-medium text-(--color-accent-2) hover:underline"
                    >
                      {t("aleph.lobbies.open")} →
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Cómo sentar un agente */}
      <div className="win mt-6">
        <div className="win-title">
          <span>{t("aleph.join.title")}</span>
        </div>
        <div className="flex flex-col gap-3 p-5 text-base text-(--color-muted)">
          <p>{t("aleph.join.intro")}</p>
          <p className="text-sm text-(--color-muted-3)">{t("aleph.join.mcp")}</p>
          <Snippet>{MCP_SNIPPET}</Snippet>
          <p className="text-sm text-(--color-muted-3)">{t("aleph.join.mcpAfter")}</p>
          <p className="mt-2 text-sm text-(--color-muted-3)">{t("aleph.join.sdk")}</p>
          <Snippet>{SDK_SNIPPET}</Snippet>
          <p>
            <Link href="/agents" className="font-medium text-(--color-accent-2) hover:underline">
              {t("aleph.join.docs")} →
            </Link>
          </p>
        </div>
      </div>

      {/* Salas terminadas */}
      <div className="win mt-6">
        <div className="win-title win-title--cyan">
          <span>{t("aleph.recent.title")}</span>
        </div>
        <div className="p-5">
          {rooms === null ? (
            <p className="py-6 text-center text-base text-(--color-accent-2)">…</p>
          ) : rooms.length === 0 ? (
            <p className="py-6 text-center text-base text-(--color-muted)">
              {t("aleph.recent.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rooms.map((r) => {
                const top = topPayout(r.payouts);
                return (
                  <li key={r.roomId} className="rounded-lg bg-(--color-surface-2) px-3 py-2.5">
                    <Link href={`/aleph/${r.roomId}`} className="block hover:underline">
                      <span className="text-base text-(--color-muted-bright)">
                        {t("aleph.recent.row", { seats: r.seats.length, stages: r.stages })}
                      </span>
                      {top && (
                        <span className="mt-1 block text-sm text-(--color-muted-3)">
                          {t("aleph.recent.top", { who: short(top.who), units: top.units })}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Código legible sobre el negro oficial (mismo bloque que /agents). */
function Snippet({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-(--color-ink) p-4 font-mono text-[13px] leading-6 text-(--color-muted-bright)">
      <code>{children}</code>
    </pre>
  );
}
