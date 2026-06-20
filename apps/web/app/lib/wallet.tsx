"use client";

// Billetera SIMULADA (fake) para la Fase 1.
// No conecta con ninguna blockchain todavia: solo guarda un estado de
// "conectado / desconectado" y una direccion inventada, para poder recorrer
// el flujo. En la Fase 4 se reemplaza por una billetera real (MetaMask).

import { createContext, useContext, useEffect, useState } from "react";

interface WalletState {
  address: string | null;
  connected: boolean;
  connect: () => void;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState | null>(null);

function fakeAddress() {
  const hex = "0123456789abcdef";
  let a = "0x";
  for (let i = 0; i < 40; i++) a += hex[Math.floor(Math.random() * 16)];
  return a;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);

  // Recordar la conexion al navegar entre pantallas.
  useEffect(() => {
    const saved = localStorage.getItem("fakeWallet");
    if (saved) setAddress(saved);
  }, []);

  function connect() {
    const a = fakeAddress();
    setAddress(a);
    localStorage.setItem("fakeWallet", a);
  }

  function disconnect() {
    setAddress(null);
    localStorage.removeItem("fakeWallet");
  }

  return (
    <WalletContext.Provider
      value={{ address, connected: !!address, connect, disconnect }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet debe usarse dentro de <WalletProvider>");
  return ctx;
}

/** Acorta una direccion: 0x1234...abcd */
export function shortAddress(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}
