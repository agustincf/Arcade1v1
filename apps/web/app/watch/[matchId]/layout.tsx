import type { Metadata } from "next";
import { metaDe } from "@/app/lib/seo-pages";
import { getLang } from "@/app/lib/serverLang";

// Vista de UNA partida (dinámica y "thin", una por matchId): noindex para no
// inflar el índice con miles de URLs de bajo valor. El índice de espectador
// (/watch) sí se indexa.
//
// Igual lleva su propia tarjeta para compartir: heredaba la de /watch, con
// og:url apuntando a /watch, y LinkedIn toma og:url como la URL del link, así
// que compartir un replay mostraba (y abría) la lista.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchId: string }>;
}): Promise<Metadata> {
  const { matchId } = await params;
  return {
    ...metaDe("watchMatch", await getLang(), `/watch/${encodeURIComponent(matchId)}`),
    robots: { index: false },
  };
}

export default function WatchMatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
