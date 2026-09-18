export { ArbiterClient, COLD_START_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from "./client";
export type {
  ArbiterClientOptions,
  MatchView,
  LeaderRow,
  LiveStartView,
  LiveCommitBody,
  LiveCommitView,
  AlephRoomView,
  AlephRoomStatus,
  AlephSeatView,
  AlephDeposit,
  AlephSettleOutcome,
  AlephRefundOutcome,
  AlephLobby,
  AlephLog,
  AlephViewPass,
  AlephActBody,
} from "./client";
export { createAgent, VIEW_PASS_MAX_AGE_MS } from "./agent";
export type { AlephDepositResult } from "./agent";
export { strategy2048, DEFAULT_STRATEGIES } from "./strategies";
export type { Strategy, PlayResult } from "./strategies";
export {
  randomWallet,
  signScore,
  signMatchmake,
  signLiveStart,
  signAlephAction,
  signAlephView,
} from "./sign";
export {
  describeAlephRules,
  legalActions,
  validateAction,
  actionLine,
  ALEPH_RULES,
  ALEPH_RULES_V,
} from "./aleph";
export type { AlephAction, Phase, StageKind, SeatStatus } from "./aleph";
