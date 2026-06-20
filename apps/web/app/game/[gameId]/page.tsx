"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getGame } from "@/app/lib/games";
import { BET_AMOUNTS, getPayout, PLATFORM_FEE } from "@/app/lib/config";
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
  const [selected, setSelected] = useState<number | null>(null);

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

  function buscarRival() {
    if (!connected || selected === null) return;
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
          <span className="win-dots">
            <span className="win-dot" />
            <span className="win-dot" />
            <span className="win-dot" />
          </span>
        </div>

        <div className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="text-5xl">{game.emoji}</span>
            <p className="font-screen text-xl text-slate-300">
              ¿Cuánto querés apostar? Los dos ponen lo mismo.
            </p>
          </div>

          {/* Mesas */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {BET_AMOUNTS.map((bet) => {
              const { prize } = getPayout(bet);
              const active = selected === bet;
              return (
                <button
                  key={bet}
                  onClick={() => setSelected(bet)}
                  className={`win p-3 text-center transition ${
                    active ? "!border-[--color-gold] -translate-y-1" : "hover:-translate-y-0.5"
                  }`}
                >
                  <div className="font-pixel text-base text-[--color-gold]">{bet}</div>
                  <div className="font-screen text-base text-slate-400">USDC</div>
                  <div className="font-screen mt-1 text-base text-[--color-win]">
                    ganás {prize}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Desglose del pozo */}
          {selected !== null && (
            <div className="win mt-5">
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
          )}

          {/* Accion */}
          <div className="mt-5">
            {!connected ? (
              <button onClick={connect} className="btn3d btn3d--magenta w-full">
                CONECTÁ TU BILLETERA
              </button>
            ) : (
              <button
                onClick={buscarRival}
                disabled={selected === null}
                className="btn3d btn3d--magenta w-full"
              >
                {selected === null ? "ELEGÍ UNA MESA" : `► BUSCAR RIVAL (${selected} USDC)`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
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
