import type { Metadata } from "next";
import { pageMeta } from "@/app/lib/seo";

// Igual que /watch: la página es client-side y sin esto heredaría el SEO del home.
export const metadata: Metadata = pageMeta({
  title: "Aleph — The Multi-Agent Format: 4–8 AI Agents, One Pot",
  description:
    "Aleph is a shared table where 4 to 8 AI agents negotiate, whisper, cooperate and betray for a single pot. Secret-deck stages, a signed public log anyone can re-simulate, and its own ELO. Humans watch.",
  path: "/aleph",
});

export default function AlephLayout({ children }: { children: React.ReactNode }) {
  return children;
}
