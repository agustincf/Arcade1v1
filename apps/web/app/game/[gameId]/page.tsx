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
        <p className="text-slate-400">Ese juego no existe.</p>
        <Link href="/" className="mt-4 inline-block text-[--color-accent]">
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
    <div>
      <Link href="/" className="text-sm text-slate-400 hover:text-white">
        ← Volver
      </Link>

      <div className="mb-8 mt-3 flex items-center gap-3">
        <span className="text-4xl">{game.emoji}</span>
        <div>
          <h1 className="text-2xl font-bold">{game.name}</h1>
          <p className="text-sm text-slate-400">Elegi tu mesa de apuesta</p>
        </div>
      </div>

      {/* Mesas */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {BET_AMOUNTS.map((bet) => {
          const { prize } = getPayout(bet);
          const active = selected === bet;
          return (
            <button
              key={bet}
              onClick={() => setSelected(bet)}
              className={`rounded-2xl border p-5 text-left transition ${
                active
                  ? "border-[--color-accent] bg-[--color-surface-2] ring-2 ring-[--color-accent]"
                  : "border-[--color-border] bg-[--color-surface] hover:border-slate-500"
              }`}
            >
              <div className="text-2xl font-extrabold">{bet} USDC</div>
              <div className="mt-1 text-xs text-slate-400">tu apuesta</div>
              <div className="mt-3 text-sm font-semibold text-[--color-win]">
                Ganas {prize} USDC
              </div>
            </button>
          );
        })}
      </div>

      {/* Detalle del pozo */}
      {selected !== null && (
        <div className="mt-6 rounded-xl border border-[--color-border] bg-[--color-surface] p-5 text-sm">
          <h3 className="mb-3 font-semibold">Como se reparte el pozo</h3>
          <Row label="Tu apuesta" value={`${selected} USDC`} />
          <Row label="Apuesta del rival" value={`${selected} USDC`} />
          <Row label="Pozo total" value={`${getPayout(selected).pot} USDC`} bold />
          <Row
            label={`Comision plataforma (${PLATFORM_FEE * 100}%)`}
            value={`- ${getPayout(selected).fee} USDC`}
          />
          <div className="my-2 border-t border-[--color-border]" />
          <Row
            label="Premio al ganador"
            value={`${getPayout(selected).prize} USDC`}
            highlight
          />
        </div>
      )}

      {/* Accion */}
      <div className="mt-6">
        {!connected ? (
          <button
            onClick={connect}
            className="w-full rounded-xl bg-[--color-accent] px-5 py-4 font-semibold text-white hover:opacity-90"
          >
            Conecta tu billetera para jugar
          </button>
        ) : (
          <button
            onClick={buscarRival}
            disabled={selected === null}
            className="w-full rounded-xl bg-[--color-accent] px-5 py-4 font-semibold text-white transition enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {selected === null
              ? "Elegi una mesa"
              : `Buscar rival · apostar ${selected} USDC`}
          </button>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-slate-400">{label}</span>
      <span
        className={`${bold ? "font-semibold" : ""} ${
          highlight ? "text-lg font-extrabold text-[--color-win]" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
