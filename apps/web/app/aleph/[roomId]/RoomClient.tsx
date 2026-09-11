"use client";

// UNA SALA DE ALEPH, contada en texto. Mientras se juega muestra lo público y
// se refresca sola; cuando termina, el registro entero: qué pasó en cada etapa,
// lo que se dijeron (susurros incluidos, que recién ahí se publican), la tabla
// de pagos y cómo verificarla sin confiar en nosotros.
import { use, useCallback, useEffect, useState } from "react";
import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { useT } from "@/app/lib/i18n";
import { CountdownIn } from "@/app/components/Countdown";
import { storyFromResults } from "@/app/lib/alephStory";
import {
  getAlephRoom,
  getAlephLog,
  warmUpArbiter,
  type AlephRoomView,
  type AlephLog,
} from "@/app/lib/arbiter";

const ARBITER = process.env.NEXT_PUBLIC_ARBITER_URL || "http://localhost:4000";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`;

export function RoomClient({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const { t } = useT();
  // undefined = cargando · null = no existe · objeto = la sala
  const [room, setRoom] = useState<AlephRoomView | null | undefined>(undefined);
  const [log, setLog] = useState<AlephLog | null>(null);

  const load = useCallback(() => {
    getAlephRoom(roomId).then(setRoom);
  }, [roomId]);

  useEffect(() => {
    warmUpArbiter();
    load();
  }, [load]);

  // Sondeo mientras la sala siga viva. Depende del ESTADO, no del objeto: si
  // dependiera del objeto, cada respuesta reiniciaría el intervalo.
  const status = room?.status;
  useEffect(() => {
    if (!status || status === "settled" || status === "dissolved") return;
    const id = setInterval(load, 5_000);
    return () => clearInterval(id);
  }, [status, load]);

  // El registro completo se pide una sola vez, y solo cuando hay algo que pedir
  // (el árbitro lo cierra hasta que la sala se liquida).
  useEffect(() => {
    if (status === "settled" && !log)
      getAlephLog(roomId)
        .then(setLog)
        .catch(() => {});
  }, [status, log, roomId]);

  /** Cómo se muestra un asiento: su nombre de perfil si tiene, o la dirección corta. */
  const seatName = useCallback(
    (address: string) => {
      const seat = room?.seats.find((s) => s.address.toLowerCase() === address.toLowerCase());
      if (!seat?.name) return short(address);
      return seat.avatar ? `${seat.avatar} ${seat.name}` : seat.name;
    },
    [room],
  );

  if (room === undefined) {
    return <p className="py-10 text-center text-base text-(--color-accent-2)">…</p>;
  }

  if (room === null) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <p className="py-8 text-base text-(--color-muted)">{t("aleph.room.notFound")}</p>
        <Link href="/aleph" className="btn3d btn3d--cyan inline-block">
          {t("aleph.room.back")}
        </Link>
      </div>
    );
  }

  const alive = room.seats.filter((s) => s.status === "alive").length;
  const story = storyFromResults(room.results ?? [], seatName);
  const messages = room.messages ?? [];
  const payouts = Object.entries(room.payouts ?? {}).sort((a, b) => b[1] - a[1]);
  // Se extrae acá (en vez de usar `room.stage!` dentro de un callback más abajo)
  // porque TypeScript no arrastra el narrowing de `room.stage &&` adentro de un
  // closure como `.filter(...)`: con la constante, el tipo ya queda angosto.
  const stage = room.stage;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/aleph" className="text-sm font-medium text-(--color-accent-2) hover:underline">
        {t("aleph.room.back")}
      </Link>

      {/* Cabecera: el tablero de un vistazo */}
      <div className="win mt-3">
        <div className="win-title">
          <span className="font-mono">{short(room.roomId)}</span>
          <span className={`chip ${room.status === "playing" ? "chip--live" : ""}`}>
            {t(`aleph.room.status.${room.status}`)}
          </span>
        </div>
        <div className="p-5">
          {room.status === "lobby" && (
            <p className="text-base text-(--color-muted)">
              {t("aleph.room.waiting")}{" "}
              {room.closesAt && (
                <span className="text-(--color-muted-bright)">
                  <CountdownIn label={t("aleph.room.closes")} to={room.closesAt} onZero={load} />
                </span>
              )}
            </p>
          )}
          {room.status === "dissolved" && (
            <p className="text-base text-(--color-muted)">{t("aleph.room.dissolvedBody")}</p>
          )}

          {(room.status === "playing" || room.status === "settled") && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-base">
              <Stat label={t("aleph.room.pot")} value={room.pot ?? 0} />
              <Stat label={t("aleph.room.box")} value={room.box ?? 0} />
              {room.cardsLeft !== undefined && room.status === "playing" && (
                <span className="self-end text-sm text-(--color-muted-3)">
                  {t("aleph.room.cards", { n: room.cardsLeft })}
                </span>
              )}
            </div>
          )}

          {/* Asientos */}
          <p className="mt-4 text-xs tracking-wide text-(--color-muted-3)">
            {t("aleph.room.seats")}
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {room.seats.map((s) => (
              <li
                key={s.address}
                className="flex items-center justify-between rounded-lg bg-(--color-surface-2) px-3 py-2 text-sm"
              >
                <span className="font-mono text-(--color-muted-bright)">{seatName(s.address)}</span>
                <span className="flex items-center gap-3 text-(--color-muted-3)">
                  <span>{t(`aleph.seat.${s.status}`)}</span>
                  {room.status !== "lobby" && (
                    <span className="font-pixel text-(--color-gold)">
                      {s.pocket}{" "}
                      <span className="font-sans text-(--color-muted-3)">
                        {t("aleph.room.pocket")}
                      </span>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* La etapa en curso */}
      {room.status === "playing" && stage && (
        <div className="win mt-6">
          <div className="win-title win-title--cyan">
            <span>
              {t("aleph.room.stage", {
                n: stage.index + 1,
                kind: t(`aleph.stage.${stage.kind}`),
              })}
            </span>
            <span className="chip">{t(`aleph.room.phase.${stage.phase}`)}</span>
          </div>
          <div className="p-5 text-base text-(--color-muted)">
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>{t("aleph.room.acted", { n: stage.acted.length, total: alive })}</span>
              {room.deadline && (
                <span className="text-(--color-muted-bright)">
                  <CountdownIn label={t("aleph.room.closes")} to={room.deadline} onZero={load} />
                </span>
              )}
            </p>
            <Messages
              items={messages.filter((m) => m.stage === stage.index)}
              name={seatName}
              t={t}
            />
            <p className="mt-4 text-sm text-(--color-muted-3)">{t("aleph.room.liveNote")}</p>
          </div>
        </div>
      )}

      {/* El registro, etapa por etapa */}
      {story.length > 0 && (
        <div className="win mt-6">
          <div className="win-title">
            <span>{t("aleph.room.story")}</span>
          </div>
          <div className="flex flex-col gap-5 p-5">
            {story.map((s) => (
              <div key={s.index}>
                <h2 className="font-pixel text-sm text-(--color-text-strong)">
                  {t("aleph.room.stage", {
                    n: s.n,
                    kind: t(`aleph.stage.${s.kind}`),
                  })}
                </h2>
                <div className="mt-2 flex flex-col gap-1 text-base leading-relaxed text-(--color-muted)">
                  {s.lines.map((line, i) => (
                    <p
                      key={i}
                      className={
                        line.key === "aleph.story.after" ? "text-sm text-(--color-muted-3)" : ""
                      }
                    >
                      {t(line.key, line.vars)}
                    </p>
                  ))}
                </div>
                <Messages
                  items={messages.filter((m) => m.stage === s.index)}
                  name={seatName}
                  t={t}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabla de pagos */}
      {payouts.length > 0 && (
        <div className="win mt-6">
          <div className="win-title win-title--cyan">
            <span>{t("aleph.room.payouts")}</span>
          </div>
          <ol className="flex flex-col gap-1 p-5">
            {payouts.map(([address, units], i) => (
              <li
                key={address}
                className="flex items-center justify-between rounded-lg bg-(--color-surface-2) px-3 py-2.5"
              >
                <span className="font-mono text-sm text-(--color-muted-bright)">
                  {i === 0 ? "🥇 " : ""}
                  {seatName(address)}
                </span>
                <span className="font-pixel text-sm text-(--color-gold)">{units}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Verificación: el compromiso, la semilla y cómo re-simularlo */}
      {log && (
        <div className="win mt-6">
          <div className="win-title">
            <span>{t("aleph.room.verify.title")}</span>
          </div>
          <div className="flex flex-col gap-3 p-5 text-base text-(--color-muted)">
            <p>{t("aleph.room.verify.body", { n: log.events.length })}</p>
            <p className="font-mono text-sm text-(--color-muted-3)">
              {t("aleph.room.verify.commit")}: {shortHash(log.commit)}
              <br />
              {t("aleph.room.verify.seed")}: {shortHash(log.secretSeed)}
            </p>
            <pre className="overflow-x-auto rounded-lg bg-(--color-ink) p-4 font-mono text-[13px] leading-6 text-(--color-muted-bright)">
              <code>{`node --import tsx scripts/aleph-verify.mjs ${ARBITER} ${room.roomId}`}</code>
            </pre>
            <a
              href={`${ARBITER}/aleph/${room.roomId}/log`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sm text-(--color-accent-2) hover:underline"
            >
              {ARBITER}/aleph/{short(room.roomId)}/log →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex flex-col">
      <span className="text-xs text-(--color-muted-3)">{label}</span>
      <span className="font-pixel text-lg text-(--color-gold)">{value}</span>
    </span>
  );
}

/** Lo que se dijeron en una etapa. Los susurros llegan solo cuando la sala
 *  terminó (el árbitro no los filtra antes), y se marcan como privados. */
function Messages({
  items,
  name,
  t,
}: {
  items: { from: string; to?: string; text: string }[];
  name: (a: string) => string;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs tracking-wide text-(--color-muted-3)">{t("aleph.room.msgs")}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((m, i) => (
          <li key={i} className="rounded-lg bg-(--color-surface-2) px-3 py-2 text-sm">
            <span className="font-mono text-(--color-accent-2)">{name(m.from)}</span>
            {m.to && (
              <span className="ml-1 text-xs text-(--color-muted-3)">
                ({t("aleph.room.whisper", { to: name(m.to) })})
              </span>
            )}
            <span className="ml-2 text-(--color-muted-bright)">{m.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
