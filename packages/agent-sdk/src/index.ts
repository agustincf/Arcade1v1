export {
  ArbiterClient,
  COLD_START_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  UNAVAILABLE_RETRY_MS,
} from "./client";
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
  AlephPlaying,
  AlephLog,
  AlephViewPass,
  AlephActBody,
} from "./client";
export { createAgent, VIEW_PASS_MAX_AGE_MS } from "./agent";
export type { AlephDepositResult, AlephWithdrawResult, LiveReceipt } from "./agent";
// Para comprobar un `liveReceipt` cuando la partida se decida después de que
// `playAndSubmit` volvió (jugaste primero): checkLiveReveals(secret, secretHash, reveals).
export { checkLiveReveals } from "@arcade1v1/game-sdk/live";
export { verifyFlappyLive } from "@arcade1v1/game-sdk/flappy-live";
export { strategy2048, DEFAULT_STRATEGIES, defaultLiveStrategy } from "./strategies";
export type { Strategy, PlayResult, LiveStrategy } from "./strategies";
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
