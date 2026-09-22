import type { Metadata } from "next";
import { pageMeta } from "@/app/lib/seo";

// El probador no se enlaza desde ninguna navegación y no entra en el sitemap:
// sirve para mirar criaturas contra direcciones reales antes de congelar el
// catálogo. Por eso va con noindex, que es lo que lo distingue de /aleph.
export const metadata: Metadata = {
  ...pageMeta({
    title: "Aleph creature probe",
    description: "Paste an address and see the creature it produces. Not linked from anywhere.",
    path: "/aleph/criatura",
  }),
  robots: { index: false, follow: false },
};

export default function ProbadorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
