import type { MetadataRoute } from "next";
import { SITE } from "@/app/lib/seo";
import { GAMES } from "@/app/lib/games";
import { LANGS } from "@/app/lib/i18n-dict";
import { localePath } from "@/app/lib/localePath";

type Freq = MetadataRoute.Sitemap[number]["changeFrequency"];

const ROUTES: { path: string; priority: number; freq: Freq }[] = [
  { path: "/", priority: 1, freq: "daily" },
  // /build es el CTA principal (crear un agente sin código); /agents el diferenciador.
  { path: "/build", priority: 0.9, freq: "weekly" },
  { path: "/agents", priority: 0.9, freq: "weekly" },
  { path: "/leaderboard", priority: 0.7, freq: "daily" },
  { path: "/agents/start", priority: 0.7, freq: "weekly" },
  { path: "/watch", priority: 0.6, freq: "daily" },
  { path: "/terms", priority: 0.3, freq: "monthly" },
  { path: "/recover", priority: 0.2, freq: "monthly" },
  ...GAMES.filter((g) => g.status === "live").map((g) => ({
    path: `/game/${g.id}`,
    priority: 0.8,
    freq: "weekly" as Freq,
  })),
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const abs = (p: string) => `${SITE.url}${p === "/" ? "" : p}`;
  // Una entrada por ruta (URL inglesa = x-default), con las 4 variantes por
  // idioma como alternates para que Google indexe cada idioma.
  return ROUTES.map(({ path, priority, freq }) => ({
    url: abs(path),
    lastModified: now,
    changeFrequency: freq,
    priority,
    alternates: {
      languages: Object.fromEntries(LANGS.map((l) => [l, abs(localePath(l, path))])),
    },
  }));
}
