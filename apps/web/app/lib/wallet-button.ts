// Qué hace el botón de la wallet del encabezado al tocarlo. Vive aparte de
// Header.tsx para poder probarlo sin React (test/wallet-button.test.ts).
//
// Con la wallet en una red que la app no usa, RainbowKit deja `openAccountModal`
// en un no-op: tocar la dirección no hacía nada y no había forma de desconectar
// (pasaba con MetaMask del celular conectado por el QR y parado en otra red).
// Ahí va la ventana de red (components/WrongNetworkDialog.tsx), que permite
// cambiar de red y también desconectar.

export type WalletButtonMode = "connect" | "account" | "chain";

export function walletButtonMode(s: {
  connected: boolean;
  unsupportedChain: boolean;
}): WalletButtonMode {
  if (!s.connected) return "connect";
  return s.unsupportedChain ? "chain" : "account";
}
