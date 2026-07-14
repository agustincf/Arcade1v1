"use client";

// Billetera REAL (wagmi + WalletConnect). Reemplaza la version simulada.
// Expone un hook simple para el resto de la app.

import { useAccount, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { CHAIN } from "@/app/lib/wagmi";

export function useWallet() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  return {
    address: address ?? null,
    connected: isConnected,
    connect: () => openConnectModal?.(),
  };
}

/** Garantiza que la wallet esté en la red de la app ANTES de firmar. Sin esto,
 *  una wallet conectada en otra red (típico: celular por WalletConnect parado
 *  en Ethereum) rompía TODA acción firmada: wagmi pedía el provider "en esa
 *  red", intentaba cambiarse a ella y moría con "Chain not configured" porque
 *  la app solo configura una. Se llama DENTRO del try de la firma: si el
 *  usuario rechaza el cambio, cae en el mismo camino que cancelar la firma. */
export function useEnsureChain(): () => Promise<void> {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  return async () => {
    if (chainId !== undefined && chainId !== CHAIN.id) {
      await switchChainAsync({ chainId: CHAIN.id });
    }
  };
}

/** Acorta una direccion: 0x1234...abcd */
export function shortAddress(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

/** Etiqueta de identidad de un jugador para mostrar. ANTI-SUPLANTACIÓN (regla
 *  de la casa): el nombre NUNCA reemplaza la identidad — si hay perfil se
 *  muestra "avatar nombre · 0x1234…abcd", con el address corto SIEMPRE al lado
 *  (los nombres no son únicos). Sin nombre, solo el address corto. El `tag`
 *  opcional (p. ej. "CASA" traducido) se agrega al final en contextos donde
 *  el label es un string plano y no entra un chip estilado. */
export function playerLabel(address: string, name?: string, avatar?: string, tag?: string): string {
  const base = name ? `${avatar ?? ""} ${name} · ${shortAddress(address)}` : shortAddress(address);
  return tag ? `${base} · ${tag}` : base;
}
