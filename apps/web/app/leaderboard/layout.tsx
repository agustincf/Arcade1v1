import type { Metadata } from "next";
import { metaDe } from "@/app/lib/seo-pages";
import { getLang } from "@/app/lib/serverLang";

// La página del ranking es client-side (no puede exportar metadata), así que
// heredaba tal cual el title y la description de la home: dos URLs distintas
// compitiendo por lo mismo en Google. El SEO propio vive en este layout.
export async function generateMetadata(): Promise<Metadata> {
  return metaDe("leaderboard", await getLang(), "/leaderboard");
}

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
