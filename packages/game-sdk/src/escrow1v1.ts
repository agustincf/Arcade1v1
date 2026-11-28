// EL CONTRATO 1v1 (Escrow1v1), en su parte PURA y compartida: el ABI de lo que
// usa un agente para depositar y cobrar, los estados de una partida y el
// dominio EIP-712 del asiento que firma el árbitro. Es el espejo de
// `aleph-escrow.ts` para las mesas 1v1. Sin dependencias: el game-sdk no trae
// viem. El árbitro y la web siguen con sus copias del ABI por ahora (unificar
// las tres queda para después de la auditoría externa).

export { stakeToUnits, erc20MinimalAbi } from "./aleph-escrow";

/** `Escrow1v1.Status` (packages/contracts/src/Escrow1v1.sol), en orden. */
export const ESCROW1V1_STATUS = {
  None: 0,
  Open: 1,
  Funded: 2,
  Settled: 3,
  Refunded: 4,
} as const;

/** El USDC de Circle en Base (8453). En mainnet, `escrow.usdc()` tiene que ser
 *  este: cualquier otro token se rechaza antes de aprobar nada. */
export const CIRCLE_USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

/** Lo que ata el asiento del árbitro: quién entra, con qué stake y con qué
 *  plazos. Idéntico a `SEAT_TYPES` de apps/server/src/sign.ts (lo comprueba
 *  apps/server/test/seat-domain.test.ts). */
export const SEAT_TYPES = {
  Seat: [
    { name: "matchId", type: "bytes32" },
    { name: "player", type: "address" },
    { name: "stake", type: "uint256" },
    { name: "fundDeadline", type: "uint64" },
    { name: "playDeadline", type: "uint64" },
  ],
} as const;

/** El dominio EIP-712 con el que el contrato verifica asientos y resultados.
 *  Con la red y el escrow que fijó el operador, un asiento firmado para otro
 *  contrato u otra red no se recupera al árbitro. */
export function seatDomain(
  chainId: number,
  escrow: `0x${string}`,
): { name: "Arcade1v1Escrow"; version: "2"; chainId: number; verifyingContract: `0x${string}` } {
  return { name: "Arcade1v1Escrow", version: "2", chainId, verifyingContract: escrow };
}

/** Las salidas de `matches(id)` hasta el estado. La novena (`frozenFeeBps`)
 *  NO va acá a propósito, como en apps/server/src/abi.ts: así este ABI lee
 *  también un contrato desplegado antes de la revisión pre-auditoría. */
const MATCH_OUTPUTS = [
  { name: "p1", type: "address" },
  { name: "p2", type: "address" },
  { name: "stake", type: "uint256" },
  { name: "p1Paid", type: "bool" },
  { name: "p2Paid", type: "bool" },
  { name: "fundDeadline", type: "uint64" },
  { name: "playDeadline", type: "uint64" },
  { name: "status", type: "uint8" },
] as const;

/** ABI de Escrow1v1 (solo lo que usan los agentes). */
export const escrow1v1Abi = [
  {
    type: "function",
    name: "open",
    inputs: [
      { name: "id", type: "bytes32" },
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
    name: "join",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "seatSig", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "matches",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: MATCH_OUTPUTS,
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
    name: "usdc",
    inputs: [],
    outputs: [{ type: "address" }],
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
    name: "allowedStake",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owed",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/** Solo `matches(id)` con sus 9 salidas: la novena es la comisión que quedó
 *  congelada cuando el p1 abrió, la que paga un p2. Va aparte porque un
 *  contrato anterior a la revisión no la tiene (ahí falla la decodificación y
 *  el agente usa `feeBps()` como respaldo). */
export const escrow1v1MatchFeeAbi = [
  {
    type: "function",
    name: "matches",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [...MATCH_OUTPUTS, { name: "frozenFeeBps", type: "uint16" }],
    stateMutability: "view",
  },
] as const;
