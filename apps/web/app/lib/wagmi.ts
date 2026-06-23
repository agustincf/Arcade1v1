import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, baseSepolia } from "wagmi/chains";
import { http } from "wagmi";

// Red: Base Sepolia (test, POR DEFECTO) o Base mainnet (dinero real). Se cambia
// con NEXT_PUBLIC_CHAIN_ID=8453 para mainnet. Por defecto queda en testnet
// (seguro): el dinero real solo se activa al setearlo explicitamente.
const MAINNET = process.env.NEXT_PUBLIC_CHAIN_ID === "8453";
export const CHAIN = MAINNET ? base : baseSepolia;

// El "projectId" es un identificador gratuito de WalletConnect/Reown.
// Si no esta configurado, igual funcionan las extensiones (MetaMask), pero
// las billeteras de celular por QR necesitan uno valido.
export const wagmiConfig = getDefaultConfig({
  appName: "Arcade1v1",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "PENDIENTE_PROJECT_ID",
  chains: [CHAIN],
  transports: {
    [CHAIN.id]: http(),
  },
  ssr: true,
});
