"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { NETWORK_LABEL } from "@/app/lib/config";
import { SoundToggle } from "@/app/components/SoundToggle";
import { LanguageSelector } from "@/app/components/LanguageSelector";
import { useT } from "@/app/lib/i18n";

export function Header() {
  const { t } = useT();
  return (
    <header className="sticky top-0 z-40 border-b-2 border-[--color-ink] bg-[--color-ink]/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl">🕹️</span>
          <span className="font-pixel text-sm text-[--color-accent] neon">Arcade1v1</span>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/leaderboard"
            className="font-pixel text-px10 text-[--color-gold] hover:underline"
          >
            🏆 <span className="hidden sm:inline">{t("nav.ranking")}</span>
          </Link>

          <span className="chip hidden sm:inline-flex">
            <span className="blink">●</span> {NETWORK_LABEL}
          </span>

          <SoundToggle />
          <LanguageSelector />

          {/* Boton de conexion retro (MetaMask / WalletConnect) */}
          <ConnectButton.Custom>
            {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
              const connected = mounted && account && chain;
              return (
                <button
                  onClick={connected ? openAccountModal : openConnectModal}
                  className="btn3d btn3d--cyan !px-3 !py-2 !text-px10"
                >
                  {connected ? `🟢 ${account.displayName}` : t("connect")}
                </button>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </div>
    </header>
  );
}
