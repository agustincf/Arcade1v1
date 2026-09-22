"use client";

// UNA SALA DE ALEPH, contada en texto. No hay tablero que dibujar: lo que pasó
// es una secuencia de decisiones, así que la página NARRA el registro etapa por
// etapa — quién guardó, quién aceptó la oferta, a quién votaron, quién traicionó
// en la Cerradura, la Final y la tabla de pagos.
//
// Mientras la sala está `playing` se pide la vista PÚBLICA cada pocos segundos:
// nunca trae fragmentos ajenos, decisiones pendientes ni la semilla. Recién con
// la sala `settled` el árbitro revela la semilla y abre el registro firmado.

import { use, useEffect, useRef, useState } from "react";
import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { useT } from "@/app/lib/i18n";
import { playerLabel, agentTag, shortAddress } from "@/app/lib/wallet";
import {
  getAlephLog,
  getAlephRoom,
  warmUpArbiter,
  type AlephLog,
  type AlephRoomView,
} from "@/app/lib/arbiter";
import { txUrl } from "@/app/lib/explorer";
import { mmss } from "@/app/lib/tiempo";
import { Charla } from "@/app/components/aleph/Charla";
import { Escena } from "@/app/components/aleph/Escena";
import { Liquidacion } from "@/app/components/aleph/Liquidacion";
import type { Destello, EtiquetaDeAsiento } from "@/app/components/aleph/nucleo/escena";
import type { AsientoDeSala } from "@/app/components/aleph/nucleo/estados";

/** Sondeo del espectador. El agente que juega sondea cada 5 s; la web mira, así
 *  que va más lento: mismo dato, la mitad de pedidos al árbitro dormilón. */
const REFRESH_MS = 10_000;

/** Sondeos fallidos seguidos antes de rendirse. Uno solo no alcanza: el árbitro
 *  se duerme y un deploy corta cualquier pedido en curso. */
const MAX_FAILS = 5;

const ARBITER = process.env.NEXT_PUBLIC_ARBITER_URL || "http://localhost:4000";

type T = (key: string, vars?: Record<string, string | number>) => string;

export default function AlephRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const { t } = useT();
  const [room, setRoom] = useState<AlephRoomView | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [destello, setDestello] = useState<Destello | null>(null);
  /** `null` mientras se pide; `{ eventos }` con la respuesta, y `eventos` en
   *  `null` si el pedido falló. Sin este tercer estado, la ventana diría "el
   *  registro no respondió" durante los segundos que tarda en responder. */
  const [registro, setRegistro] = useState<{ eventos: AlephLog["events"] | null } | null>(null);
  /** La vista del sondeo anterior: de la diferencia entre las dos sale el
   *  destello. Va en un ref y no en estado porque no se dibuja. */
  const anterior = useRef<AlephRoomView | null>(null);
  const pidioRegistro = useRef(false);

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
        setDestello(destelloEntre(anterior.current, r));
        anterior.current = r;
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
  // era un re-render por segundo hasta que cerraran la pestaña. En `funding`
  // también corre: la mesa de plata tiene su propia cuenta regresiva.
  const counting =
    (room?.status === "playing" && room.deadline !== undefined) ||
    (room?.status === "funding" && room.fundingDeadline !== undefined) ||
    (room?.status === "lobby" && room.closesAt !== undefined);
  useEffect(() => {
    if (!counting) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [counting]);

  // El destello se limpia solo al segundo: la clase tiene que salir del
  // marcado para que el próximo sondeo pueda volver a dispararla. La variable
  // se llama `limpiar` y no `t` porque `t` ya es el traductor de `useT()`.
  useEffect(() => {
    if (!destello) return;
    const limpiar = setTimeout(() => setDestello(null), 1000);
    return () => clearTimeout(limpiar);
  }, [destello]);

  // El registro solo existe con la sala `settled`: antes el árbitro responde
  // 400. Se pide UNA sola vez; si falla, la ventana muestra su línea y el
  // enlace al registro firmado que ya está abajo.
  useEffect(() => {
    if (room?.status !== "settled" || pidioRegistro.current) return;
    pidioRegistro.current = true;
    getAlephLog(roomId)
      .then((log) => setRegistro({ eventos: log.events }))
      .catch(() => setRegistro({ eventos: null }));
  }, [room?.status, roomId]);

  // Si la página cambiara de sala sin desmontarse, los dos refs y el registro
  // quedarían con lo de la sala anterior: el destello se calcularía contra una
  // vista ajena y la ventana de votos mostraría los votos de otra partida. Hoy
  // es inalcanzable (de sala a sala se pasa por `/aleph`, que desmonta), pero
  // cuesta cuatro líneas y saca la trampa de la mesa: por ese camino lo peor
  // que puede pasar es que la ventana de votos no se dibuje, nunca que muestre
  // los votos de otra sala.
  useEffect(() => {
    anterior.current = null;
    pidioRegistro.current = false;
    setRegistro(null);
    setDestello(null);
  }, [roomId]);

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

  const etiquetaDePorDireccion = (address: string) => {
    const s = room.seats.find((x) => x.address.toLowerCase() === address.toLowerCase());
    return s ? playerLabel(s.address, s.name, s.avatar, agentTag(s, t)) : shortAddress(address);
  };

  // La etiqueta en sus dos formas. La ancha es el string plano de
  // `playerLabel`, que entra entero; la angosta son sus tres pedazos, porque a
  // 375 px el string entero no entra y no hay media query que parta un string.
  // Las dos las arma la página, que es la única que puede importar wallet.tsx.
  const etiquetaDe = (seat: AsientoDeSala): EtiquetaDeAsiento => {
    const tag = agentTag(seat, t);
    return {
      plana: playerLabel(seat.address, seat.name, seat.avatar, tag),
      perfil: seat.name ? `${seat.avatar ?? ""} ${seat.name}`.trim() : null,
      wallet: shortAddress(seat.address),
      tag: tag ?? null,
    };
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
          <span className="flex shrink-0 items-center gap-2">
            <span className={`chip ${live ? "chip--live" : ""}`}>
              {t(`aleph.room.status.${room.status}`)}
            </span>
            {room.stake > 0 && (
              <span className="chip chip--money">
                {t("aleph.room.stakeChip", { stake: room.stake })}
              </span>
            )}
          </span>
        </div>
        {room.status === "lobby" ? (
          <div className="p-5">
            <p className="text-base leading-relaxed text-(--color-muted)">
              {t("aleph.room.lobbyIntro", {
                n: room.seats.length,
                min: room.min,
                max: room.max,
              })}
            </p>
          </div>
        ) : room.status === "funding" ? (
          <div className="p-5">
            <p className="text-base leading-relaxed text-(--color-muted)">
              {t("aleph.room.fundingIntro", {
                deposited: room.deposited?.length ?? 0,
                n: room.seats.length,
                stake: room.stake,
              })}{" "}
              {room.fundingDeadline ? (
                <span className="font-mono text-(--color-muted-bright)">
                  {t("aleph.room.fundingDeadline", { time: mmss(room.fundingDeadline - now) })}
                </span>
              ) : null}
            </p>
          </div>
        ) : room.status === "dissolved" ? (
          <div className="p-5">
            <p className="text-base leading-relaxed text-(--color-muted)">
              {room.fundingDeadline !== undefined
                ? t("aleph.room.dissolvedMoney", { n: room.seats.length })
                : t("aleph.room.dissolved", { min: room.min })}
            </p>
            {/* Reembolso de la mesa de plata: el punto de la nota en el brief
                de esta tarea. Simétrico al settleTx/settlePending de abajo:
                un depositante que se queda sin sala tiene que enterarse acá,
                no solo por su wallet. Se muestra solo si la sala llegó a
                fondear (si el lobby se disolvió antes, nunca hubo depósitos
                que devolver y `fundingDeadline` queda undefined). */}
            {room.stake > 0 && room.fundingDeadline !== undefined && (
              <p className="mt-3">
                {room.refundTx && /^0x[0-9a-f]{64}$/i.test(room.refundTx) ? (
                  <a
                    href={txUrl(room.refundTx)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-(--color-accent-2) hover:underline"
                  >
                    {t("aleph.room.refundTx")} ↗
                  </a>
                ) : room.refundOutcome === "none" ? (
                  <span className="text-sm text-(--color-muted-3)">
                    {t("aleph.room.refundNone")}
                  </span>
                ) : (
                  <span className="text-sm text-(--color-muted-3)">
                    {t("aleph.room.refundPending")}
                  </span>
                )}
              </p>
            )}
          </div>
        ) : (
          // Con la sala liquidada el encabezado queda reducido a su barra de
          // ventana con el chip LIQUIDADA y el de stake, que es lo único que
          // ahí sigue siendo verdad: el pozo, la caja y la etapa en curso ya
          // los dibuja la escena, y repetirlos era el duplicado que este
          // rediseño vino a sacar.
          live && (
            <div className="p-5">
              <p className="text-sm text-(--color-muted-3)">{t("aleph.room.liveNote")}</p>
            </div>
          )
        )}
      </section>

      {/* La escena: carta de etapa, friso, mesa y los asientos. Reemplaza a la
          ventana ASIENTOS, a los tres Money del encabezado y a la línea de
          etapa con su contador. */}
      <Escena
        room={room}
        now={now}
        destello={destello}
        t={t}
        etiquetaDe={etiquetaDe}
        etiquetaDePorDireccion={etiquetaDePorDireccion}
      />

      {/* La charla pública. Recibe el MISMO destello que la escena: al liquidar
          es la terminal la que se llena de golpe, y sus líneas de susurro
          entran con el fundido de `aleph-desclasifica`. */}
      <Charla
        room={room}
        t={t}
        etiquetaDePorDireccion={etiquetaDePorDireccion}
        destello={destello}
      />

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
                    {stageLines(r, etiquetaDePorDireccion, t).map((line, i) => (
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

      {/* Quién votó a quién: sale del registro firmado, que solo existe con la
          sala liquidada. La página lo pide una vez y el componente dibuja. */}
      {room.status === "settled" && registro && (
        <Liquidacion
          eventos={registro.eventos}
          etapas={results}
          t={t}
          etiquetaDePorDireccion={etiquetaDePorDireccion}
        />
      )}

      {/* Tabla de pagos + verificación (solo con la sala terminada) */}
      {room.status === "settled" && room.payouts && (
        <section className="win mt-6">
          <div className="win-title">
            <span>{t("aleph.room.payouts")}</span>
            <span className="chip chip--money">
              {t(room.payoutsUsdc ? "aleph.room.usdc" : "aleph.room.units")}
            </span>
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
                      {etiquetaDePorDireccion(address)}
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="font-pixel text-sm text-(--color-gold)">{amount}</span>
                      {room.payoutsUsdc && (
                        <span className="font-mono text-sm text-(--color-gold)">
                          {(Number(room.payoutsUsdc[address] ?? 0) / 1e6).toFixed(2)} USDC
                        </span>
                      )}
                    </span>
                  </li>
                ))}
            </ol>

            {room.payoutsUsdc && (
              // `fee: 15` es la comisión de producción (spec de la etapa 4), no
              // un campo de la vista: el árbitro no manda `usdc.feeBps` acá (solo
              // en el registro completo, `/aleph/:id/log`), así que hasta que la
              // vista lo traiga esto queda como constante documentada.
              <p className="mt-3 text-sm leading-relaxed text-(--color-muted-3)">
                {t("aleph.room.payoutsMoney", { pot: room.stake * room.seats.length, fee: 15 })}
              </p>
            )}
            {room.stake > 0 && (
              <p className="mt-3">
                {room.settleTx && /^0x[0-9a-f]{64}$/i.test(room.settleTx) ? (
                  <a
                    href={txUrl(room.settleTx)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-(--color-accent-2) hover:underline"
                  >
                    {t("aleph.room.settleTx")} ↗
                  </a>
                ) : room.settleOutcome === "external" ? (
                  // Cerrada SIN transacción propia porque otro presentó la tabla
                  // primero (la firma es pública, cualquiera puede) — es el caso
                  // de diseño, no un problema: el pago YA salió, solo que no por
                  // una transacción que el árbitro haya mandado. Un mensaje de
                  // "todavía no salió" acá sería falso para siempre (el árbitro
                  // nunca completa ese hash después).
                  <span className="text-sm text-(--color-muted-3)">
                    {t("aleph.room.settleExternal")}
                  </span>
                ) : (
                  // Sin hash propio y sin "external": genuinamente pendiente
                  // (reintentando), O el caso raro `settleOutcome === "refunded"`
                  // (la ventana de pago venció antes y el contrato devolvió cada
                  // stake en vez de pagar esta tabla). Las dos son mutuamente
                  // excluyentes y no se pueden distinguir con lo que trae la
                  // vista, así que el texto queda deliberadamente cubierto entre
                  // las dos sin afirmar ninguna: nunca hay que decir que un pago
                  // salió si en realidad la plata volvió como reembolso.
                  <span className="text-sm text-(--color-muted-3)">
                    {t("aleph.room.settlePending")}
                  </span>
                )}
              </p>
            )}

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

/** Las animaciones reaccionan a DIFERENCIAS entre dos sondeos, no a eventos: no
 *  hay WebSocket ni SSE, y el árbitro dormido puede tardar 40 s en contestar.
 *  Sin vista anterior no se anima nada —si no, abrir una sala liquidada
 *  dispararía todo el teatro de golpe—. Y NO hay cola: si vuelven tres
 *  resultados juntos de un alt-tab de diez minutos, se anima solo el último y
 *  el resto aparece ya en su estado final, que es la misma disciplina que
 *  `CATCHUP_MAX_MS` en los juegos. */
function destelloEntre(antes: AlephRoomView | null, ahora: AlephRoomView): Destello | null {
  if (!antes) return null;
  const previos = antes.results?.length ?? 0;
  const cuantos = ahora.results?.length ?? 0;
  const ultimo = cuantos > previos ? ahora.results?.[cuantos - 1] : undefined;
  // EL ORDEN DE ESTAS TRES LÍNEAS ES LA DECISIÓN. La Final cierra y liquida en
  // el MISMO sondeo (`closePhase` llama a `settleRoom`, que pone `settled` en
  // el acto), así que todo sondeo con un `final` nuevo es también el de
  // `playing -> settled`: con la liquidación primera, `revela` no se dispara
  // NUNCA y la fila de los dos finalistas nunca se revela. Va primero la
  // Final, que es el caso raro; la liquidación SIN Final —el caso común, una
  // Oferta que deja un solo vivo— se queda con su fundido. Las dos animaciones
  // viven en elementos distintos (las líneas de la terminal y el <ol> de la
  // Final), así que no compiten por el mismo nodo.
  if (ultimo?.kind === "final") return { tipo: "revela" };
  if (antes.status === "playing" && ahora.status === "settled") return { tipo: "desclasifica" };
  if (ultimo?.kind === "lock" && ultimo.traitors?.length)
    return { tipo: "grieta", asientos: ultimo.traitors };
  return null;
}
