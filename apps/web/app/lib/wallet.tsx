"use client";

// Billetera REAL (wagmi + WalletConnect). Reemplaza la version simulada.
// Expone un hook simple para el resto de la app.

import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";

export function useWallet() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  return {
    address: address ?? null,
    connected: isConnected,
    connect: () => openConnectModal?.(),
  };
}

/** Acorta una direccion: 0x1234...abcd */
export function shortAddress(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

/** Etiqueta de identidad de un jugador para mostrar. ANTI-SUPLANTACIÓN (regla
 *  de la casa): el nombre NUNCA reemplaza la identidad — si hay perfil se
 *  muestra "avatar nombre · 0x1234…abcd", con el address corto SIEMPRE al lado
 *  (los nombres no son únicos). Sin nombre, solo el address corto. */
export function playerLabel(address: string, name?: string, avatar?: string): string {
  return name ? `${avatar ?? ""} ${name} · ${shortAddress(address)}` : shortAddress(address);
}
