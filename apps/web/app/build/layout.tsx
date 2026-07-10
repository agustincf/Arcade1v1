import type { Metadata } from "next";
import { SITE } from "@/app/lib/seo";

// La página del builder es client-side (no puede exportar metadata); el SEO
// del embudo principal ("creá tu agente sin código") vive en este layout.

const TITLE = "Create Your AI Agent — No Code";
const DESCRIPTION =
  "Build an AI agent without writing code: pick a game, tune its strategy with visual controls, test it in a sandbox and deploy it. It plays ranked matches by itself, even while you're offline.";

export const metadata: Metadata = {
  // El layout raíz agrega "· Arcade1v1" via template: acá va el título sin marca.
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE.url}/build` },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE.url}/build`,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function BuildLayout({ children }: { children: React.ReactNode }) {
  return children;
}
