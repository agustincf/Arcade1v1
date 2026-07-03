"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { SoundToggle } from "@/app/components/SoundToggle";
import { LanguageSelector } from "@/app/components/LanguageSelector";
import { useT } from "@/app/lib/i18n";

// Header minimalista: logo + controles. Ranking vive en el footer y la red
// (testnet) se informa en el footer — acá no compite con la acción principal.
export function Header() {
  const { t } = useT();
  return (
    <header className="sticky top-0 z-40 border-b border-(--color-border) bg-(--color-ink)/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl">🕹️</span>
          <span className="font-pixel text-sm text-(--color-accent)">Arcade1v1</span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <SoundToggle />
          <LanguageSelector />

          {/* Boton de conexion (MetaMask / WalletConnect) */}
          <ConnectButton.Custom>
            {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
              const connected = mounted && account && chain;
              return (
                <button
                  onClick={connected ? openAccountModal : openConnectModal}
                  className={`btn3d whitespace-nowrap !px-3 !py-2 !text-px10 ${connected ? "btn3d--cyan" : "btn3d--magenta"}`}
                >
                  {connected ? (
                    `● ${account.displayName}`
                  ) : (
                    <>
                      <span className="sm:hidden">WALLET</span>
                      <span className="hidden sm:inline">{t("connect")}</span>
                    </>
                  )}
                </button>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </div>
    </header>
  );
}
