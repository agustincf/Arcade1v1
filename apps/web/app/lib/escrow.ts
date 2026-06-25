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
  // Reembolso si la partida quedó ABIERTA (Open) y venció el plazo de depósito:
  // nadie se unió. Cada quien recupera lo suyo.
  {
    type: "function",
    name: "refundUnfunded",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Reembolso si la partida se LLENÓ (Funded) pero venció el plazo de juego sin
  // resultado (ej: el rival nunca jugó). Se devuelve todo a ambos.
  {
    type: "function",
    name: "refundExpired",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Getter público del struct Match: para leer estado y plazos desde la web.
  {
    type: "function",
    name: "matches",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "p1", type: "address" },
      { name: "p2", type: "address" },
      { name: "stake", type: "uint256" },
      { name: "p1Paid", type: "bool" },
      { name: "p2Paid", type: "bool" },
      { name: "fundDeadline", type: "uint64" },
      { name: "playDeadline", type: "uint64" },
      { name: "status", type: "uint8" },
    ],
    stateMutability: "view",
  },
] as const;

/** Estados del contrato (enum Status de Escrow1v1.sol). */
export const MatchStatus = {
  None: 0,
  Open: 1,
  Funded: 2,
  Settled: 3,
  Refunded: 4,
} as const;

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
