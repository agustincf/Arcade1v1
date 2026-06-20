import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia } from "wagmi/chains";
import { http } from "wagmi";

// Configuracion de la conexion de billetera.
// Trabajamos SOLO en Base Sepolia (testnet, dinero de prueba).
//
// El "projectId" es un identificador gratuito de WalletConnect/Reown.
// Si no esta configurado, igual funcionan las extensiones (MetaMask), pero
// las billeteras de celular por QR necesitan uno valido.
export const wagmiConfig = getDefaultConfig({
  appName: "Arcade1v1",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "PENDIENTE_PROJECT_ID",
  chains: [baseSepolia],
  transports: {
    [baseSepolia.id]: http(),
  },
  ssr: true,
});

export const CHAIN = baseSepolia;
