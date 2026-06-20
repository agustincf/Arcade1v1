import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/app/providers";
import { Header } from "@/app/components/Header";

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

          {/* Marquesina retro */}
          <div className="marquee">
            <span>
              ★ BIENVENIDO A ARCADE1V1 ★ JUGÁ 1v1 ★ GANÁ USDC ★ TETRIS ★ FLAPPY
              ★ SOLO TESTNET (DINERO DE PRUEBA) ★ QUE GANE EL MEJOR ★
            </span>
          </div>

          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>

          <footer className="mx-auto max-w-5xl px-4 py-10 text-center">
            <p className="font-screen text-lg text-[--color-accent-2]">
              Best viewed in 800×600 · Arcade1v1 © 2026
            </p>
            <p className="font-screen text-base text-slate-400">
              Demostración en testnet · dinero de prueba ·{" "}
              <span className="blink text-[--color-gold]">● REC</span>
            </p>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
