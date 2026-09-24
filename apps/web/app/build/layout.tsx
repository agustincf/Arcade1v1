import type { Metadata } from "next";
import { metaDe } from "@/app/lib/seo-pages";
import { getLang } from "@/app/lib/serverLang";

// La página del builder es client-side (no puede exportar metadata); el SEO
// del embudo principal ("creá tu agente sin código") vive en este layout.
export async function generateMetadata(): Promise<Metadata> {
  return metaDe("build", await getLang(), "/build");
}

export default function BuildLayout({ children }: { children: React.ReactNode }) {
  return children;
}
