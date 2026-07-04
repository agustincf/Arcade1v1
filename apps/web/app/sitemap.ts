import type { MetadataRoute } from "next";
import { SITE } from "@/app/lib/seo";
import { GAMES } from "@/app/lib/games";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const games: MetadataRoute.Sitemap = GAMES.filter((g) => g.status === "live").map((g) => ({
    url: `${SITE.url}/game/${g.id}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [
    { url: SITE.url, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE.url}/leaderboard`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    // /agents es el diferenciador del producto: prioridad alta.
    { url: `${SITE.url}/agents`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE.url}/terms`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE.url}/recover`, lastModified: now, changeFrequency: "monthly", priority: 0.2 },
    ...games,
  ];
}
