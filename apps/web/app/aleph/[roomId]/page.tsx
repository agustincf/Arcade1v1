"use client";

// UNA SALA DE ALEPH, contada en texto. No hay tablero que dibujar: lo que pasó
// es una secuencia de decisiones, así que la página NARRA el registro etapa por
// etapa — quién guardó, quién aceptó la oferta, a quién votaron, quién traicionó
// en la Cerradura, la Final y la tabla de pagos.
//
// Mientras la sala está `playing` se pide la vista PÚBLICA cada pocos segundos:
// nunca trae fragmentos ajenos, decisiones pendientes ni la semilla. Recién con
// la sala `settled` el árbitro revela la semilla y abre el registro firmado.

import { use, useEffect, useState } from "react";
import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { useT } from "@/app/lib/i18n";
import { playerLabel, agentTag } from "@/app/lib/wallet";
import {
  getAlephRoom,
  warmUpArbiter,
  type AlephRoomView,
  type AlephSeatView,
} from "@/app/lib/arbiter";

/** Sondeo del espectador. El agente que juega sondea cada 5 s; la web mira, así
 *  que va más lento: mismo dato, la mitad de pedidos al árbitro dormilón. */
const REFRESH_MS = 10_000;

/** Sondeos fallidos seguidos antes de rendirse. Uno solo no alcanza: el árbitro
 *  se duerme y un deploy corta cualquier pedido en curso. */
const MAX_FAILS = 5;

const ARBITER = process.env.NEXT_PUBLIC_ARBITER_URL || "http://localhost:4000";

type T = (key: string, vars?: Record<string, string | number>) => string;

function mmss(ms: number): string {
  const left = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
}

export default function AlephRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const { t } = useT();
  const [room, setRoom] = useState<AlephRoomView | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    warmUpArbiter();
  }, []);

  useEffect(() => {
    let cancel = false;
    let fails = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Se reprograma SOLO al terminar cada pedido, en vez de un setInterval: con
    // el árbitro dormido el primer fetch tarda ~40 s, y un intervalo de 10 s le
    // apilaría cuatro pedidos encima antes de que conteste el primero.
    const load = async () => {
      try {
        const r = await getAlephRoom(roomId);
        if (cancel) return;
        fails = 0;
        setError(false);
        setRoom(r);
        // Sala terminada o disuelta: no hay nada más que mirar, no se
        // reprograma. Una pestaña olvidada deja de pedir sola.
        if (r.status === "settled" || r.status === "dissolved") return;
      } catch {
        if (cancel) return;
        // Un pedido que falla NO es el final: el árbitro duerme, y un reinicio
        // o un deploy cortan cualquier sondeo. Antes, un solo error dejaba la
        // página en "sala no encontrada" para siempre sobre una sala sana. Se
        // reintenta, y recién con MAX_FAILS seguidos se deja de pedir.
        setError(true);
        if (++fails >= MAX_FAILS) return;
      }
      timer = setTimeout(load, REFRESH_MS);
    };
    load();
    return () => {
      cancel = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomId]);

  // El reloj propio solo corre mientras haya una cuenta regresiva que mover:
  // en una sala liquidada, `now` no se muestra en ningún lado y el intervalo
  // era un re-render por segundo hasta que cerraran la pestaña.
  const counting = room?.status === "playing" && room.deadline !== undefined;
  useEffect(() => {
    if (!counting) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [counting]);

  // Con una sala ya cargada, un sondeo que falla no la borra de la pantalla:
  // se sigue mostrando lo último bueno mientras se reintenta.
  if (error && !room) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <p className="py-8 text-base text-(--color-muted)">{t("aleph.room.notFound")}</p>
        <Link href="/aleph" className="btn3d btn3d--cyan inline-block">
          {t("back")}
        </Link>
      </div>
    );
  }
  if (!room) {
    return (
      <p className="py-10 text-center text-base text-(--color-muted-2)">{t("match.connecting")}</p>
    );
  }

  const label = (address: string) => {
    const s = room.seats.find((x) => x.address.toLowerCase() === address.toLowerCase());
    return s
      ? playerLabel(s.address, s.name, s.avatar, agentTag(s, t))
      : address.slice(0, 10) + "…";
  };

  const live = room.status === "playing";
  const results = room.results ?? [];

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/aleph" className="text-sm font-medium text-(--color-accent-2) hover:underline">
        {t("aleph.room.back")}
      </Link>

      {/* Encabezado: identidad de la sala y en qué anda */}
      <section className="win mt-3">
        <div className="win-title">
          <span className="truncate">
            {t("aleph.room.title")} <span className="font-mono">{room.roomId.slice(0, 10)}…</span>
          </span>
          <span className={`chip ${live ? "chip--live" : ""}`}>
            {t(`aleph.room.status.${room.status}`)}
          </span>
        </div>
        <div className="p-5">
          {room.status === "lobby" ? (
            <p className="text-base leading-relaxed text-(--color-muted)">
              {t("aleph.room.lobbyIntro", {
                n: room.seats.length,
                min: room.min,
                max: room.max,
              })}
            </p>
          ) : room.status === "dissolved" ? (
            <p className="text-base leading-relaxed text-(--color-muted)">
              {t("aleph.room.dissolved", { min: room.min })}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-4">
                <Money label={t("aleph.room.pot")} value={room.pot ?? 0} accent />
                <Money label={t("aleph.room.box")} value={room.box ?? 0} />
                <Money label={t("aleph.room.potInitial")} value={room.potInitial ?? 0} muted />
              </div>
              {live && room.stage && (
                <p className="mt-4 text-base leading-relaxed text-(--color-muted)">
                  {t("aleph.room.nowPlaying", {
                    stage: room.stage.index + 1,
                    kind: t(`aleph.stage.${room.stage.kind}`),
                    phase: t(`aleph.phase.${room.stage.phase}`),
                  })}
                  {room.deadline ? (
                    <>
                      {" "}
                      <span className="font-mono text-(--color-muted-bright)">
                        {t("aleph.room.deadline", { time: mmss(room.deadline - now) })}
                      </span>
                    </>
                  ) : null}
                </p>
              )}
              {live && (
                <p className="mt-2 text-sm text-(--color-muted-3)">{t("aleph.room.liveNote")}</p>
              )}
            </>
          )}
        </div>
      </section>

      {/* Asientos */}
      <section className="win mt-6">
        <div className="win-title">
          <span>{t("aleph.room.seats")}</span>
          <span className="chip">{room.seats.length}</span>
        </div>
        <div className="p-3">
          <ol className="flex flex-col gap-1">
            {room.seats.map((s) => (
              <SeatRow key={s.address} seat={s} payout={room.payouts?.[s.address]} t={t} />
            ))}
          </ol>
        </div>
      </section>

      {/* El registro contado */}
      <section className="paper mt-6">
        <div className="paper-title">
          <span>{t("aleph.room.storyTitle")}</span>
        </div>
        <div className="p-5 sm:p-6">
          {results.length === 0 ? (
            <p className="leading-relaxed text-(--color-paper-muted)">
              {t("aleph.room.storyEmpty")}
            </p>
          ) : (
            <ol className="flex flex-col gap-5">
              {results.map((r) => (
                <li key={r.index}>
                  <h3 className="text-base font-bold text-(--color-paper-ink)">
                    {t("aleph.room.stageHead", {
                      n: r.index + 1,
                      kind: t(`aleph.stage.${r.kind}`),
                    })}
                  </h3>
                  <ul className="mt-1 flex flex-col gap-1">
                    {stageLines(r, label, t).map((line, i) => (
                      <li key={i} className="leading-relaxed text-(--color-paper-muted)">
                        {line}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* Tabla de pagos + verificación (solo con la sala terminada) */}
      {room.status === "settled" && room.payouts && (
        <section className="win mt-6">
          <div className="win-title">
            <span>{t("aleph.room.payouts")}</span>
            <span className="chip chip--money">{t("aleph.room.units")}</span>
          </div>
          <div className="p-5">
            <ol className="flex flex-col gap-1">
              {Object.entries(room.payouts)
                .sort((a, b) => b[1] - a[1])
                .map(([address, amount], i) => (
                  <li
                    key={address}
                    className="flex items-center justify-between rounded-lg bg-(--color-surface-2) px-3 py-2.5"
                  >
                    <span className="font-pixel w-8 shrink-0 text-center text-sm text-(--color-muted-bright)">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-sm text-(--color-muted-bright)">
                      {label(address)}
                    </span>
                    <span className="font-pixel text-sm text-(--color-gold)">{amount}</span>
                  </li>
                ))}
            </ol>

            <p className="mt-4 text-sm leading-relaxed text-(--color-muted-3)">
              {t("aleph.room.verify")}
            </p>
            {room.secretSeed && (
              <dl className="mt-2 flex flex-col gap-1 font-mono text-[12px] break-all text-(--color-muted-3)">
                <div>
                  <dt className="inline">{t("aleph.room.commit")}: </dt>
                  <dd className="inline">{room.commit}</dd>
                </div>
                <div>
                  <dt className="inline">{t("aleph.room.seed")}: </dt>
                  <dd className="inline">{room.secretSeed}</dd>
                </div>
              </dl>
            )}
            <p className="mt-3">
              <a
                href={`${ARBITER}/aleph/${room.roomId}/log`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-(--color-accent-2) hover:underline"
              >
                {t("aleph.room.rawLog")} ↗
              </a>
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

function Money({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: number;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <div className="text-sm text-(--color-muted-3)">{label}</div>
      <div
        className={`font-pixel text-sm ${
          accent
            ? "text-(--color-gold)"
            : muted
              ? "text-(--color-muted-3)"
              : "text-(--color-muted-bright)"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function SeatRow({ seat, payout, t }: { seat: AlephSeatView; payout?: number; t: T }) {
  return (
    <li className="flex items-center justify-between rounded-lg bg-(--color-surface-2) px-3 py-2.5">
      <span className="min-w-0 flex-1 truncate font-mono text-sm text-(--color-muted-bright)">
        {playerLabel(seat.address, seat.name, seat.avatar, agentTag(seat, t))}
      </span>
      <span className="ml-3 flex shrink-0 items-center gap-2">
        <span className="chip">{t(`aleph.seat.${seat.status}`)}</span>
        <span className="font-pixel text-sm text-(--color-gold)">{payout ?? seat.pocket}</span>
      </span>
    </li>
  );
}

/** Una etapa resuelta, contada en frases. Es la traducción de StageResult a
 *  lenguaje humano: cada campo del resultado tiene su línea, y solo aparecen
 *  las que esa etapa realmente usó. */
function stageLines(
  r: NonNullable<AlephRoomView["results"]>[number],
  label: (a: string) => string,
  t: T,
): string[] {
  const lines: string[] = [];
  const names = (xs?: string[]) => (xs ?? []).map(label).join(", ");

  if (r.kind === "share") {
    if (r.kept?.length) lines.push(t("aleph.line.kept", { who: names(r.kept) }));
    if (r.contributed?.length)
      lines.push(t("aleph.line.contributed", { who: names(r.contributed) }));
    if (r.bonus) lines.push(t("aleph.line.shareBonus", { n: r.bonus }));
  }

  if (r.kind === "offer") {
    lines.push(t("aleph.line.offer", { pct: ((r.offerBps ?? 0) / 100).toFixed(1) }));
    if (r.voided) lines.push(t("aleph.line.offerVoided"));
    else if (r.accepted?.length)
      lines.push(t("aleph.line.accepted", { who: names(r.accepted), each: r.eachGot ?? 0 }));
    else lines.push(t("aleph.line.offerNobody"));
  }

  if (r.kind === "vote") {
    const votes = Object.entries(r.votes ?? {})
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([a, n]) => `${label(a)} (${n})`)
      .join(", ");
    if (votes) lines.push(t("aleph.line.votes", { tally: votes }));
    if (r.eliminated) lines.push(t("aleph.line.eliminated", { who: label(r.eliminated) }));
  }

  if (r.kind === "lock") {
    if (r.failed) lines.push(t("aleph.line.lockFailed"));
    else {
      lines.push(t("aleph.line.lockSolved", { who: names(r.solvers), code: r.code ?? "" }));
      if (r.traitors?.length)
        lines.push(t("aleph.line.traitors", { who: names(r.traitors), each: r.eachGot ?? 0 }));
      else if (r.bonus) lines.push(t("aleph.line.lockClean", { n: r.bonus }));
    }
  }

  if (r.kind === "final") {
    const entries = Object.entries(r.choices ?? {});
    const thieves = entries.filter(([, c]) => c === "steal").map(([a]) => a);
    lines.push(
      t("aleph.line.finalChoices", {
        detail: entries.map(([a, c]) => `${label(a)}: ${t(`aleph.choice.${c}`)}`).join(" · "),
      }),
    );
    if (thieves.length === 0) lines.push(t("aleph.line.finalSplit"));
    else if (thieves.length === 1)
      lines.push(t("aleph.line.finalSteal", { who: label(thieves[0]) }));
    else lines.push(t("aleph.line.finalBurn"));
  }

  if (r.abandoned?.length) lines.push(t("aleph.line.abandoned", { who: names(r.abandoned) }));
  if (r.decay) lines.push(t("aleph.line.decay", { n: r.decay }));
  lines.push(t("aleph.line.after", { pot: r.potAfter, box: r.boxAfter }));
  return lines;
}
