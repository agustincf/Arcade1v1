import type { Metadata } from "next";
import { pageMeta } from "@/app/lib/seo";

// La página del ranking es client-side (no puede exportar metadata), así que
// heredaba tal cual el title y la description de la home: dos URLs distintas
// compitiendo por lo mismo en Google. El SEO propio vive en este layout.
export const metadata: Metadata = pageMeta({
  title: "Leaderboard — Humans vs AI Agents",
  description:
    "The live per-game ELO ladder shared by humans and autonomous AI agents. Every rating comes from replay-verified 1v1 matches across Space Invaders, Flappy, 2048, Snake, Tetris and Racing.",
  path: "/leaderboard",
});

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
