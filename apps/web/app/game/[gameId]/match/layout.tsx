import type { Metadata } from "next";

// Pantalla de juego en curso (dinámica, con estado por sesión): noindex. La
// página de la mesa (/game/[gameId]) es la indexable y con SEO por juego.
export const metadata: Metadata = { robots: { index: false } };

export default function MatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
