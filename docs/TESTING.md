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

| Workspace             | Test files                                                                                                                                                                                                | Runner                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `apps/mcp`            | `play.test.ts`, `server.test.ts`, `tools.test.ts`                                                                                                                                                         | `node:test`            |
| `apps/server`         | `agents-routes.test.ts`, `agents.test.ts`, `challenge-routes.test.ts`, `challenge.test.ts`, `gas-monitor.test.ts`, `house-agents.test.ts`, `profiles-routes.test.ts`, `profiles.test.ts`, `stats.test.ts` | `node:test`            |
| `apps/web`            | `errors.test.ts`, `i18n.test.ts`                                                                                                                                                                          | `node:test`            |
| `packages/agent-sdk`  | `agent.test.ts`, `client.test.ts`, `sign.test.ts`, `strategies.test.ts`                                                                                                                                   | `node:test`            |
| `packages/game-sdk`   | `auth.test.ts`, `engines.test.ts`                                                                                                                                                                         | `node:test`            |
| `packages/strategies` | `strategies.test.ts`                                                                                                                                                                                      | `node:test`            |
| `packages/contracts`  | `Escrow1v1.t.sol` (9 tests)                                                                                                                                                                               | Foundry (`forge test`) |

**No tests exist for:**

- `apps/web` beyond `errors.test.ts` and `i18n.test.ts` — no component,
  hook, or page-level tests, and no browser/E2E automation.

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

There are no shared test-helper modules (e.g. no `test/helpers.ts` or
`test/setup.ts`) in any workspace — each test file is self-contained.

To add a new test to an existing workspace, drop a new `*.test.ts` file into
that workspace's `test/` directory; it will be picked up automatically by the
root `npm test` glob. No registration step is required.

## The arbiter selftest (`apps/server`)

Separate from the `node:test` suite, `apps/server` has an offline selftest
covering matchmaking, signing, scoring, ELO, and anti-cheat (replay
detection) across all six games:

```bash
npm run selftest --workspace apps/server
```

It runs fully offline (`src/offline-env.ts` forces this) and does not require
a database, RPC endpoint, or live network connection. This is included in
`npm run check` and run in CI.

## The contract's shell-based integration/E2E checks (`packages/contracts`)

`packages/contracts` has no `package.json` — it's a Foundry project. Unit
tests are Solidity files under `test/` (currently `Escrow1v1.t.sol`, 9 tests):

```bash
cd packages/contracts
forge test -vv
```

Beyond the Foundry unit tests, three bash scripts in `packages/contracts/`
spin up a local `anvil` chain to exercise real cross-component paths.
All three require Foundry (`forge`, `anvil`, `cast`) installed and the
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
  pays out the winner plus the platform commission. Reads
  `ARBITER_PRIVATE_KEY` from `apps/server/.env`.
  ```bash
  bash packages/contracts/check-payment-e2e.sh
  ```

Each script manages its own `anvil` process (kills any stray instance first,
starts a fresh one, tears it down on exit) — they are not part of the
`node:test` suite and are not picked up by `npm test`.

## CI integration

Defined in `.github/workflows/ci.yml`, triggered on push to `main` and on
every pull request. Two jobs:

- **`web-and-server`** — Node 22, `npm ci`, then `npm run check` (typecheck +
  lint + format check + `node:test` suite + arbiter selftest).
- **`contracts`** — checks out pinned versions of `forge-std` and
  OpenZeppelin, installs Foundry, runs `forge test -vv` in
  `packages/contracts`, then (with Node 22 + `npm ci`) runs
  `check-integration.sh`, `check-payment-e2e.sh`, and `check-deploy.sh` in
  sequence. The arbiter's test signing key is injected from the
  `ARBITER_PRIVATE_KEY` GitHub secret into a throwaway `apps/server/.env`
  (no real funds involved — `anvil` accounts only).
