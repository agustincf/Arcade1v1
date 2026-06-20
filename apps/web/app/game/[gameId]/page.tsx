"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getGame } from "@/app/lib/games";
import {
  BET_AMOUNTS,
  getPayout,
  PLATFORM_FEE,
  DEFAULT_BET,
  TABLE_META,
  matchBars,
  onlinePlayers,
  type MatchSpeed,
} from "@/app/lib/config";
import { useWallet } from "@/app/lib/wallet";

export default function TableSelectPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = use(params);
  const game = getGame(gameId);
  const router = useRouter();
  const { connected, connect } = useWallet();
  // CRO: arrancamos con la mesa recomendada ya elegida.
  const [selected, setSelected] = useState<number>(DEFAULT_BET);

  if (!game || game.status !== "live") {
    return (
      <div className="text-center">
        <p className="font-screen text-xl text-slate-300">Ese juego no existe.</p>
        <Link href="/" className="font-screen mt-4 inline-block text-xl text-[--color-accent-2]">
          ← Volver al inicio
        </Link>
      </div>
    );
  }

  const meta = TABLE_META[selected];

  function buscarRival() {
    if (!connected) return;
    router.push(`/game/${gameId}/lobby?bet=${selected}`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="font-screen text-xl text-[--color-accent-2] hover:underline">
        ← Volver
      </Link>

      <div className="win mt-3">
        <div className="win-title">
          <span>{game.name.toUpperCase()} · ELEGIR MESA</span>
          {/* Prueba social */}
          <span className="chip">
            <span className="blink">🟢</span> {onlinePlayers()} en línea
          </span>
        </div>

        <div className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="text-5xl">{game.emoji}</span>
            <p className="font-screen text-xl text-slate-300">
              ¿Cuánto querés apostar? Los dos ponen lo mismo.
            </p>
          </div>

          {/* Mesas */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {BET_AMOUNTS.map((bet) => {
              const { prize } = getPayout(bet);
              const m = TABLE_META[bet];
              const active = selected === bet;
              return (
                <button
                  key={bet}
                  onClick={() => setSelected(bet)}
                  className={`win relative p-3 text-center transition ${
                    active
                      ? "!border-[--color-gold] -translate-y-1"
                      : "hover:-translate-y-0.5"
                  }`}
                >
                  {m.recommended && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border-2 border-[#0a0518] bg-[--color-gold] px-1.5 py-0.5 font-pixel text-[7px] text-[#1a0033]">
                      ★ POPULAR
                    </span>
                  )}
                  <div className="font-pixel text-base text-[--color-gold]">{bet}</div>
                  <div className="font-screen text-base text-slate-400">USDC</div>
                  <div className="font-screen text-base text-[--color-win]">
                    ganás {prize}
                  </div>
                  <div className="mt-2 flex items-center justify-center gap-1">
                    <SignalBars speed={m.speed} />
                    <span className="font-screen text-sm text-slate-400">
                      👥 {m.playersWaiting}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Nudge de CRO segun la mesa elegida */}
          <div className="mt-4 rounded border-2 border-[#0a0518] bg-[#0a0518] p-3 text-center">
            <p className="font-screen text-lg text-[--color-accent-2]">
              {meta.speed === "rapido" ? (
                <>⚡ Mesa de {selected} USDC: <b className="text-[--color-gold]">emparejamiento más rápido</b> — {meta.playersWaiting} jugadores buscando ahora.</>
              ) : meta.speed === "lento" ? (
                <>🐢 Mesa de {selected} USDC: pocos jugadores ({meta.playersWaiting}). Probá la de <b className="text-[--color-gold]">20 USDC</b> para emparejar más rápido.</>
              ) : (
                <>👍 Mesa de {selected} USDC: {meta.playersWaiting} buscando. La de <b className="text-[--color-gold]">20 USDC</b> es la que más rápido empareja.</>
              )}
            </p>
          </div>

          {/* Desglose del pozo */}
          <div className="win mt-4">
            <div className="win-title win-title--cyan">
              <span>POZO.LOG</span>
            </div>
            <div className="font-screen p-4 text-lg">
              <Row label="Tu apuesta" value={`${selected} USDC`} />
              <Row label="Apuesta del rival" value={`${selected} USDC`} />
              <Row label="Pozo total" value={`${getPayout(selected).pot} USDC`} />
              <Row
                label={`Comisión (${PLATFORM_FEE * 100}%)`}
                value={`- ${getPayout(selected).fee} USDC`}
              />
              <div className="my-2 border-t-2 border-dashed border-[--color-border]" />
              <Row
                label="Premio al ganador"
                value={`${getPayout(selected).prize} USDC`}
                highlight
              />
            </div>
          </div>

          {/* Accion */}
          <div className="mt-5">
            {!connected ? (
              <button onClick={connect} className="btn3d btn3d--magenta w-full">
                CONECTÁ TU BILLETERA
              </button>
            ) : (
              <button onClick={buscarRival} className="btn3d btn3d--magenta w-full">
                ► BUSCAR RIVAL ({selected} USDC)
              </button>
            )}
            <p className="font-screen mt-2 text-center text-base text-slate-500">
              Sin riesgo: si no aparece rival en 1 hora, se te devuelve todo.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SignalBars({ speed }: { speed: MatchSpeed }) {
  const n = matchBars(speed);
  const color =
    speed === "rapido"
      ? "var(--color-win)"
      : speed === "medio"
        ? "var(--color-gold)"
        : "var(--color-lose)";
  return (
    <span className="flex items-end gap-0.5" title={`Emparejamiento ${speed}`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            height: `${i * 3 + 3}px`,
            backgroundColor: i <= n ? color : "var(--color-border)",
          }}
          className="w-1 rounded-sm"
        />
      ))}
    </span>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-slate-400">{label}</span>
      <span className={highlight ? "font-pixel text-sm text-[--color-win]" : "text-slate-100"}>
        {value}
      </span>
    </div>
  );
}
