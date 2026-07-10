"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Logo } from "@/app/components/Logo";
import { SoundToggle } from "@/app/components/SoundToggle";
import { LanguageSelector } from "@/app/components/LanguageSelector";
import { useT } from "@/app/lib/i18n";

// Header minimalista: logo + controles. Ranking vive en el footer y la red
// (testnet) se informa en el footer — acá no compite con la acción principal.
export function Header() {
  const { t } = useT();
  return (
    <header className="sticky top-0 z-40 border-b border-(--color-border) bg-(--color-ink)/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Logo size={24} />
          <span className="font-pixel text-sm text-(--color-accent)">Arcade1v1</span>
        </Link>

        {/* min-w-0 permite que la dirección de la wallet se recorte con "…" en
            vez de desbordar la pantalla (en mobile generaba scroll lateral). */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* "Mis agentes" es de quien vuelve: vive acá y no en el hero. En
              mobile el header no da el ancho; queda el acceso del footer. */}
          <Link
            href="/my-agents"
            className="hidden text-sm font-medium text-(--color-muted-2) transition hover:text-(--color-text) sm:inline"
          >
            {t("nav.myagents")}
          </Link>
          <SoundToggle />
          <LanguageSelector />

          {/* Boton de conexion (MetaMask / WalletConnect) */}
          <ConnectButton.Custom>
            {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
              const connected = mounted && account && chain;
              return (
                <button
                  onClick={connected ? openAccountModal : openConnectModal}
                  className={`btn3d min-w-0 whitespace-nowrap !px-3 !py-2 !text-px10 ${connected ? "btn3d--cyan" : "btn3d--magenta"}`}
                >
                  {connected ? (
                    <span className="block max-w-[7.5rem] truncate sm:max-w-none">
                      ● {account.displayName}
                    </span>
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
