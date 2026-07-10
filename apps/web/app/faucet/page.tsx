import type { Metadata } from "next";
import { FaucetClient } from "./FaucetClient";

// Utilidad de testnet (acuñar USDC de prueba): no es un destino de búsqueda.
// noindex para no atraer tráfico de "fichas gratis" ni competir con las páginas
// reales del sitio; sigue accesible desde el footer y el flujo de apuestas.
export const metadata: Metadata = {
  title: "Get test tokens",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <FaucetClient />;
}
