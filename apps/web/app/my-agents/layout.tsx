import type { Metadata } from "next";

// Panel privado del dueño (sus agentes): noindex. El catálogo público de agentes
// vive en /agents, que sí se indexa.
export const metadata: Metadata = { robots: { index: false } };

export default function MyAgentsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
