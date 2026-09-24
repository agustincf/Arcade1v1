<!-- generated-by: gsd-doc-writer -->

# Contributing to Arcade1v1

Thanks for your interest in improving Arcade1v1. This project handles real
(currently testnet) money flows, so the bar for any change is simple: **what
happens to the end user** — the player who staked money, the agent owner, the
opponent waiting on the other side. See [STANDARDS.md](STANDARDS.md) for the
full rulebook (written in Spanish, the project's working language); the
summary below covers what you need to open a PR.

## Proposing a change

There are no issue or pull request templates in this repository yet
(`.github/` only contains the CI and keep-alive workflows), so use plain
GitHub issues and PRs:

1. **Open an issue first** for anything beyond a trivial fix — describe the
   problem from the end user's point of view (what they see, what they
   expected) before proposing a solution.
2. **Fork and branch** from `main` for your change.
3. **Open a pull request** against `main` with a description of what changed
   and why. Small, focused PRs are easier to review than large ones.
4. **Wait for CI** (see below) and for a maintainer review before merging.
   `main` does not accept direct pushes: every change lands through a PR with
   both CI checks green, and a merge to `main` deploys to production.

## Coding standards

The full rules live in [STANDARDS.md](STANDARDS.md) (Spanish). The
non-negotiable core, in English:

- **The end user comes first.** No dead ends: every fetch has a timeout,
  every long wait has a message, every error has a retry, and a paid attempt
  is never silently lost. Error messages must tell the truth (e.g. "you
  cancelled the signature", not a generic "server error").
- **Default-deny.** The arbiter (backend) never trusts the client: unknown
  games, unverifiable scores, or mismatched seeds are rejected outright.
- **One code path.** Hosted agents, humans, and external agents all go
  through the same functions (matchmake/submitScore) with the same rules —
  no internal shortcuts that skip validation.
- **Secure by default.** Signed auth is required in production, a startup
  guard blocks misconfigured deploys, and agent private keys never appear in
  an API response.
- **Everything that grows gets pruned.** Any in-memory Map/store needs a cap,
  TTL, or sweeper.
- **Determinism in games.** Same seed → same match. Game engines never use
  `Math.random()` or clocks, only the seed the arbiter generates. Live games
  (Flappy since rules v2) keep the determinism but not the seed up front: the
  randomness comes from a secret the arbiter reveals as the player commits
  moves, and the same secret plus the same moves give the same run.

Other conventions worth knowing before you write code: UI text always goes
through i18n (`t("key")`, never hardcoded strings), addresses are normalized
to lowercase before comparison, USDC amounts use 6-decimal integer math
(never floats), and any new env-driven setting needs a sane default
documented in the relevant `.env.example`. See STANDARDS.md for the complete,
current list.

## Before submitting a PR

Run the full verification suite locally — this is the same command CI runs:

```bash
npm run check
```

This runs, in order: TypeScript typecheck (`web`, `server`, `mcp`, and all
packages), ESLint, Prettier format check, the `node:test` suite
(`packages/*/test`, `apps/*/test`), and the arbiter selftest. All of it must
pass.

You can also run pieces individually:

```bash
npm run typecheck   # tsc --noEmit across all workspaces
npm run lint        # ESLint (flat config, project root)
npm run format:check # Prettier check (use `npm run format` to auto-fix)
npm test            # node:test suite
npm run selftest     # arbiter self-check (matchmaking + signing + anti-cheat)
```

If your change touches the smart contract in `packages/contracts`, it also
needs `forge test` to pass (Foundry) — see how CI runs it below.

**Any fix touching security or money must include a test** that reproduces
the attack or bug. Look at `apps/server/test/*` for the pattern: they spin up
the real router and fire signed requests against it.

**Every change updates the documentation in the same PR** — not in a later
pass. At minimum, add an entry under `[Sin publicar]` in `CHANGELOG.md`; if the
change affects agents (API, SDKs, MCP, rules), also update `AGENTS.md`,
`apps/web/public/llms.txt` and the affected package README; if it changes
architecture, env vars, deploy or tests, update the matching file in `docs/`.
The full checklist, including how a version is cut and released, is in
[STANDARDS.md](STANDARDS.md) ("Flujo de trabajo").

## Continuous integration

The CI workflow is
[`.github/workflows/ci.yml`](.github/workflows/ci.yml), triggered on every
push to `main` and every pull request. It runs two jobs:

- **`web-and-server`** — installs dependencies with `npm ci`, runs
  `npm run check` (the same command described above), then builds the web
  for production (`npm run build --workspace apps/web`), which `check` does
  not cover.
- **`contracts`** — fetches pinned Foundry libraries, installs Foundry pinned
  to v1.8.3, runs `forge test` against the contracts in
  `packages/contracts`, then runs the local-chain (anvil) end-to-end checks:
  arbiter/contract EIP-712 digest integration, a full 1v1 payout flow, a
  deploy rehearsal for each escrow, and a full Aleph money-table payout.

The other workflow, `keep-alive.yml`, only pings the public arbiter's
`/health` every ~10 minutes so the free Render instance does not sleep. There
is no separate linting or deploy workflow — `npm run check` plus the web
build is what decides whether a change is mergeable.

## Commit messages

The project uses Conventional-Commits-style prefixes with descriptions in
Spanish (the working language used throughout the codebase's history):

```
tipo(ámbito): descripción en castellano
```

For example: `fix(server): …`, `feat(web): …`, `docs: …`, `test(strategies):
…`, `chore: …`. Match this pattern for consistency with the existing git
history, even if your surrounding conversation or PR description is in
English.

## License

Arcade1v1 is licensed under the [MIT License](LICENSE). By contributing, you
agree that your contributions will be licensed under the same terms.
