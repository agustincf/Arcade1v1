<!-- generated-by: gsd-doc-writer -->

# Testing

Arcade1v1 is an npm workspaces monorepo. Test runners differ by area:

- **Node/TypeScript packages and apps** (`apps/mcp`, `apps/server`, `apps/web`,
  `packages/agent-sdk`, `packages/game-sdk`, `packages/strategies`) use Node's
  built-in **`node:test`** runner, executed via `tsx` (no Jest/Vitest/Mocha
  anywhere in this repo).
- **The smart contract** (`packages/contracts`) uses **Foundry** (`forge test`)
  for unit tests, plus a set of bash scripts that spin up a local `anvil`
  chain for on-chain integration/E2E checks.
- **`apps/server` selftest** is a standalone offline script
  (`src/selftest.ts`), separate from the `node:test` suite.

There is currently no Playwright (or any other browser-automation) E2E suite
in this repo. `@playwright/test` shows up only as a transitive line in
`package-lock.json`; there is no `playwright.config.*` file and no tests
importing it anywhere in the codebase.

## Running the full test suite

From the repo root:

```bash
npm test
```

This runs (`package.json` `scripts.test`):

```bash
node --import tsx --test "{packages,apps}/*/test/*.test.ts"
```

It picks up every `*.test.ts` file directly under a workspace's `test/`
directory (one level deep) across all `packages/*` and `apps/*`, and runs them
all with Node's built-in test runner.

For the full local verification pipeline (what CI also runs for the
Node/TypeScript side), use:

```bash
npm run check
```

This chains, in order: `typecheck` (all workspaces) → `lint` (ESLint) →
`format:check` (Prettier) → `test` (the command above) → `selftest` (the
arbiter's offline selftest, see below).

## Running tests for a single workspace

The root `test` script already covers every workspace in one pass, but you can
scope it to a single package/app by narrowing the glob:

```bash
# server only
node --import tsx --test "apps/server/test/*.test.ts"

# web only
node --import tsx --test "apps/web/test/*.test.ts"

# a single file
node --import tsx --test "apps/server/test/agents.test.ts"
```

None of the individual workspace `package.json` files (`apps/mcp`,
`apps/server`, `apps/web`, `packages/agent-sdk`, `packages/game-sdk`,
`packages/strategies`) define their own `test` script — testing is driven
entirely from the root.

## What each workspace actually has

| Workspace                 | Test files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Runner                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `apps/mcp` (6)            | `config.test.ts`, `manifest.test.ts`, `play.test.ts`, `server.test.ts`, `tools.test.ts`, `tools-aleph.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `node:test`            |
| `apps/server` (48)        | Core 1v1: `agents-routes`, `agents`, `anti-espionage`, `cancel-onchain`, `challenge-routes`, `challenge`, `cola-onchain`, `config-guard`, `deposito-onchain`, `failed-attempts`, `funnel-stats`, `gas-monitor`, `house-agents`, `profiles-routes`, `profiles`, `ratings-multi`, `rules-version`, `stats`, `submit-race`, `tick-budget`. Aleph: `aleph-funding-no-escrow`, `aleph-funding`, `aleph-game`, `aleph-house`, `aleph-lobby`, `aleph-money-durability`, `aleph-routes`, `aleph-rules-version`, `aleph-sdk-e2e`, `aleph-sign`. Live games: `live-deposit`, `live-flappy`, `live-routes`, `live-runner`, `live-sdk-e2e`, `live-views`, `live-webhook-routes`, `live-webhook-runner`. Deploy handoff and persistence: `handover-sim`, `handover`, `jobs`, `lease`, `persist-guard`, `readiness`, `redis`, `version`. BYO webhooks: `webhook-agents`, `webhook-fetch`, `webhook-model`, `webhook-routes` (all `*.test.ts`) | `node:test`            |
| `apps/web` (10)           | `aleph-criatura.test.ts`, `aleph-secretos.test.ts`, `arbiter-timeout.test.ts`, `config-guard.test.ts`, `confirm-tx.test.ts`, `errors.test.ts`, `i18n.test.ts`, `lang-routing.test.ts`, `live.test.ts`, `strict-mesa.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `node:test`            |
| `packages/agent-sdk` (12) | `agent.test.ts`, `agent-aleph.test.ts`, `aleph-client.test.ts`, `aleph-llm.test.ts`, `aleph-sign.test.ts`, `aleph-text.test.ts`, `client.test.ts`, `live-client.test.ts`, `racing-llm.test.ts`, `rules-guard.test.ts`, `sign.test.ts`, `strategies.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `node:test`            |
| `packages/game-sdk` (14)  | `aleph-azar.test.ts`, `aleph-invariants.test.ts`, `aleph-rules.test.ts`, `aleph-usdc.test.ts`, `aleph.test.ts`, `auth.test.ts`, `chain.test.ts`, `engines.test.ts`, `flappy-live-driver.test.ts`, `flappy-live-session.test.ts`, `flappy-live.test.ts`, `live.test.ts`, `racing-fairness.test.ts`, `sha256.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `node:test`            |
| `packages/strategies` (3) | `live-step.test.ts`, `strategies-v2.test.ts`, `strategies.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `node:test`            |
| `packages/contracts`      | `Escrow1v1.t.sol` (14 tests), `EscrowAleph.t.sol` (43 tests)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Foundry (`forge test`) |

**No tests exist for:**

- `apps/web` beyond the ten files above — they cover pure modules (the Aleph
  creature and chat models, config, errors, i18n, routing, the live-game
  client); there are no component, hook, or page-level tests, and no
  browser/E2E automation.

There is no code coverage tool configured anywhere in the repo (no
`jest.config`, `vitest.config`, `.nycrc`, or `c8` setup), so there is no
coverage threshold to meet.

## Writing new tests

Test files live in each workspace's `test/` directory and follow the
`*.test.ts` naming convention. They import directly from `node:test` and
`node:assert/strict`, for example (`apps/web/test/errors.test.ts`):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { isSignCancelled } from "../app/lib/errors.js";

test("isSignCancelled: EIP-1193 code 4001 (user rejection)", () => {
  assert.equal(isSignCancelled({ code: 4001, message: "whatever" }), true);
});
```

Note the `.js` extension on relative imports (required because the project
compiles/runs as ESM via `tsx`) even though the source files are `.ts`.

There is no global setup file. A few workspaces keep small helpers next to
their tests, which the `*.test.ts` glob does not run on their own:
`apps/server/test/fake-upstash.ts` (an in-memory Upstash for the persistence
and handoff tests), `apps/web/test/aleph-ayuda.ts`,
`packages/agent-sdk/test/fake-rpc.ts`, and in `packages/game-sdk/test/`
`aleph-helpers.ts`, `live-fixtures.ts` and the `aleph-v1-golden.json` fixture
(rooms played under Aleph rules v1, which must keep verifying).

To add a new test to an existing workspace, drop a new `*.test.ts` file into
that workspace's `test/` directory; it will be picked up automatically by the
root `npm test` glob. No registration step is required.

## The arbiter selftest (`apps/server`)

Separate from the `node:test` suite, `apps/server` has an offline selftest
covering matchmaking, signing, scoring, ELO, and anti-cheat (replay
detection) across all six games — seeded replays for five of them, and a live
Flappy match played through `liveStart`/`liveCommit` and re-verified with the
published secret:

```bash
npm run selftest --workspace apps/server
```

It runs fully offline (`src/offline-env.ts` forces this) and does not require
a database, RPC endpoint, or live network connection. This is included in
`npm run check` and run in CI.

## The contract's shell-based integration/E2E checks (`packages/contracts`)

`packages/contracts` has no `package.json` — it's a Foundry project. Unit
tests are Solidity files under `test/`: `Escrow1v1.t.sol` (14 tests) and
`EscrowAleph.t.sol` (43 tests):

```bash
cd packages/contracts
forge test -vv
```

Beyond the Foundry unit tests, five bash scripts in `packages/contracts/`
spin up a local `anvil` chain to exercise real cross-component paths.
All five require Foundry (`forge`, `anvil`, `cast`) installed and the
monorepo's Node dependencies installed (`npm install` at the repo root).

- **`check-deploy.sh`** — Runs the real deploy script (`script/Deploy.s.sol`)
  against a local `anvil` chain and verifies it deploys the escrow + a test
  USDC token, and that the four product stake tiers (1/2/5/10 USDC) end up
  enabled on the contract. Catches the "stake not allowed" failure mode where
  deposits would revert in production.
  ```bash
  bash packages/contracts/check-deploy.sh
  ```
- **`check-integration.sh`** — Verifies that the EIP-712 digest the arbiter
  signs (via `viem`, in `apps/server/src/digestcheck.ts`) is byte-identical
  to the digest the deployed contract computes (`resultDigest`). If they
  match, the arbiter's signature is valid for the contract to accept.
  ```bash
  bash packages/contracts/check-integration.sh
  ```
- **`check-payment-e2e.sh`** — Full payment path on a local `anvil` chain:
  deploys `MockUSDC` + `Escrow1v1`, has both players deposit, has the arbiter
  sign a result (`apps/server/src/onchain-e2e.ts`), and confirms the contract
  pays out the winner plus the platform commission. The arbiter signs with
  anvil's public account #9, fixed in the script; it reads no `.env`. It also
  covers a mined-but-reverted `cancelMatch`, which must not count as a
  refund.
  ```bash
  bash packages/contracts/check-payment-e2e.sh
  ```
- **`check-aleph-deploy.sh`** — Runs the real Aleph deploy script
  (`script/DeployAleph.s.sol`) against a local `anvil` chain and verifies the
  2 USDC table ends up enabled on the deployed `EscrowAleph`. Catches the same
  "stake not allowed" failure mode as `check-deploy.sh`, for the Aleph
  contract.
  ```bash
  bash packages/contracts/check-aleph-deploy.sh
  ```
- **`check-aleph-e2e.sh`** — Full Aleph money-table path on a local `anvil`
  chain with the real arbiter: deploys `MockUSDC` + `EscrowAleph`, has 4
  wallets deposit and play a room end to end, and confirms the signed payout
  table pays everyone in one transaction (commission plus rounding dust to the
  platform, escrow left at zero, and no seat left with a USDC allowance to the
  escrow: the SDK approves exactly one stake); then repeats with an incomplete
  funding that the arbiter cancels and confirms only the depositors are
  refunded.
  ```bash
  bash packages/contracts/check-aleph-e2e.sh
  ```

Each script manages its own `anvil` process (kills any stray instance first,
starts a fresh one, tears it down on exit) — they are not part of the
`node:test` suite and are not picked up by `npm test`.

## CI integration

Defined in `.github/workflows/ci.yml`, triggered on push to `main` and on
every pull request. Two jobs:

- **`web-and-server`** — Node 22, `npm ci`, then `npm run check` (typecheck +
  lint + format check + `node:test` suite + arbiter selftest), then the
  production build of the web (`npm run build --workspace apps/web`).
- **`contracts`** — checks out pinned versions of `forge-std` (v1.16.1) and
  OpenZeppelin (v5.6.1), installs Foundry pinned to **v1.8.3** (the e2e
  scripts depend on anvil's gas estimation and mempool ordering, so a new
  release is adopted through a PR), runs `forge test -vv` in
  `packages/contracts`, then (with Node 22 + `npm ci`) runs
  `check-integration.sh`, `check-payment-e2e.sh`, `check-deploy.sh`,
  `check-aleph-deploy.sh`, and `check-aleph-e2e.sh` in sequence. No script
  reads a key from a `.env` or a GitHub secret: the arbiter signs with public
  `anvil` accounts fixed in each script (no real funds involved).
