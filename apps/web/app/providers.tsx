"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "@/app/lib/wagmi";
import { I18nProvider } from "@/app/lib/i18n";

// Envoltorio que da soporte de billetera real a toda la app.
export function Providers({
  initialLang,
  children,
}: {
  initialLang?: import("@/app/lib/i18n").Lang;
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
          <I18nProvider initialLang={initialLang}>{children}</I18nProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
