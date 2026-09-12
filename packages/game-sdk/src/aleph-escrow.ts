// LA CADENA de las mesas de plata de Aleph, en su parte PURA y compartida: el
// estado del contrato, la conversión de la tabla de unidades a USDC y el ABI de
// EscrowAleph. Lo usan el árbitro (firma y liquida), el agent-sdk (deposita) y
// el verificador público. Sin dependencias: el game-sdk no trae viem.
//
// El motor sigue contando en unidades enteras (1000 por asiento): cambiar eso
// obligaría a subir ALEPH_RULES_V. La conversión pasa SOLO acá, al borde.

/** `EscrowAleph.Status` (packages/contracts/src/EscrowAleph.sol), en orden. */
export const ALEPH_ESCROW_STATUS = {
  None: 0,
  Funding: 1,
  Funded: 2,
  Settled: 3,
  Refunded: 4,
} as const;

/** USDC tiene 6 decimales: 2 USDC -> 2_000_000n. */
export function stakeToUnits(stake: number): bigint {
  return BigInt(Math.round(stake * 1_000_000));
}

export interface UsdcPayoutTable {
  pot: bigint; // stake × N
  fee: bigint; // pot × feeBps / 10000
  net: bigint; // pot − fee: lo que se reparte
  amounts: bigint[]; // en el MISMO orden que `seats`
  dust: bigint; // net − Σ amounts, siempre < N; va a la plataforma con la comisión
}

/** Tabla en micro-USDC a partir de la tabla en unidades del motor:
 *  `amounts[i] = floor(units[i] × net / Σ units)`. El polvo del redondeo (menos
 *  de N micro-USDC) queda aparte y el contrato lo manda a la plataforma; así
 *  `Σ amounts + fee + dust == pot` exacto, que es lo que el contrato exige
 *  (`Σ ≤ net` y `net − Σ < N`). Las addresses de `payouts` van en minúsculas
 *  (como las escribe el árbitro); `seats` se normaliza acá. */
export function usdcPayoutTable(
  seats: string[],
  payouts: Record<string, number>,
  stakeUnits: bigint,
  feeBps: number,
): UsdcPayoutTable {
  const n = BigInt(seats.length);
  const pot = stakeUnits * n;
  const fee = (pot * BigInt(feeBps)) / 10000n;
  const net = pot - fee;
  const units = seats.map((a) => BigInt(payouts[a.toLowerCase()] ?? 0));
  const total = units.reduce((x, y) => x + y, 0n);
  if (total <= 0n) throw new Error("empty payout table");
  const amounts = units.map((u) => (u * net) / total);
  const paid = amounts.reduce((x, y) => x + y, 0n);
  return { pot, fee, net, amounts, dust: net - paid };
}

/** ABI de EscrowAleph (solo lo que usan árbitro, SDK y e2e). `as const` alcanza
 *  para que viem infiera tipos; no hace falta `satisfies Abi`. */
export const escrowAlephAbi = [
  {
    type: "function",
    name: "open",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "seats", type: "address[]" },
      { name: "stake", type: "uint256" },
      { name: "fundDeadline", type: "uint64" },
      { name: "playDeadline", type: "uint64" },
      { name: "seatSig", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "seatSig", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settle",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "seats", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelRoom",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "refundUnfunded",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "refundExpired",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAllowedStake",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "ok", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "roomOf",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "seats", type: "address[]" },
      { name: "stake", type: "uint256" },
      { name: "paidCount", type: "uint8" },
      { name: "fundDeadline", type: "uint64" },
      { name: "playDeadline", type: "uint64" },
      { name: "status", type: "uint8" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "depositors",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "out", type: "address[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "paid",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "player", type: "address" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "feeBps",
    inputs: [],
    outputs: [{ type: "uint16" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "usdc",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "arbiter",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "tableHashOf",
    inputs: [
      { name: "seats", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "seatDigest",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "seatsHash", type: "bytes32" },
      { name: "stake", type: "uint256" },
      { name: "fundDeadline", type: "uint64" },
      { name: "playDeadline", type: "uint64" },
      { name: "player", type: "address" },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "payoutDigest",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "tableHash", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
] as const;

/** Lo mínimo de un ERC-20 para depositar (más `mint`, que solo existe en el
 *  USDC de prueba). */
export const erc20MinimalAbi = [
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
    name: "balanceOf",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "mint",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
