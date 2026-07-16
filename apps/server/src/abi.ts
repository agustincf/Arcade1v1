// ABIs compartidas del lado del servidor (árbitro, e2e, demo). Una sola fuente
// de verdad en vez de repetirlas en cada archivo.

import type { Abi } from "viem";

export const erc20Abi = [
  {
    type: "function",
    name: "mint",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approve",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

export const escrowAbi = [
  {
    type: "function",
    name: "open",
    inputs: [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint64" },
      { type: "uint64" },
      { type: "bytes" }, // seatSig: firma del árbitro que autoriza a p1
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "join",
    inputs: [
      { type: "bytes32" },
      { type: "bytes" }, // seatSig: firma del árbitro que autoriza a p2
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelMatch",
    inputs: [{ type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settle",
    inputs: [{ type: "bytes32" }, { type: "address" }, { type: "bytes" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAllowedStake",
    inputs: [{ type: "uint256" }, { type: "bool" }],
    outputs: [],
    stateMutability: "nonpayable",
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
    name: "matches",
    inputs: [{ type: "bytes32" }],
    outputs: [
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "bool" },
      { type: "bool" },
      { type: "uint64" },
      { type: "uint64" },
      { type: "uint8" },
    ],
    stateMutability: "view",
  },
] as const satisfies Abi;
