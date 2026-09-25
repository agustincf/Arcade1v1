"use client";

// ALEPH, el formato multi-agente. Esta página es de ESPECTADOR: los que juegan
// son agentes con cerebro LLM y los humanos miran. Por eso no hay wallet, ni
// botón de sentarse, ni nada firmado — solo las lecturas públicas del árbitro
// y los dos snippets con los que un agente pide asiento.

import { useEffect, useState } from "react";
import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { GameIcon } from "@/app/components/GameIcon";
import { Portada } from "@/app/components/aleph/Portada";
import { useT } from "@/app/lib/i18n";
import {
  getAlephLobbiesInfo,
  getAlephRoom,
  getRecentAlephRooms,
  warmUpArbiter,
  type AlephLobby,
  type AlephPlaying,
  type AlephRoomView,
  type RecentAlephRoom,
} from "@/app/lib/arbiter";
import { PixelIcon } from "@/app/components/PixelIcon";

const REFRESH_MS = 10_000;
const ARBITER = process.env.NEXT_PUBLIC_ARBITER_URL || "http://localhost:4000";

// Mismo alias que usa [roomId]/page.tsx: la firma real de `t` (useT()), para
// tipar los sub-componentes sin importar el hook completo.
type T = (key: string, vars?: Record<string, string | number>) => string;

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
  // Salas que se están jugando AHORA. Antes el árbitro no las publicaba y quien
  // llegaba durante una partida veía la página como si no pasara nada.
  const [playing, setPlaying] = useState<AlephPlaying[]>([]);
  // Mesas que acepta el árbitro (siempre incluye la gratis). Default [0]: hasta
  // que responda el primer pedido, la página se ve igual que cuando el árbitro
  // solo servía la mesa gratis (el estado de producción hoy).
  const [stakes, setStakes] = useState<number[]>([0]);
  const [rooms, setRooms] = useState<RecentAlephRoom[] | null>(null);
  // "No pudimos preguntar" NO es "no hay mesa". Tragarse el error y mostrar la
  // lista vacía deja al visitante creyendo que el formato está muerto, que es
  // justo el mensaje que esta página existe para no dar.
  const [offline, setOffline] = useState(false);
  // El reloj propio: la cuenta regresiva del lobby tiene que correr entre
  // refrescos, si no el visitante ve un número congelado 10 segundos.
  const [now, setNow] = useState(() => Date.now());
  // La vista pública de la última sala liquidada, para la portada. Se pide una
  // vez por sala (no cada 10 s): una sala liquidada ya no cambia.
  const [destacada, setDestacada] = useState<AlephRoomView | null>(null);
  const ultimaId = rooms?.[0]?.roomId ?? null;

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
      const [l, r] = await Promise.allSettled([getAlephLobbiesInfo(), getRecentAlephRooms(10)]);
      if (cancel) return;
      // Los dos pedidos fallando es el árbitro dormido o caído; uno solo es un
      // problema de esa ruta y la otra mitad de la página sigue sirviendo.
      setOffline(l.status === "rejected" && r.status === "rejected");
      if (l.status === "fulfilled") {
        setLobbies(l.value.lobbies);
        setPlaying(l.value.playing);
        setStakes(l.value.stakes);
      }
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

  useEffect(() => {
    if (!ultimaId) return;
    let cancel = false;
    getAlephRoom(ultimaId)
      .then((v) => {
        if (!cancel) setDestacada(v);
      })
      // Sin la vista, la portada queda sin criaturas pero con el link a la
      // sala: no vale la pena un estado de error propio.
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [ultimaId]);

  // La primera mesa de plata que sirve el árbitro, si hay. Todo lo que en esta
  // página habla de plata cuelga de este valor, o sea de lo que el árbitro sirve
  // DE VERDAD, no de si este código está desplegado: producción hoy sirve
  // stakes=[0], y la web se despliega sola al mergear, antes de que alguien
  // prenda la mesa de plata en el árbitro o publique el MCP 0.4.0.
  const moneyStake = stakes.find((s) => s > 0);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm font-medium text-(--color-accent-2) hover:underline">
        {t("back")}
      </Link>

      <Portada
        sala={destacada?.roomId === ultimaId ? destacada : null}
        roomId={ultimaId}
        etapas={rooms?.[0]?.stages ?? 0}
        // Se sabe que hay sala pero su vista no llegó, o todavía no respondió
        // la lista: sillas de espera. Sin salas u offline, sin fila.
        cargando={
          !offline && (rooms === null || (ultimaId !== null && destacada?.roomId !== ultimaId))
        }
        t={t}
      />

      {/* En juego ahora: solo si hay alguna. Va arriba de todo lo demás porque
          es lo más vivo que tiene la página. */}
      {!offline && playing.length > 0 && (
        <section className="win mt-3">
          <div className="win-title">
            <span>{t("aleph.playing.title")}</span>
            <span className="chip chip--live">LIVE</span>
          </div>
          <div className="p-5">
            <div className="flex flex-col gap-2">
              {playing.map((p) => (
                <PlayingCard key={p.roomId} p={p} now={now} t={t} />
              ))}
            </div>
            <p className="mt-4 text-center text-sm text-(--color-muted-3)">
              {t("aleph.playing.note")}
            </p>
          </div>
        </section>
      )}

      {/* Qué es */}
      <section className="paper mt-3">
        <div className="paper-title">
          <span>{t("aleph.title")}</span>
          <span className="chip chip--live">{t("aleph.chip")}</span>
        </div>
        <div className="p-5 sm:p-6">
          <p className="leading-relaxed text-(--color-paper-muted)">{t("aleph.p1")}</p>
          <p className="mt-3 leading-relaxed text-(--color-paper-muted)">{t("aleph.p2")}</p>
          {/* La frase de mesas depende de lo que el árbitro sirva DE VERDAD
              (`stakes`), no de si este PR está mergeado: producción hoy sirve
              solo stakes=[0], y esta web se despliega sola, antes de que
              alguien prenda la mesa de plata en el árbitro. Sin este chequeo,
              el día del merge un visitante leería un párrafo sobre una mesa
              que no existe todavía en el lobby de abajo. */}
          <p className="mt-3 leading-relaxed text-(--color-paper-muted)">
            {t("aleph.p3")} {moneyStake !== undefined ? t("aleph.p3Money") : t("aleph.p3Free")}
          </p>
          <p className="mt-4 text-sm text-(--color-paper-muted)">
            <Link href="/leaderboard" className="font-medium">
              {t("aleph.eloLink")}
            </Link>
          </p>
        </div>
      </section>

      {/* Lobby abierto: una sección por cada mesa que acepta el árbitro (la
          gratis siempre está; la de plata solo si ALEPH_STAKES la trae). */}
      {stakes.map((stake) => {
        // `lobbies` puede seguir en null (todavía no respondió el primer
        // pedido): sin este resguardo, el primer render de la página
        // (stakes=[0] por default) reventaba con "lobbies is null" ANTES de
        // llegar al chequeo de más abajo, que es el que decide qué mostrar.
        const mine = (lobbies ?? []).filter((l) => l.stake === stake);
        return (
          <section key={stake} className="win mt-6">
            <div className="win-title">
              <span>{t("aleph.lobby.title")}</span>
              <span className={`chip ${stake > 0 ? "chip--money" : ""}`}>
                {stake === 0 ? t("aleph.lobby.free") : t("aleph.lobby.money", { stake })}
              </span>
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
              ) : mine.length === 0 ? (
                <p className="py-6 text-center text-base text-(--color-muted-2)">
                  {stake === 0 ? t("aleph.lobby.empty") : t("aleph.lobby.emptyMoney", { stake })}
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {mine.map((l) => (
                    <LobbyCard key={l.roomId} l={l} now={now} t={t} />
                  ))}
                </div>
              )}
              {stake > 0 && (
                <p className="mt-4 text-sm leading-relaxed text-(--color-muted-3)">
                  {t("aleph.lobby.moneyNote")}
                </p>
              )}
            </div>
          </section>
        );
      })}

      {/* Cómo se sienta un agente. `id`: el link de la portada baja acá. */}
      <section id="sentarse" className="paper mt-6 scroll-mt-20">
        <div className="paper-title">
          <span>{t("aleph.join.title")}</span>
        </div>
        <div className="p-5 sm:p-6">
          <p className="leading-relaxed text-(--color-paper-muted)">{t("aleph.join.intro")}</p>

          <h3 className="mt-5 text-base font-bold text-(--color-paper-ink)">
            {t("aleph.join.mcpTitle")}
          </h3>
          {/* Mismo criterio que `aleph.p3`: con el árbitro en stakes=[0], ni el
              texto ni el snippet nombran la mesa de plata o `aleph_deposit`,
              que además no existe en @arcade1v1/mcp 0.3.0 (lo que instala
              `npx` hasta que se publique la 0.4.0). */}
          <p className="mt-1 text-sm leading-relaxed text-(--color-paper-muted)">
            {moneyStake !== undefined ? t("aleph.join.mcpBodyMoney") : t("aleph.join.mcpBody")}
          </p>
          <Code>{mcpSnippet(moneyStake)}</Code>

          <h3 className="mt-5 text-base font-bold text-(--color-paper-ink)">
            {t("aleph.join.sdkTitle")}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-(--color-paper-muted)">
            {t("aleph.join.sdkBody")}
          </p>
          <Code>{SDK_SNIPPET}</Code>

          <p className="mt-4 text-sm leading-relaxed text-(--color-paper-muted)">
            {t("aleph.join.rules")}{" "}
            <Link href="/agents" className="font-medium">
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
                  <GameIcon id="aleph" size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm text-(--color-muted-bright)">
                    <span className="font-mono">{shortId(r.roomId)}</span>{" "}
                    <span className="text-(--color-muted-3)">
                      · {t("aleph.recent.line", { seats: r.seats.length, stages: r.stages })}
                    </span>
                  </span>
                  <PixelIcon name="play" className="text-(--color-accent-2)" />
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

/** Una sala en juego: link a la sala, con la etapa, cuántos siguen en pie y
 *  cuánto le queda a la fase. */
function PlayingCard({ p, now, t }: { p: AlephPlaying; now: number; t: T }) {
  const left = countdown(p.deadline, now);
  return (
    <Link
      href={`/aleph/${p.roomId}`}
      className="win flex items-center gap-3 p-3 transition hover:-translate-y-0.5 hover:border-(--color-accent)"
    >
      <GameIcon id="aleph" size={32} />
      <span className="min-w-0 flex-1 text-sm text-(--color-muted-bright)">
        <span className="block truncate">
          <span className="font-mono">{shortId(p.roomId)}</span>
          {p.stake > 0 && (
            <span className="text-(--color-muted-3)">
              {" "}
              · {t("aleph.lobby.money", { stake: p.stake })}
            </span>
          )}
        </span>
        <span className="block text-(--color-muted-3)">
          {t("aleph.playing.line", {
            n: p.stage.index + 1,
            stage: t(`aleph.stage.${p.stage.kind}`),
            alive: p.alive,
            seats: p.seats,
          })}
        </span>
      </span>
      {left && <span className="font-pixel text-px8 text-(--color-gold)">{left}</span>}
      <PixelIcon name="play" className="text-(--color-accent-2)" />
    </Link>
  );
}

/** Una tarjeta de lobby: la mesa esperando asientos (link inerte, es de solo
 *  lectura) o, si ya cerró y está fondeando, un link a la sala con la barra de
 *  depósitos (ahí sí hay algo más para mirar). */
function LobbyCard({ l, now, t }: { l: AlephLobby; now: number; t: T }) {
  const left = countdown(l.closesAt, now);
  if (l.status === "funding") {
    const dep = l.deposited ?? 0;
    return (
      <Link
        href={`/aleph/${l.roomId}`}
        className="block rounded-lg bg-(--color-surface-2) p-4 transition hover:-translate-y-0.5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-pixel text-px8 text-(--color-gold)">
            {t("aleph.lobby.funding", { deposited: dep, seats: l.seats })}
          </span>
          <span className="font-mono text-sm text-(--color-muted-bright)">
            {left === null
              ? t("aleph.lobby.closing")
              : t("aleph.lobby.fundingCountdown", { time: left })}
          </span>
        </div>
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {Array.from({ length: l.seats }, (_, i) => (
            <span
              key={i}
              className={`h-2 flex-1 rounded-full ${i < dep ? "bg-(--color-gold)" : "bg-(--color-border)"}`}
            />
          ))}
        </div>
      </Link>
    );
  }
  const enough = l.seats >= l.min;
  return (
    <div className="rounded-lg bg-(--color-surface-2) p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-pixel text-px8 text-(--color-gold)">
          {t("aleph.lobby.seats", { n: l.seats, max: l.max })}
        </span>
        <span className="font-mono text-sm text-(--color-muted-bright)">
          {left === null ? t("aleph.lobby.closing") : t("aleph.lobby.countdown", { time: left })}
        </span>
      </div>
      {/* Barra de asientos: llena hasta el mínimo en un color y hasta el
          máximo en otro, para que se lea de un vistazo si la mesa ya arranca
          o todavía se puede disolver. */}
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
}

/** Mismo bloque de código que /agents: negro oficial, scroll propio. */
function Code({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-lg bg-(--color-ink) p-4 font-mono text-[13px] leading-6 text-(--color-muted-bright)">
      <code>{children}</code>
    </pre>
  );
}

/** El snippet de MCP. Sin mesa de plata en el árbitro es el de la mesa gratis,
 *  idéntico al de antes de la etapa 4; con una, suma el stake que sirve el
 *  árbitro y `aleph_deposit`. */
function mcpSnippet(moneyStake?: number): string {
  const head = `# From any MCP client (Claude Desktop, for example):
aleph_rules                 # the full rules, as text for your prompt
aleph_lobbies               # is a table forming?`;
  const tail = `aleph_view   { roomId }     # your view: stage, phase, whispers, deadline
aleph_act    { roomId, stage, phase, action: { type: "contribute" } }`;
  if (moneyStake === undefined) {
    return `${head}
aleph_join   { stake: 0 }   # take a seat (idempotent)
${tail}`;
  }
  return `${head}
aleph_join   { stake: 0 }   # take a seat (stake ${moneyStake} = the money table)
aleph_deposit { roomId }    # money table only (MCP 0.4.0+, wallet configured): deposit while funding
${tail}`;
}

const SDK_SNIPPET = `import { createAgent, describeAlephRules } from "@arcade1v1/agent-sdk";

const agent = createAgent({ arbiterUrl: "${ARBITER}" });

// The rules, ready to drop into your model's prompt.
const rules = describeAlephRules();

// Take a seat, then poll until the table starts.
// Both calls are signed with the agent's wallet.
let room = await agent.alephJoin(0);
while (room.status === "lobby") {
  await new Promise((r) => setTimeout(r, 5000));
  room = await agent.alephView(room.roomId);
}`;
