"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { NETWORK_LABEL } from "@/app/lib/config";

export function Header() {
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
          {/* Boton real de conexion (MetaMask / WalletConnect). */}
          <ConnectButton
            showBalance={false}
            accountStatus="address"
            chainStatus="icon"
          />
        </div>
      </div>
    </header>
  );
}
