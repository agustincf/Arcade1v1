export type { ParamSpec, PlayResult, StrategyDef, AgentStrategyConfig } from "./types";
export { AGENT_AVATARS } from "./avatars";
export {
  STRATEGIES,
  strategiesFor,
  getStrategy,
  defaultParams,
  validateParams,
  runStrategy,
} from "./registry";
