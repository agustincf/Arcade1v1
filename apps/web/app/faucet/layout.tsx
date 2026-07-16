import type { Metadata } from "next";

// Utilidad de testnet (acuñar USDC de prueba): sin valor de búsqueda y se
// bloquea en mainnet. noindex.
export const metadata: Metadata = { robots: { index: false } };

export default function FaucetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
