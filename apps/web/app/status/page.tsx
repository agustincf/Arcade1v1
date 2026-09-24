import type { Metadata } from "next";
import { metaDe } from "@/app/lib/seo-pages";
import { getLang } from "@/app/lib/serverLang";
import { StatusClient } from "./StatusClient";

// Página pública de estado del sistema: datos reales del árbitro (uptime,
// partidas, anti-trampa, agentes activos). Es indexable a propósito — la
// transparencia es parte del posicionamiento (verificado on-chain / benchmark).
// Con `metaDe` y no solo title/description: sin el bloque completo, la tarjeta
// para compartir era la de la home (og:url incluido).
export async function generateMetadata(): Promise<Metadata> {
  return metaDe("status", await getLang(), "/status");
}

export default function Page() {
  return <StatusClient />;
}
