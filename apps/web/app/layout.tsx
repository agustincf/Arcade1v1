import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/app/providers";
import { Header } from "@/app/components/Header";

export const metadata: Metadata = {
  title: "Arcade1v1 — Apuestas 1v1",
  description: "Arcade de duelos 1v1 con USDC sobre Base. Solo testnet.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <Providers>
          <Header />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-5xl px-4 py-8 text-center text-xs text-slate-500">
            Arcade1v1 · Demostracion en testnet (dinero de prueba)
          </footer>
        </Providers>
      </body>
    </html>
  );
}
