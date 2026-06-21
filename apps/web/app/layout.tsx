import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/app/providers";
import { Header } from "@/app/components/Header";
import { Marquee } from "@/app/components/Marquee";
import { SiteFooter } from "@/app/components/SiteFooter";

export const metadata: Metadata = {
  title: "Arcade1v1 — Duelos 1v1 por USDC",
  description: "Arcade de duelos 1v1 con USDC sobre Base. Solo testnet.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <Header />
          <Marquee />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
