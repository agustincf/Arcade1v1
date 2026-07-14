<!-- generated-by: gsd-doc-writer -->
# DEVELOPMENT.md — Working in this repo

This is the day-to-day guide for anyone (human or AI agent) writing code in
this monorepo. It covers repo layout, the commands you'll run, and a summary
of the project's engineering rules. **[STANDARDS.md](../STANDARDS.md)** (in
Spanish, the project's working language) is the mandatory source of truth for
build rules — this file summarizes it in English and links back for full
detail. When the two disagree, STANDARDS.md wins.

## Monorepo layout

npm workspaces, declared in the root `package.json`:

```json
"workspaces": ["apps/*", "packages/*"]
```

| Path | Package name | Purpose |
|---|---|---|
| `apps/web` | `@arcade1v1/web` | Next.js (App Router) frontend — the site players use. Private, not published. |
| `apps/server` | `@arcade1v1/server` | The "arbiter" backend (Express 5 + viem): matchmaking, replay verification, EIP-712 result signing. Private, not published. |
| `apps/mcp` | `@arcade1v1/mcp` | MCP server so AI assistants can play ranked matches. Published to npm and the MCP registry. |
| `packages/game-sdk` | `@arcade1v1/game-sdk` | Deterministic game engines (one module per game) + the replay contract every game implements. |
| `packages/agent-sdk` | `@arcade1v1/agent-sdk` | Client for AI agents to matchmake, play headlessly, sign and submit a score. |
| `packages/strategies` | `@arcade1v1/strategies` | Parameterized strategies that drive the real game-sdk engines — powers the no-code agent builder and hosted agents. |
| `packages/contracts` | — | Solidity escrow contract (Foundry). Its own toolchain; excluded from the root ESLint/Prettier/TS setup. |

Internally, workspaces reference each other by package name with `"*"` as
the version (e.g. `apps/server` depends on `"@arcade1v1/game-sdk": "*"`) and
npm resolves them to the local workspace folder — no build step is needed to
consume another workspace's TypeScript source directly.

`game-sdk`, `agent-sdk`, and `contracts` are also published standalone via
`scripts/publish-sdk.mjs` (invoked as `npm run release --workspace packages/game-sdk`,
etc.) so external consumers can `npm install @arcade1v1/game-sdk` without
pulling in the rest of the monorepo.

### Adding a new workspace

1. Create the directory under `apps/` or `packages/` with its own
   `package.json` (name it `@arcade1v1/<name>`) and `tsconfig.json`.
2. Run `npm install` from the repo root so npm links the new workspace.
3. If it's a TypeScript app/package, add a `typecheck:<name>` script to the
   root `package.json` and wire it into the aggregate `typecheck` script (see
   how `typecheck:web`, `typecheck:server`, `typecheck:mcp`, and
   `typecheck:packages` are combined).
4. If it needs tests, put them in `<workspace>/test/*.test.ts` — the root
   `test` script already globs `{packages,apps}/*/test/*.test.ts`.
5. ESLint and Prettier already cover any new workspace under `apps/*` or
   `packages/*` automatically, **unless** it's a non-TypeScript toolchain like
   `packages/contracts`, in which case add it to the `ignores` list in
   `eslint.config.mjs`.

### Adding a new game

Each game is a pluggable "cartridge" against a fixed platform contract (see
below). To add one: create `packages/game-sdk/src/<game>.ts` with its
deterministic engine and replay verifier, register it, and add its screen
under `apps/web/app/games/<game>/`. Matchmaking, escrow, and payment code
does not need to change.

## Commands

All commands run from the repo root unless noted. Verified against the root
`package.json` `scripts`:

| Command | What it does |
|---|---|
| `npm run web` | Runs `apps/web` in dev mode (`next dev`). |
| `npm run server` | Runs `apps/server` in dev mode (`tsx watch src/index.ts`). |
| `npm test` | Runs all `node:test` suites: `{packages,apps}/*/test/*.test.ts`, via `tsx`. |
| `npm run typecheck:web` / `:server` / `:mcp` / `:packages` | Per-workspace `tsc --noEmit` against each `tsconfig.json`. |
| `npm run typecheck` | Runs all of the above in sequence. |
| `npm run lint` | `eslint .` — flat config at the repo root. |
| `npm run format` | `prettier --write .` — reformats in place. |
| `npm run format:check` | `prettier --check .` — fails if anything is unformatted (used in CI). |
| `npm run selftest` | `apps/server`'s network-free self-test (signed matchmaking, tie handling, etc.), run as `npm run --workspace apps/server selftest`. |
| `npm run check` | The full gate: `typecheck && lint && format:check && test && selftest`. **This must pass before anything is considered done.** |

Per-app commands (run inside `apps/server` or with `--workspace apps/server`,
etc.) — from each workspace's own `package.json`:

- `apps/server`: `dev` (tsx watch), `start` (tsx, no watch), `selftest`, `agent`.
- `apps/web`: `dev`, `build`, `start` (standard Next.js scripts).
- `apps/mcp`: `build` (esbuild bundle via `build.mjs`), `start` (tsx).

Contract-specific tooling (`forge test`, deploy scripts) lives entirely in
`packages/contracts` and uses Foundry, not npm scripts — see that package's
own README/docs.

## TypeScript setup

- Every workspace (`apps/web`, `apps/server`, `apps/mcp`,
  `packages/game-sdk`, `packages/agent-sdk`, `packages/strategies`) has its
  own `tsconfig.json` with `"strict": true`, target `ES2022`, and
  `moduleResolution: "bundler"`. There is no shared/extended base config —
  each is self-contained.
- `apps/web` additionally sets `jsx: "react-jsx"`, includes the Next.js
  plugin, and maps the `@/*` path alias to the app root.
- `apps/server`, and the `packages/*` workspaces are plain ESM
  (`"type": "module"`) run directly by `tsx` — no separate compile step for
  local dev; compilation only happens when publishing an SDK
  (`scripts/publish-sdk.mjs`) or building the web app (`next build`).
- Type errors are checked per-workspace (`typecheck:*`) rather than as one
  project-wide `tsc` run, since each app has different `lib`/`jsx`/`types`
  needs.

## Linting and formatting

- **ESLint**: flat config at `eslint.config.mjs` (root). Built on
  `@eslint/js` recommended rules + `typescript-eslint` recommended rules,
  with `eslint-plugin-react-hooks` applied only to `.tsx` files
  (`rules-of-hooks: error`, `exhaustive-deps: warn`). `eslint-config-prettier`
  is applied last to disable any stylistic rule that would fight Prettier.
  Notable deliberate relaxations: `no-undef` is off (TypeScript already
  covers it), `@typescript-eslint/no-explicit-any` is off (the project uses
  `any` intentionally in replay/ABI casts), and unused vars are a `warn` (not
  an error), ignoring anything prefixed with `_`.
  `packages/contracts/**`, `.next/`, `dist/`, `out/`, and `*.tsbuildinfo` are
  excluded — run `npm run lint` to check everything else.
- **Prettier**: config at `.prettierrc.json` — semicolons on, double quotes
  (`singleQuote: false`), trailing commas everywhere (`"all"`), 100-character
  print width. Run `npm run format` to rewrite files, `npm run format:check`
  to verify without writing (this is what CI runs).
- Both are enforced together via `npm run check`, and independently in CI
  (`.github/workflows/ci.yml`, job `web-and-server`), which installs with
  `npm ci` on Node 22 and runs `npm run check` as a single step.

## Tests

- Native `node:test` — no Jest, Mocha, or other test framework. Test files
  live at `<workspace>/test/*.test.ts` (e.g. `apps/server/test/*.test.ts`,
  `packages/game-sdk/test/*.test.ts`) and are run together with
  `npm test` (`node --import tsx --test`).
- `apps/server` additionally has `npm run selftest` (`tsx src/selftest.ts`):
  a network-free smoke test of signed matchmaking, replay verification, and
  tie/refund handling, required by `npm run check` and CI.
- Any fix to a security or money-handling bug must come with a test that
  reproduces the exploited case — see `apps/server/test/*` for the pattern
  (spin up the real router, fire signed HTTP requests against it).

## Git conventions

- **Commit messages**: `type(scope): description in Spanish` — e.g.
  `fix(web): …`, `feat(server): …`, `docs: …`. This is documented in
  STANDARDS.md and is consistently followed in the project history (recent
  examples: `fix(web): firmar con la wallet en otra red ya no muere con
  "Chain not configured"`, `feat(server): monitor del gas del árbitro`).
- **Branch naming**: no formal convention is documented in STANDARDS.md.
  Feature branches seen in the remote follow a loose `claude/<slug>` pattern
  for AI-assisted work; there is no enforced human branch-naming rule beyond
  that.
- **Deploy**: pushing to `main` triggers auto-deploy (Vercel for the web app,
  Render for the arbiter server) — see STANDARDS.md and `DEPLOY.md`. Do not
  push to `main` without a full `npm run check` pass.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull
request, with two jobs:

- **`web-and-server`** — Node 22, `npm ci`, then a single `npm run check`
  step (typecheck + lint + format + tests + selftest — the same command you
  run locally).
- **`contracts`** — installs Foundry, runs `forge test -vv` in
  `packages/contracts`, then the on-chain integration/e2e scripts
  (`check-integration.sh`, `check-payment-e2e.sh`, `check-deploy.sh`) against
  a local `anvil` chain, signing with a test-only arbiter key stored as a
  GitHub secret.

## Core engineering standards (summary — see STANDARDS.md for full detail)

The full rules, in Spanish, are in **[STANDARDS.md](../STANDARDS.md)**. The
two patterns most relevant to day-to-day contribution:

### Deterministic game engines (`packages/game-sdk`)

Every game module implements the platform contract defined in
`packages/game-sdk/src/index.ts`:

- `GameServerModule` — `meta` (id, name, description, scoreUnit), plus
  `verifyRun(run)` (re-simulates a submitted replay and returns the real
  score, or an error) and `decide(scoreP1, scoreP2)` (turns two verified
  scores into a `MatchOutcome`: `winner`, `draw`, or `cancelled`).
- `GameClientModule` — the browser-side counterpart that renders one
  player's attempt and produces a `GameRun` (`{ score, replay }`) on finish.

**Same seed → same game, always.** Engines never call `Math.random()` or
read the clock; all randomness goes through the shared seeded RNG
(`mulberry32` in `packages/game-sdk/src/replay.ts`). The arbiter generates the
seed with a CSPRNG and the client never controls it. This is what lets the
server re-simulate a submitted replay byte-for-byte and reject a score that
doesn't match — the anti-cheat model depends entirely on this determinism
holding for every game module. Any new game engine must follow the same
rule, or replay verification (and therefore payment) breaks silently.

### Signed-action error classification (`apps/web/app/lib/errors.ts`)

Every UI action that requires a wallet signature (deploying/pausing/deleting
an agent, setting a profile, issuing a challenge, matchmaking) must classify
its failure using this module instead of showing a generic error:

- `classifySignError(e)` — distinguishes `sign-cancelled` (user rejected in
  their wallet — EIP-1193 code 4001 or common wallet rejection text),
  `wrong-network` (wallet is on the wrong chain and couldn't switch — viem's
  `SwitchChainError`/`ChainNotConfiguredError`), and `sign-failed` (the
  wallet failed for another reason — the real message is shown, not blamed
  on "the server").
- `classifyArbiterError(e)` / `failureText(stage, e)` — classifies what the
  arbiter (server) rejected the action for: `agent-limit` (hit the
  per-owner agent cap, with the actual max echoed back), `network` (no
  response — this is the **only** case where a generic "couldn't connect"
  message is appropriate), or `server` (any other rejection, shown verbatim).

Each outcome maps to its own i18n key (`err.signCancelled`,
`err.wrongNetwork`, `err.signFailed`, `build.limit`, `err.rejected`, …) — no
hardcoded UI strings. This pattern is mandatory for any new button that
signs with the wallet; see STANDARDS.md's "Errores de acciones firmadas por
la wallet" section for the full rationale.
