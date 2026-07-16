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
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "ce6f7a5715f885bc1ce1e91d06f02bff",
  chains: [CHAIN],
  transports: {
    // RPC propio (Alchemy/Infura/etc.) via NEXT_PUBLIC_RPC_URL; sin setear usa
    // el publico de la red (alcanza para test, corto de rate-limit para prod).
    [CHAIN.id]: http(process.env.NEXT_PUBLIC_RPC_URL || undefined),
  },
  // ssr: false a propósito. Con `ssr: true`, wagmi difiere el estado esperando
  // que lo hidraten desde la cookie (cookieToInitialState) en el server — pero
  // ese config lo crea getDefaultConfig de RainbowKit, que es SOLO-cliente y no
  // se puede importar en un server component. Sin esa hidratación, el store
  // arrancaba desincronizado y CONECTAR la wallet no se reflejaba hasta recargar.
  // Toda la UI de wallet acá es client-side (el header ya usa `mounted`), así que
  // el modo cliente puro (localStorage) es el correcto: la conexión reacciona al
  // instante y la reconexión al recargar sigue andando.
  ssr: false,
});
