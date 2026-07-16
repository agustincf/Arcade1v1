import type { Metadata } from "next";

// Página privada (fondos por wallet): no aporta a la indexación. noindex evita
// "index bloat"; sigue accesible por link directo.
export const metadata: Metadata = { robots: { index: false } };

export default function RecoverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
