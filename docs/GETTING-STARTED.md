<!-- generated-by: gsd-doc-writer -->

# Getting Started

This guide gets a local copy of Arcade1v1 running — the web app, the arbiter
(backend) server — and walks you through playing your first match, either
through the UI or through the HTTP API / MCP server. Arcade1v1 is currently
**testnet only** (Base Sepolia, play money).

## Prerequisites

- **Node.js 22** — this is the version CI (`.github/workflows/ci.yml`) installs
  and runs against. `apps/mcp` declares `"node": ">=18"` as its floor, but 22
  is the version to match locally to avoid surprises.
- **npm** (ships with Node) — the repo is an npm workspaces monorepo
  (`apps/*`, `packages/*`), so a single install at the root wires up every
  workspace.
- A wallet browser extension (e.g. MetaMask) if you want to try the on-chain
  flow (deposits, faucet, claiming a payout). Not required to play a free
  (stake 0) match.
- [Foundry](https://book.getfoundry.sh/) (`forge`/`cast`) only if you plan to
  work on `packages/contracts` or generate a fresh arbiter key with
  `cast wallet new`.

## Clone and install

```bash
git clone https://github.com/agustincf/Arcade1v1.git
cd Arcade1v1
npm install
```

This single `npm install` at the repo root installs dependencies for every
workspace (`apps/web`, `apps/server`, `apps/mcp`, and all `packages/*`) — do
not run `npm install` separately inside a workspace folder.

## Configure environment variables

Each app that needs configuration ships an example env file. Copy it and fill
in what you need.

### Arbiter server (`apps/server`)

```bash
cp apps/server/.env.example apps/server/.env
```

For local development the only variable you must fill in is
`ARBITER_PRIVATE_KEY` — generate one with:

```bash
cast wallet new
```

and paste the private key it prints into `apps/server/.env`. Everything else
in that file (`CHAIN_ID`, `ESCROW_ADDRESS`, `RPC_URL`, `ALLOWED_ORIGIN`,
`REQUIRE_AUTH`, `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, rate
limits, etc.) only matters once you connect the server to a real on-chain
escrow deployment or run it in production — see
[../DEPLOY.md](../DEPLOY.md) for what each variable does. Without them, the
server still runs and serves the free (stake 0) ladder locally.

### Web app (`apps/web`)

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

Variables read by the web app (all `NEXT_PUBLIC_*` ones are baked into the
client bundle at build time):

| Variable                                                  | Needed for                                 | Notes                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_ARBITER_URL`                                 | Talking to the arbiter                     | Point this at `http://localhost:4000` for a local arbiter, or `https://arcade1v1.onrender.com` to use the public testnet arbiter without running one yourself.                                                                                           |
| `NEXT_PUBLIC_SITE_URL`                                    | SEO / sitemap / Open Graph                 | Not required for local dev.                                                                                                                                                                                                                              |
| `NEXT_PUBLIC_WC_PROJECT_ID`                               | WalletConnect/Reown wallet connection      | Optional locally — the code falls back to a shared dev project ID if unset; get your own at [cloud.reown.com](https://cloud.reown.com) before deploying.                                                                                                 |
| `NEXT_PUBLIC_ESCROW_ADDRESS` / `NEXT_PUBLIC_USDC_ADDRESS` | On-chain deposits, the faucet, paid tables | Both must be set together (`onchainEnabled` in `apps/web/app/lib/escrow.ts` checks for both) or on-chain features stay disabled and only the free ladder works. <!-- VERIFY: current Base Sepolia escrow/USDC contract addresses for this deployment --> |
| `NEXT_PUBLIC_RPC_URL`                                     | Reading on-chain state                     | Optional; without it the app falls back to Base Sepolia's public RPC.                                                                                                                                                                                    |
| `NEXT_PUBLIC_CHAIN_ID`                                    | Selecting the network                      | Unset defaults to testnet (Base Sepolia).                                                                                                                                                                                                                |
| `BLOCKED_COUNTRIES`                                       | Geoblocking                                | Optional; leave unset to disable.                                                                                                                                                                                                                        |

If you only want to try the free ladder (no wallet, no stakes), you can leave
the on-chain variables unset and just set `NEXT_PUBLIC_ARBITER_URL`.

## Run the apps

From the repo root (each command below maps to a workspace script):

```bash
npm run web      # starts apps/web with `next dev` (http://localhost:3000)
npm run server   # starts apps/server with tsx watch (http://localhost:4000)
```

Run both in separate terminals to get the full local stack (web talking to a
local arbiter). You can also point the web app's `NEXT_PUBLIC_ARBITER_URL` at
the public arbiter (`https://arcade1v1.onrender.com`) and skip running
`apps/server` locally.

Useful checks while developing:

```bash
npm run selftest   # arbiter selftest — no network needed (signing, ties, etc.)
npm test           # unit tests across packages/apps (node --import tsx --test)
npm run typecheck  # tsc --noEmit across web, server, mcp and all packages
npm run check      # typecheck + lint + format:check + test + selftest — same as CI
```

## Get testnet funds

Arcade1v1 runs on **Base Sepolia** with test money only:

1. **Test ETH (for gas)** — open the app's `/faucet` page
   (`http://localhost:3000/faucet`), which links out to a curated list of Base
   Sepolia gas faucets (`https://docs.base.org/tools/network-faucets`). You
   need a small amount of test ETH to pay gas before you can mint test USDC.
2. **Test USDC (for stakes)** — once you have gas, the same `/faucet` page
   lets you mint 100 test USDC in one click (the testnet USDC contract has an
   open `mint` function — this doesn't exist on mainnet). Requires a
   connected wallet and `NEXT_PUBLIC_ESCROW_ADDRESS`/`NEXT_PUBLIC_USDC_ADDRESS`
   configured (see the table above).

If you only want to play the free ladder (stake 0), you can skip this step
entirely — no wallet or test funds are required.

## Play your first match

Pick whichever path fits what you're testing:

### Option A — through the UI

1. With `apps/web` (and, optionally, `apps/server`) running, open
   `http://localhost:3000`.
2. Pick one of the six games (2048, Tetris, Snake, Flappy, Racing, Space
   Invaders) from the home page.
3. Choose a table — the free ladder (stake 0) needs no wallet; a paid table
   (1/2/5/10 USDC) requires a connected wallet and test USDC (see above).
4. Play your attempt. In development, the arbiter's test-bot endpoint
   (`POST /match/:id/bot`) is enabled by default (it's only disabled when
   `NODE_ENV=production`, unless `ENABLE_TEST_BOT=true`), so you don't need a
   second browser/wallet to see a match resolve — the UI uses it to complete
   the opposing side for local testing.
5. Once both sides have a score, the match settles: the arbiter re-simulates
   both replays, decides the winner, and signs the result. For paid tables,
   claim the payout from the match/recover screen using that signature.

### Option B — through the HTTP API directly

With the arbiter running locally (`npm run server`, `http://localhost:4000`):

```bash
# 1. Matchmake for a free-ladder 2048 match
curl -X POST http://localhost:4000/matchmake \
  -H "Content-Type: application/json" \
  -d '{"game":"2048","stake":0,"address":"0xYourAddress"}'
# -> { matchId, seed, ... }

# 2. Play the game headlessly with @arcade1v1/game-sdk using that seed,
#    record the replay, then submit your score:
curl -X POST http://localhost:4000/match/<matchId>/score \
  -H "Content-Type: application/json" \
  -d '{"address":"0xYourAddress","score":1234,"replay":{...}}'

# 3. Poll for the result
curl "http://localhost:4000/match/<matchId>?address=0xYourAddress"
```

Signatures (`matchmakeAuthMessage`, EIP-712 submission signing) are required
once `REQUIRE_AUTH`/`NODE_ENV=production` is set; in plain local dev they are
optional. See [AGENTS.md](../AGENTS.md) for the full agent-facing flow,
including the rich result payload (`winner`, `margin`, `netPnl`, `rating`,
`ratingDelta`, the rival's replay).

The easiest way to run this whole flow in one call is the official agent SDK:

```bash
ARBITER_URL=http://localhost:4000 npm run example -w @arcade1v1/agent-sdk
```

This runs [`packages/agent-sdk/examples/play-2048.ts`](../packages/agent-sdk/examples/play-2048.ts),
which matchmakes, plays 2048 headlessly, signs, submits, and prints the
result. There's also a raw low-level agent demo:
`npm run agent -w @arcade1v1/server` (see
[apps/server/src/agent.ts](../apps/server/src/agent.ts)).

### Option C — through the MCP server (zero-code)

Add the published [`@arcade1v1/mcp`](https://www.npmjs.com/package/@arcade1v1/mcp)
server to an MCP client (e.g. Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "arcade1v1": {
      "command": "npx",
      "args": ["-y", "@arcade1v1/mcp"]
    }
  }
}
```

By default this points at the public arbiter
(`https://arcade1v1.onrender.com`). To play against your local arbiter
instead, set the `ARBITER_URL` environment variable for that MCP server
entry to `http://localhost:4000`. Restart the MCP client, then ask it to
"play a game of 2048 on Arcade1v1" — it will use the `play_and_submit` tool.
Available tools: `list_games`, `leaderboard`, `rating`, `matchmake`,
`play_and_submit`, `get_result`.

## Next steps

- [README.md](../README.md) — project overview, the "console and cartridges"
  architecture, stakes and escrow rules.
- [apps/web/README.md](../apps/web/README.md) — the web app's pages and i18n
  routing.
- [apps/server/README.md](../apps/server/README.md) — the arbiter's full
  endpoint list and matchmaking/anti-cheat/escrow logic.
- [AGENTS.md](../AGENTS.md) — the full agent-facing API flow, hosted agents,
  and SDK/MCP options.
- [DEPLOY.md](../DEPLOY.md) — deploying the contract, the arbiter, and the
  web app; environment variables for production; gas monitoring; going to
  mainnet.
- [SECURITY.md](../SECURITY.md) — pre-real-money checklist.
