"use client";

import Link from "next/link";
import { NETWORK_LABEL } from "@/app/lib/config";
import { useWallet, shortAddress } from "@/app/lib/wallet";

export function Header() {
  const { connected, address, connect, disconnect } = useWallet();

  return (
    <header className="sticky top-0 z-20 border-b border-[--color-border] bg-[--color-bg]/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span className="text-xl">🕹️</span>
          <span className="text-lg tracking-tight">Arcade1v1</span>
        </Link>

        <div className="flex items-center gap-3">
          <span className="hidden rounded-full border border-[--color-border] bg-[--color-surface] px-3 py-1 text-xs text-amber-300 sm:inline">
            {NETWORK_LABEL}
          </span>

          {connected ? (
            <button
              onClick={disconnect}
              className="rounded-lg border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm font-medium hover:bg-[--color-surface-2]"
              title="Desconectar"
            >
              🟢 {shortAddress(address!)}
            </button>
          ) : (
            <button
              onClick={connect}
              className="rounded-lg bg-[--color-accent] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Conectar billetera
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
