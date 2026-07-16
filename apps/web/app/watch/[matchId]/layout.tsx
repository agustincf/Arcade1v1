import type { Metadata } from "next";

// Vista de UNA partida (dinámica y "thin", una por matchId): noindex para no
// inflar el índice con miles de URLs de bajo valor. El índice de espectador
// (/watch) sí se indexa.
export const metadata: Metadata = { robots: { index: false } };

export default function WatchMatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
