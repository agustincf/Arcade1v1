// Datos del contrato de escrow para la web (ABIs + direcciones).
// Se activa solo cuando NEXT_PUBLIC_ESCROW_ADDRESS esta seteado (tras desplegar).

export const ESCROW_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as
  | `0x${string}`
  | undefined;
export const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS as
  | `0x${string}`
  | undefined;

/** El pago on-chain esta activo solo si hay direcciones configuradas. */
export const onchainEnabled = Boolean(ESCROW_ADDRESS && USDC_ADDRESS);

/** USDC tiene 6 decimales: convierte un monto (ej. 5) a unidades del token. */
export function toUsdcUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

export const escrowAbi = [
  {
    type: "function",
    name: "open",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "stake", type: "uint256" },
      { name: "fundDeadline", type: "uint64" },
      { name: "playDeadline", type: "uint64" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "join",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settle",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "winner", type: "address" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;
