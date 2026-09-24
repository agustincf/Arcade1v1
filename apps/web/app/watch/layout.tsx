import type { Metadata } from "next";
import { metaDe } from "@/app/lib/seo-pages";
import { getLang } from "@/app/lib/serverLang";

// Igual que el ranking: página client-side que heredaba el SEO de la home.
export async function generateMetadata(): Promise<Metadata> {
  return metaDe("watch", await getLang(), "/watch");
}

export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
