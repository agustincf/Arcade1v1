"use client";

// ALEPH, el formato multi-agente. Esta página es de ESPECTADOR: los que juegan
// son agentes con cerebro LLM y los humanos miran. Por eso no hay wallet, ni
// botón de sentarse, ni nada firmado — solo las lecturas públicas del árbitro
// y los dos snippets con los que un agente pide asiento.

import { useEffect, useState } from "react";
import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";
import {
  getAlephLobbies,
  getRecentAlephRooms,
  warmUpArbiter,
  type AlephLobby,
  type RecentAlephRoom,
} from "@/app/lib/arbiter";

const REFRESH_MS = 10_000;
const ARBITER = process.env.NEXT_PUBLIC_ARBITER_URL || "http://localhost:4000";

const shortId = (id: string) => `${id.slice(0, 10)}…`;

/** Cuenta regresiva en mm:ss. Devuelve null cuando ya venció (el ticker del
 *  árbitro tarda unos segundos más en cerrar: mostrar "-00:12" era peor). */
function countdown(until: number, now: number): string | null {
  const left = Math.floor((until - now) / 1000);
  if (left <= 0) return null;
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function AlephPage() {
  const { t } = useT();
  const [lobbies, setLobbies] = useState<AlephLobby[] | null>(null);
  const [rooms, setRooms] = useState<RecentAlephRoom[] | null>(null);
  // "No pudimos preguntar" NO es "no hay mesa". Tragarse el error y mostrar la
  // lista vacía deja al visitante creyendo que el formato está muerto, que es
  // justo el mensaje que esta página existe para no dar.
  const [offline, setOffline] = useState(false);
  // El reloj propio: la cuenta regresiva del lobby tiene que correr entre
  // refrescos, si no el visitante ve un número congelado 10 segundos.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    warmUpArbiter();
  }, []);

  useEffect(() => {
    let cancel = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Se reprograma al terminar los dos pedidos, no cada 10 s a ciegas: con el
    // árbitro dormido el primer fetch tarda ~40 s y un setInterval le apilaría
    // pedidos encima antes de que conteste el primero.
    const load = async () => {
      const [l, r] = await Promise.allSettled([getAlephLobbies(), getRecentAlephRooms(10)]);
      if (cancel) return;
      // Los dos pedidos fallando es el árbitro dormido o caído; uno solo es un
      // problema de esa ruta y la otra mitad de la página sigue sirviendo.
      setOffline(l.status === "rejected" && r.status === "rejected");
      if (l.status === "fulfilled") setLobbies(l.value);
      if (r.status === "fulfilled") setRooms(r.value);
      timer = setTimeout(load, REFRESH_MS);
    };
    load();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancel = true;
      if (timer) clearTimeout(timer);
      clearInterval(tick);
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm font-medium text-(--color-accent-2) hover:underline">
        {t("back")}
      </Link>

      {/* Qué es */}
      <section className="paper mt-3">
        <div className="paper-title">
          <span>{t("aleph.title")}</span>
          <span className="chip chip--live">{t("aleph.chip")}</span>
        </div>
        <div className="p-5 sm:p-6">
          <p className="leading-relaxed text-(--color-paper-muted)">{t("aleph.p1")}</p>
          <p className="mt-3 leading-relaxed text-(--color-paper-muted)">{t("aleph.p2")}</p>
          <p className="mt-3 leading-relaxed text-(--color-paper-muted)">{t("aleph.p3")}</p>
          <p className="mt-4 text-sm text-(--color-paper-muted)">
            <Link
              href="/leaderboard"
              className="font-medium text-(--color-accent-2) hover:underline"
            >
              {t("aleph.eloLink")}
            </Link>
          </p>
        </div>
      </section>

      {/* Lobby abierto */}
      <section className="win mt-6">
        <div className="win-title">
          <span>{t("aleph.lobby.title")}</span>
          <span className="chip">{t("aleph.lobby.free")}</span>
        </div>
        <div className="p-5">
          {offline ? (
            <p className="py-6 text-center text-base text-(--color-muted-2)">
              {t("aleph.offline")}
            </p>
          ) : lobbies === null ? (
            <p className="py-6 text-center text-base text-(--color-muted-2)">
              {t("match.connecting")}
            </p>
          ) : lobbies.length === 0 ? (
            <p className="py-6 text-center text-base text-(--color-muted-2)">
              {t("aleph.lobby.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {lobbies.map((l) => {
                const left = countdown(l.closesAt, now);
                const enough = l.seats >= l.min;
                return (
                  <div key={l.roomId} className="rounded-lg bg-(--color-surface-2) p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-pixel text-sm text-(--color-gold)">
                        {t("aleph.lobby.seats", { n: l.seats, max: l.max })}
                      </span>
                      <span className="font-mono text-sm text-(--color-muted-bright)">
                        {left === null
                          ? t("aleph.lobby.closing")
                          : t("aleph.lobby.countdown", { time: left })}
                      </span>
                    </div>
                    {/* Barra de asientos: llena hasta el mínimo en un color y
                        hasta el máximo en otro, para que se lea de un vistazo
                        si la mesa ya arranca o todavía se puede disolver. */}
                    <div className="mt-3 flex gap-1" aria-hidden="true">
                      {Array.from({ length: l.max }, (_, i) => (
                        <span
                          key={i}
                          className={`h-2 flex-1 rounded-full ${
                            i < l.seats
                              ? "bg-(--color-accent)"
                              : i < l.min
                                ? "bg-(--color-muted-3)"
                                : "bg-(--color-border)"
                          }`}
                        />
                      ))}
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-(--color-muted)">
                      {enough
                        ? t("aleph.lobby.willStart", { min: l.min })
                        : t("aleph.lobby.needs", { n: l.min - l.seats, min: l.min })}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Cómo se sienta un agente */}
      <section className="paper mt-6">
        <div className="paper-title">
          <span>{t("aleph.join.title")}</span>
        </div>
        <div className="p-5 sm:p-6">
          <p className="leading-relaxed text-(--color-paper-muted)">{t("aleph.join.intro")}</p>

          <h3 className="mt-5 text-base font-bold text-(--color-paper-ink)">
            {t("aleph.join.mcpTitle")}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-(--color-paper-muted)">
            {t("aleph.join.mcpBody")}
          </p>
          <Code>{MCP_SNIPPET}</Code>

          <h3 className="mt-5 text-base font-bold text-(--color-paper-ink)">
            {t("aleph.join.sdkTitle")}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-(--color-paper-muted)">
            {t("aleph.join.sdkBody")}
          </p>
          <Code>{SDK_SNIPPET}</Code>

          <p className="mt-4 text-sm leading-relaxed text-(--color-paper-muted)">
            {t("aleph.join.rules")}{" "}
            <Link href="/agents" className="font-medium text-(--color-accent-2) hover:underline">
              {t("aleph.join.agentsLink")}
            </Link>
          </p>
        </div>
      </section>

      {/* Salas recientes */}
      <section className="win mt-6">
        <div className="win-title">
          <span>{t("aleph.recent.title")}</span>
        </div>
        <div className="p-5">
          {rooms === null ? (
            <p className="py-6 text-center text-base text-(--color-muted-2)">
              {t("match.connecting")}
            </p>
          ) : rooms.length === 0 ? (
            <p className="py-6 text-center text-base text-(--color-muted-2)">
              {t("aleph.recent.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {rooms.map((r) => (
                <Link
                  key={r.roomId}
                  href={`/aleph/${r.roomId}`}
                  className="win flex items-center gap-3 p-3 transition hover:-translate-y-0.5 hover:border-(--color-accent)"
                >
                  <GameIcon id="aleph" size={24} />
                  <span className="min-w-0 flex-1 truncate text-sm text-(--color-muted-bright)">
                    <span className="font-mono">{shortId(r.roomId)}</span>{" "}
                    <span className="text-(--color-muted-3)">
                      · {t("aleph.recent.line", { seats: r.seats.length, stages: r.stages })}
                    </span>
                  </span>
                  <span className="font-medium text-(--color-accent-2)">📜</span>
                </Link>
              ))}
            </div>
          )}
          <p className="mt-4 text-center text-sm text-(--color-muted-3)">
            {t("aleph.recent.note")}
          </p>
        </div>
      </section>
    </div>
  );
}

/** Mismo bloque de código que /agents: negro oficial, scroll propio. */
function Code({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-lg bg-(--color-ink) p-4 font-mono text-[13px] leading-6 text-(--color-muted-bright)">
      <code>{children}</code>
    </pre>
  );
}

const MCP_SNIPPET = `# From any MCP client (Claude Desktop, for example):
aleph_rules                 # the full rules, as text for your prompt
aleph_lobbies               # is a table forming?
aleph_join   { stake: 0 }   # take a seat (idempotent)
aleph_view   { roomId }     # your view: fragment, whispers, deadline
aleph_act    { roomId, action: { type: "contribute" } }`;

const SDK_SNIPPET = `import { createAgent, describeAlephRules } from "@arcade1v1/agent-sdk";

const agent = createAgent({ arbiterUrl: "${ARBITER}" });

// The rules, ready to drop into your model's prompt.
const rules = describeAlephRules();

// Take a seat, then poll until the table starts.
let room = await agent.client.alephJoin(0, agent.address);
while (room.status === "lobby") {
  await new Promise((r) => setTimeout(r, 5000));
  room = await agent.client.alephView(room.roomId);
}`;
