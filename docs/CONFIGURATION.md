<!-- generated-by: gsd-doc-writer -->

# Configuration

Arcade1v1 is an npm workspaces monorepo with three pieces that are configured
independently, each via its own env file:

| Piece                                 | Env file (copy to)                                         | Loaded by                                                                 |
| ------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/web` (Next.js frontend)         | `apps/web/.env.local.example` → `.env.local`               | Next.js (build-time inline for `NEXT_PUBLIC_*`, server-only for the rest) |
| `apps/server` (the "arbiter" backend) | `apps/server/.env.example` → `.env`                        | `dotenv/config`, loaded at the top of `src/index.ts`                      |
| `packages/contracts` (testnet deploy) | `packages/contracts/.env.example` → `.env`                 | `deploy-base-sepolia.sh` (Foundry)                                        |
| `packages/contracts` (mainnet deploy) | `packages/contracts/.env.mainnet.example` → `.env.mainnet` | `deploy-base-mainnet.sh` (Foundry, hardware-wallet signing)               |

None of these `.env*` files are committed — only the `.example` templates are.

---

## apps/server (the arbiter)

Source: `apps/server/.env.example`, cross-checked against `process.env.*` reads
in `apps/server/src/*.ts`.

### Core / required in production

| Variable              | Required                                                                                                         | Default                                                                                                                            | Description                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARBITER_PRIVATE_KEY` | **Required in production if escrow is active** (see fail-fast guard below)                                       | none                                                                                                                               | Private key of the arbiter wallet that signs match results (EIP-712) and pays gas for on-chain refunds/cancellations. Generate with `cast wallet new`. Read in `src/sign.ts`, `src/onchain.ts`, `src/demo-live.ts`.                                                                                                                    |
| `CHAIN_ID`            | **Required in production if escrow is active**                                                                   | `84532` (Base Sepolia)                                                                                                             | Chain ID used in the EIP-712 signing domain (`src/sign.ts`) and by `src/onchain.ts`. Local anvil = `31337`. Must match the deployed contract's chain or signatures become invalid for payouts.                                                                                                                                         |
| `ESCROW_ADDRESS`      | Optional, but its presence/non-zero value determines whether the server is considered "on-chain" (escrow active) | `0x0000...0000` (unset)                                                                                                            | Address of the deployed escrow contract. Read in `src/sign.ts`, `src/onchain.ts`, `src/demo-live.ts`, and used by `config-guard.ts` / `gas-monitor.ts` to decide whether production-only checks apply.                                                                                                                                 |
| `REQUIRE_AUTH`        | Optional                                                                                                         | Effectively `true` in production, `false` in dev                                                                                   | Whether score submissions and matchmaking require the player's wallet signature. `true` forces it in any environment; `false` disables it explicitly (not recommended with real money); unset means "required when `NODE_ENV=production`". Read in `src/matchmaking.ts` (exported as `AUTH_REQUIRED`).                                 |
| `ALLOWED_ORIGIN`      | **Required in production if escrow is active**                                                                   | `*` (open CORS)                                                                                                                    | Comma-separated list of allowed CORS origins (e.g. your domain + the Vercel preview domain during a transition). Read in `src/index.ts`.                                                                                                                                                                                               |
| `RPC_URL`             | **Required in production if escrow is active**                                                                   | none (`onchain.ts`/`onchain-e2e.ts` fall back to `http://localhost:8545`; `demo-live.ts` falls back to `https://sepolia.base.org`) | RPC endpoint used by the arbiter to cancel/refund matches on-chain (draws and expired matches) and by the gas monitor to check its own balance. Should be a dedicated provider (Alchemy/QuickNode), not a public endpoint, once real money is involved.                                                                                |
| `NODE_ENV`            | Optional (set by the hosting platform, e.g. Render)                                                              | none                                                                                                                               | Standard Node environment flag. `production` gates: enabling `REQUIRE_AUTH` by default, disabling the `/match/:id/bot` test endpoint, defaulting `TRUST_PROXY` to `1`, and enabling the fail-fast config guard and gas monitor default. Read across `src/index.ts`, `src/matchmaking.ts`, `src/config-guard.ts`, `src/gas-monitor.ts`. |
| `PORT`                | Optional                                                                                                         | `4000`                                                                                                                             | HTTP port the arbiter listens on. Read in `src/index.ts`.                                                                                                                                                                                                                                                                              |

### Fail-fast production config guard

`apps/server/src/config-guard.ts` exports `productionConfigErrors()`, called at
the top of `src/index.ts` before the Express app is created. If
`NODE_ENV=production` **and** `ESCROW_ADDRESS` is set to a non-zero address
(i.e. real on-chain money is in play), the server refuses to start
(`process.exit(1)`) unless all of the following are set:

- `CHAIN_ID` — otherwise the EIP-712 domain silently falls back to testnet
  (`84532`) and signatures would not validate on mainnet.
- `ARBITER_PRIVATE_KEY` — otherwise the arbiter cannot sign results at all.
- `ALLOWED_ORIGIN` — otherwise CORS would default to `*` (wide open).
- `RPC_URL` — otherwise the arbiter cannot cancel/refund draws or expired
  matches on-chain.

Without an active escrow (`ESCROW_ADDRESS` unset/zero — e.g. a pure off-chain
demo), none of these checks apply and the server starts normally regardless of
`NODE_ENV`.

### Reverse proxy / CORS / rate limiting

| Variable           | Required | Default                                    | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | -------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUST_PROXY`      | Optional | `1` in production, unset (disabled) in dev | Controls Express's `trust proxy` setting so `req.ip` reflects the real client IP behind a reverse proxy (Render, etc.) instead of the proxy's IP — otherwise rate limiting would group every client under one IP. Parsed by `parseTrustProxy()` in `config-guard.ts`: a bare integer = number of hops, `"true"`/`"false"` = always/never trust, a string containing `.`/`:` = a literal IP or CIDR subnet. An unrecognized value is ignored (safe default kept). |
| `RL_MAX`           | Optional | `120`                                      | Global rate limit: max requests per IP per 10-second window, any route. Read in `src/index.ts`.                                                                                                                                                                                                                                                                                                                                                                  |
| `RL_MAX_EXPENSIVE` | Optional | `12`                                       | Stricter rate limit (same 10s window) applied only to CPU-expensive endpoints (score verification re-simulates the whole replay; agent create/manage recovers a signature). Read in `src/index.ts`.                                                                                                                                                                                                                                                              |
| `ENABLE_TEST_BOT`  | Optional | `false`                                    | When `NODE_ENV=production`, the `/match/:id/bot` test endpoint (completes a match against a practice bot) is disabled unless this is explicitly set to `"true"`. Read in `src/index.ts`.                                                                                                                                                                                                                                                                         |

### Matchmaking / economics

| Variable           | Required | Default                | Description                                                                                                                                                                                                                                                                                                                           |
| ------------------ | -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FEE_BPS`          | Optional | `1500` (15%)           | Platform fee in basis points, used only to compute the net P&L reported to players (`GET /match/:id`). Must match the fee actually configured on the deployed contract (set at contract deploy time via `packages/contracts` `.env`/`.env.mainnet`) — the arbiter does not read the fee from the chain. Read in `src/matchmaking.ts`. |
| `STAKES_ALLOWED`   | Optional | `1,2,5,10`             | Comma-separated list of stake amounts (in USDC) the arbiter accepts for matchmaking. Must match the contract's `allowedStake` table. Read in `src/matchmaking.ts`.                                                                                                                                                                    |
| `SUBMIT_WINDOW_MS` | Optional | `7200000` (2 hours)    | Submission window for a score after a match starts, aligned with the on-chain `playDeadline`. Past this window, submissions are rejected (also stops unlimited offline practice against a known seed). Read in `src/matchmaking.ts`.                                                                                                  |
| `CHALLENGE_TTL_MS` | Optional | `1800000` (30 minutes) | How long a direct challenge to a hosted agent stays open before it expires unaccepted. Read in `src/matchmaking.ts` (exported as `CHALLENGE_TTL`).                                                                                                                                                                                    |

### Hosted agents

| Variable                   | Required | Default           | Description                                                                                                                                                            |
| -------------------------- | -------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_AGENTS_PER_OWNER`     | Optional | `3`               | Max hosted agents a single wallet can create. Read in `src/agents.ts`.                                                                                                 |
| `MAX_AGENTS_TOTAL`         | Optional | `200`             | Global cap on hosted agents across all owners. Read in `src/agents.ts`.                                                                                                |
| `HOUSE_WALLETS`            | Optional | none (empty)      | Comma-separated list of wallet addresses treated as "house" agent owners — exempt from `MAX_AGENTS_PER_OWNER` (not from the global cap). Read in `src/agents.ts`.      |
| `AGENTS_ENABLED`           | Optional | `true`            | Kill switch for the hosted-agent runner (the background loop that makes hosted agents play automatically). Set to `"false"` to disable. Read in `src/agent-runner.ts`. |
| `AGENT_RUNNER_TICK_MS`     | Optional | `30000` (30s)     | How often the agent runner checks for agents whose play cooldown has elapsed. Read in `src/agent-runner.ts`.                                                           |
| `AGENT_PLAY_INTERVAL_MS`   | Optional | `600000` (10 min) | Cooldown between plays for a single hosted agent. Read in `src/agent-runner.ts`.                                                                                       |
| `AGENT_MAX_PLAYS_PER_TICK` | Optional | `4`               | Max number of agent plays processed per runner tick. Read in `src/agent-runner.ts`.                                                                                    |
| `CHALLENGE_ABANDON_MS`     | Optional | `300000` (5 min)  | How long a hosted agent waits for a challenger to play before abandoning a direct-challenge match (anti game-denial). Read in `src/agent-runner.ts`.                   |

### Profiles and ratings caps

| Variable              | Required | Default | Description                                                                                                               |
| --------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `MAX_PROFILES`        | Optional | `5000`  | Cap on stored human profiles (name+avatar); least-recently-set is evicted beyond this. Read in `src/profiles.ts`.         |
| `MAX_RATED_ADDRESSES` | Optional | `5000`  | Cap on addresses tracked in the ELO rating store; least-recently-active is evicted beyond this. Read in `src/ratings.ts`. |

### Gas monitor (arbiter's own ETH balance)

The arbiter pays gas for automatic on-chain refunds (draws and expired
matches). `src/gas-monitor.ts` polls its own wallet balance and logs/alerts
when it drops below a threshold. Config is built by `gasMonitorConfig()`.

| Variable                | Required | Default                                                                                                                                                                                                 | Description                                                                                                                                                                                                                           |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GAS_MONITOR_ENABLED`   | Optional | Enabled by default when `NODE_ENV=production` **and** escrow is active; must be explicitly `"true"` to enable in dev. Must be exactly `"true"` or `"false"` if set (any other value throws at startup). | Overrides the automatic on/off decision.                                                                                                                                                                                              |
| `GAS_ALERT_ETH`         | Optional | `0.005`                                                                                                                                                                                                 | Threshold, in ETH, below which the monitor logs (and optionally webhooks) an alert. Must parse as a valid decimal ETH amount greater than 0, or startup throws.                                                                       |
| `GAS_CHECK_INTERVAL_MS` | Optional | `300000` (5 min)                                                                                                                                                                                        | How often the balance is checked. Must be an integer ≥ `60000` if set.                                                                                                                                                                |
| `GAS_ALERT_COOLDOWN_MS` | Optional | `21600000` (6 hours)                                                                                                                                                                                    | Minimum time between repeated alerts once the balance is low. Must be an integer ≥ `60000` if set.                                                                                                                                    |
| `GAS_ALERT_WEBHOOK_URL` | Optional | none                                                                                                                                                                                                    | Webhook URL (e.g. Slack/Discord incoming webhook) that receives a POST with the alert payload when the balance goes low. <!-- VERIFY: actual webhook URL/service in use, if any, is operator-specific and not present in the repo --> |

Note: `RPC_URL` is also required whenever the gas monitor is enabled (throws
`"Falta RPC_URL"` at startup otherwise) — this overlaps with the fail-fast
guard above but is enforced independently by `gasMonitorConfig()`.

Live status is exposed publicly (address, balance, threshold, last check —
never the private key) via `GET /stats` on the arbiter and the `/status` page
on the web frontend.

### Persistence (Redis vs local file)

Read in `apps/server/src/persist.ts`. The real server always enables
persistence (`src/persist-on.ts` sets `ARCADE_PERSIST=1` on import, and is
imported unconditionally by `src/index.ts`); it is opt-in only in tests, which
run without touching disk or network.

| Variable                                    | Required                                                                         | Default | Description                                                                                                                                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UPSTASH_REDIS_REST_URL`                    | Required for durable persistence on ephemeral-disk hosts (Render, Railway, etc.) | none    | Upstash Redis REST API base URL. Set together with `UPSTASH_REDIS_REST_TOKEN` to switch the backend from local file to Redis. Free tier at upstash.com. <!-- VERIFY: current Upstash free-tier limits/pricing --> |
| `UPSTASH_REDIS_REST_TOKEN`                  | Required for durable persistence (paired with the URL above)                     | none    | Upstash Redis REST API bearer token. Treat as a secret.                                                                                                                                                           |
| `ARCADE_PERSIST` / `ARCADE_PERSIST_MATCHES` | Internal — not meant to be set manually in normal operation                      | unset   | Either flag set to `"1"` enables persistence. Set automatically for the real server process by `src/persist-on.ts`; test suites leave both unset so tests don't touch real data.                                  |

Without Redis configured, persistence falls back to local JSON files under
`apps/server/data/` (atomic write via temp-file + rename). On hosts with an
ephemeral filesystem (Render, Railway, etc.), this means hosted agents, ELO
ratings, and in-progress matches are lost on every deploy/restart unless the
two Upstash variables are set. If Redis is configured but unreachable at
startup, the server intentionally fails to load (rather than silently
starting empty and overwriting good data on the next save).

### Internal / dev-only scripts (not part of the running server)

These are read by standalone one-off scripts in `apps/server/src/`, not by
`index.ts`, and are not documented in `.env.example`:

| Variable            | Used by              | Purpose                                                                                                      |
| ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ARBITER_URL`       | `src/agent.ts`       | Base URL a local test-agent script talks to (defaults to `http://localhost:4000`).                           |
| `MATCHID`, `WINNER` | `src/digestcheck.ts` | Inputs for a manual EIP-712 digest-checking script.                                                          |
| `USDC_ADDR`         | `src/onchain-e2e.ts` | USDC contract address for the on-chain E2E test script (distinct from the web's `NEXT_PUBLIC_USDC_ADDRESS`). |

---

## apps/web (the frontend)

Source: `apps/web/.env.local.example`, cross-checked against
`process.env.NEXT_PUBLIC_*` and `process.env.NODE_ENV` reads under
`apps/web/app/`. `NEXT_PUBLIC_*` variables are inlined at build time by
Next.js and end up visible in client-side JS — never put a secret behind this
prefix.

| Variable                     | Required                                                        | Default                                                                                                                              | Description                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_WC_PROJECT_ID`  | Recommended in production (a shared fallback project ID exists) | Falls back to a shared/demo project ID hardcoded in `app/lib/wagmi.ts`                                                               | WalletConnect/Reown project ID (create your own free one at cloud.reown.com) — needed to connect mobile wallets via QR.                                                                                                                                                                                                                                                    |
| `NEXT_PUBLIC_ARBITER_URL`    | Required in production (defaults to localhost otherwise)        | `http://localhost:4000`                                                                                                              | Base URL of the arbiter backend. Read in `app/lib/arbiter.ts` and `app/agents/page.tsx`.                                                                                                                                                                                                                                                                                   |
| `NEXT_PUBLIC_SITE_URL`       | Optional                                                        | `https://arcade1v1.com` (hardcoded fallback in `app/lib/seo.ts`; the `.env.local.example` template suggests `https://arcade1v1.app`) | Public site domain used for SEO (sitemap, canonical URLs, Open Graph).                                                                                                                                                                                                                                                                                                     |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | Required once escrow deposits are live                          | undefined (escrow features stay disabled)                                                                                            | Deployed escrow contract address. Read in `app/lib/escrow.ts`.                                                                                                                                                                                                                                                                                                             |
| `NEXT_PUBLIC_USDC_ADDRESS`   | Required once escrow deposits are live                          | undefined                                                                                                                            | Deployed (test or real) USDC token address. Read in `app/lib/escrow.ts`.                                                                                                                                                                                                                                                                                                   |
| `NEXT_PUBLIC_RPC_URL`        | Recommended in production                                       | undefined (falls back to the network's public RPC via wagmi/viem defaults)                                                           | Own RPC endpoint (Alchemy/QuickNode/etc.), read in `app/lib/wagmi.ts`. Should point at the same provider/network as the arbiter's `RPC_URL`.                                                                                                                                                                                                                               |
| `NEXT_PUBLIC_CHAIN_ID`       | Optional                                                        | Testnet (Base Sepolia) unless set to `"8453"`                                                                                        | Selects the active network: `"8453"` switches the app into Base **mainnet** mode (real money); any other value (including unset) keeps it on testnet. Read in `app/lib/wagmi.ts` and `app/lib/config.ts` (`IS_MAINNET`). **Not present in `apps/web/.env.local.example`** — must be set manually when going live.                                                          |
| `BLOCKED_COUNTRIES`          | Optional                                                        | empty (no blocking)                                                                                                                  | Comma-separated list of country codes to geoblock via `apps/web/proxy.ts` (Next.js middleware); matched requests are routed to `/unavailable`. Server-side only (no `NEXT_PUBLIC_` prefix — not exposed to the client bundle). **Not present in `apps/web/.env.local.example`** — must be set manually before accepting real money in jurisdictions requiring geoblocking. |

Other web behavior gated by environment, without a dedicated variable:

- `NODE_ENV !== "production"` enables a simulated-opponent "dev mode" on the
  match page (`app/game/[gameId]/match/page.tsx`) — standard Next.js/Node
  behavior, not something to set manually alongside the vars above.

---

## packages/contracts (Base Sepolia testnet deploy)

Source: `packages/contracts/.env.example`, used only by
`deploy-base-sepolia.sh` at deploy time (not read by any long-running
process).

| Variable               | Required                                            | Default                             | Description                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_SEPOLIA_RPC_URL` | Optional                                            | `https://sepolia.base.org`          | RPC node used to deploy to Base Sepolia.                                                                                                                                                |
| `PRIVATE_KEY`          | **Required** (no default — deploy fails without it) | none                                | Private key of the throwaway deploy wallet. Testnet only; still treat as a secret.                                                                                                      |
| `USDC_ADDRESS`         | **Required**                                        | none                                | Address of the test USDC token (the deploy script also has a path that deploys a fresh mintable test USDC — see `DEPLOY.md`).                                                           |
| `ARBITER_ADDRESS`      | **Required**                                        | none                                | Address of the arbiter account that will be authorized to sign results on the escrow contract. Must match the address derived from the arbiter's `ARBITER_PRIVATE_KEY` (`apps/server`). |
| `PLATFORM_WALLET`      | **Required**                                        | none                                | Wallet that receives the platform fee.                                                                                                                                                  |
| `FEE_BPS`              | **Required**                                        | `1500` in the template (1500 = 15%) | Platform fee in basis points at deploy time. Hard cap enforced by the contract: `2000` (20%). Must match the arbiter's `FEE_BPS` for the P&L shown to players to be accurate.           |

## packages/contracts (Base mainnet deploy — real money)

Source: `packages/contracts/.env.mainnet.example`, used only by
`deploy-base-mainnet.sh`. No private key is stored here by design — mainnet
deploys sign with a hardware wallet (Ledger/Trezor) or keystore passed to
`forge` via `--ledger`/`--account`.

| Variable               | Required     | Default                                                                                                               | Description                                                                                                                                                                             |
| ---------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_MAINNET_RPC_URL` | Optional     | `https://mainnet.base.org`                                                                                            | RPC node used to deploy to Base mainnet.                                                                                                                                                |
| `USDC_ADDRESS`         | **Required** | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Base's real Circle USDC, pre-filled in the template, verified on-chain) | Real USDC token address; the deploy script verifies this against the chain before proceeding.                                                                                           |
| `ARBITER_ADDRESS`      | **Required** | none                                                                                                                  | Same role as the testnet variable, but its private key must be held in a KMS/HSM or the hosting platform's secret store — never in plaintext in the repo.                               |
| `PLATFORM_WALLET`      | **Required** | none                                                                                                                  | Wallet that receives the platform fee on mainnet.                                                                                                                                       |
| `FEE_BPS`              | **Required** | `1500` in the template (15%)                                                                                          | Same semantics as testnet; contract hard cap `2000` (20%). Must match `apps/server`'s `FEE_BPS`.                                                                                        |
| `OWNER_ADDRESS`        | **Required** | none                                                                                                                  | Secure wallet (hardware/eventually a Safe multisig) that deploys and becomes the contract owner. Must be the same address that signs the deploy (`forge`'s `--sender` with `--ledger`). |

---

## Cross-cutting invariants to keep in sync

These values are configured independently in up to three places and must
match for the system to work correctly (see `DEPLOY.md` for the full deploy
walkthrough):

- `FEE_BPS` — same value in `packages/contracts` deploy env, `apps/server`
  (`FEE_BPS`), and hardcoded in the web's `app/lib/config.ts`
  (`PLATFORM_FEE = 0.15`).
- `CHAIN_ID` (arbiter) / `NEXT_PUBLIC_CHAIN_ID` (web) — must both point at the
  same network as the deployed contract.
- `ESCROW_ADDRESS` (arbiter) / `NEXT_PUBLIC_ESCROW_ADDRESS` (web) — same
  deployed escrow contract.
- `ARBITER_ADDRESS` (set at contract deploy time) must match the address
  derived from `ARBITER_PRIVATE_KEY` (arbiter runtime) — `GET /arbiter` on the
  arbiter exposes its derived address for cross-checking.
- `STAKES_ALLOWED` (arbiter) must be a subset of the contract's allowed
  stakes.

<!-- VERIFY: any production values actually set today in Vercel (apps/web) and Render (apps/server) dashboards — not discoverable from the repository. -->
