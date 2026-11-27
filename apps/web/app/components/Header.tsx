"use client";

import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { Logo } from "@/app/components/Logo";
import { SoundToggle } from "@/app/components/SoundToggle";
import { LanguageSelector } from "@/app/components/LanguageSelector";
import { useT } from "@/app/lib/i18n";
import { walletButtonMode } from "@/app/lib/wallet-button";
import { CHAIN } from "@/app/lib/wagmi";
import { WrongNetworkDialog } from "@/app/components/WrongNetworkDialog";

// Header minimalista: logo + controles. Ranking vive en el footer y la red
// (testnet) se informa en el footer — acá no compite con la acción principal.
export function Header() {
  const { t } = useT();
  // La ventana de "otra red" se cierra sola cuando la wallet ya está en la red
  // de la app (la cambió desde la ventana o a mano en el celular) o se
  // desconectó: así no reaparece abierta la próxima vez.
  // "click": la abrió el usuario desde "RED EQUIVOCADA". "connect": se abrió
  // sola al terminar de conectar en otra red (el cambio de red que pide la
  // conexión no llegó a tiempo: ver lib/tope-cambio-de-red.ts).
  const [netOpen, setNetOpen] = useState<false | "click" | "connect">(false);
  const { isConnected, chainId, status } = useAccount();
  const wrongNet = isConnected && chainId !== undefined && chainId !== CHAIN.id;
  useEffect(() => {
    if (!wrongNet) setNetOpen(false);
  }, [wrongNet]);
  // Recién conectada (no al recargar con la sesión guardada) y en otra red: la
  // ventana se abre sola, ya explicando cómo cambiarla a mano.
  const prevStatus = useRef(status);
  useEffect(() => {
    const before = prevStatus.current;
    prevStatus.current = status;
    if (before === "connecting" && status === "connected" && wrongNet) setNetOpen("connect");
  }, [status, wrongNet]);
  return (
    <header className="sticky top-0 z-40 border-b border-(--color-border) bg-(--color-ink)/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
        {/* En mobile el nombre va más chico y, por debajo de 350 px, se esconde
            (queda el ícono, que también lleva a la home): si no, el botón de la
            wallet se sale de la pantalla a 360 y a 320 px. */}
        <Link href="/" aria-label="Arcade1v1" className="flex shrink-0 items-center gap-2">
          <Logo size={24} />
          {/* El logotipo es la única pixel en minúsculas del sitio (normal-case).
              8 px en celular (a 16 no entra junto a la wallet) y 16 en adelante. */}
          <span className="font-pixel text-px8 normal-case text-(--color-accent) max-[349px]:hidden sm:text-px16">
            Arcade1v1
          </span>
        </Link>

        {/* min-w-0 permite que la dirección de la wallet se recorte con "…" en
            vez de desbordar la pantalla (en mobile generaba scroll lateral).
            Es un <nav> y no un <div>: sin landmark, un lector de pantalla no
            tiene forma de saltar directo a la navegación del sitio. */}
        <nav aria-label="Principal" className="flex min-w-0 items-center gap-2 sm:gap-3">
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
              // En otra red, el menú de la cuenta no abre (RainbowKit lo deja en
              // un no-op): va la ventana de red propia, que cambia de red o
              // desconecta, y explica qué hacer si el pedido no llega a la
              // wallet (la de RainbowKit esperaba para siempre).
              const mode = walletButtonMode({
                connected: !!connected,
                unsupportedChain: !!chain?.unsupported,
              });
              const onClick =
                mode === "connect"
                  ? openConnectModal
                  : mode === "chain"
                    ? () => setNetOpen("click")
                    : openAccountModal;
              return (
                <>
                  <button
                    onClick={onClick}
                    className={`btn3d min-w-0 whitespace-nowrap !px-3 !py-2 ${mode === "account" ? "btn3d--cyan" : "btn3d--magenta"}`}
                  >
                    {mode === "chain" ? (
                      <span className="block max-w-[7.5rem] truncate sm:max-w-none">
                        {t("wallet.wrongNetwork")}
                      </span>
                    ) : connected ? (
                      // normal-case: el botón va en mayúsculas, pero "0x…" no se
                      // escribe "0X…" (y un nombre ENS tampoco se grita).
                      <span className="block max-w-[7.5rem] truncate normal-case sm:max-w-none">
                        ● {account.displayName}
                      </span>
                    ) : (
                      <>
                        <span className="sm:hidden">{t("connect.short")}</span>
                        <span className="hidden sm:inline">{t("connect")}</span>
                      </>
                    )}
                  </button>
                  {mode === "chain" && netOpen && (
                    <WrongNetworkDialog
                      initialPhase={netOpen === "connect" ? "failed" : "idle"}
                      onClose={() => setNetOpen(false)}
                    />
                  )}
                </>
              );
            }}
          </ConnectButton.Custom>
        </nav>
      </div>
    </header>
  );
}
