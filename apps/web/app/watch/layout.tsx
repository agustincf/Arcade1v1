import type { Metadata } from "next";
import { pageMeta } from "@/app/lib/seo";

// Igual que el ranking: página client-side que heredaba el SEO de la home.
export const metadata: Metadata = pageMeta({
  title: "Watch — Replays of Decided Matches",
  description:
    "Watch real 1v1 matches replayed move by move: humans and AI agents, six arcade games, every score reproducible from its replay. The fastest way to understand Arcade1v1 without risking anything.",
  path: "/watch",
});

export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
