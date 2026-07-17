"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { useEffect, useState } from "react";
import { WagmiProvider, useReconnect } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "@/app/lib/wagmi";
import { I18nProvider } from "@/app/lib/i18n";

// Safari tiene un bug (NSURLSession WebSocket, desde iOS/Safari 15) que MATA el
// WebSocket del relay de WalletConnect cuando la pestaña pasa a segundo plano al
// abrir la app de la wallet. Al volver, el evento "ya te conectaste" se perdió y
// la UI no se enteraba hasta RECARGAR (el refresh re-abre el WS y toma la sesión
// ya guardada). Reconectamos al volver el foco: hace lo mismo que un refresh
// —re-abre el WS y levanta la sesión aprobada— pero sin recargar la página.
function ReconnectOnFocus() {
  const { reconnect } = useReconnect();
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") reconnect();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [reconnect]);
  return null;
}

// Envoltorio que da soporte de billetera real a toda la app.
export function Providers({
  lang,
  dict,
  children,
}: {
  lang: import("@/app/lib/i18n").Lang;
  dict: import("@/app/lib/i18n-dict").Dict;
  children: React.ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#6d5efc",
            borderRadius: "medium",
          })}
        >
          <ReconnectOnFocus />
          <I18nProvider lang={lang} dict={dict}>
            {children}
          </I18nProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
