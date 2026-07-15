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
(`.github/` only contains the CI workflow), so use plain GitHub issues and
PRs:

1. **Open an issue first** for anything beyond a trivial fix — describe the
   problem from the end user's point of view (what they see, what they
   expected) before proposing a solution.
2. **Fork and branch** from `main` for your change.
3. **Open a pull request** against `main` with a description of what changed
   and why. Small, focused PRs are easier to review than large ones.
4. **Wait for CI** (see below) and for a maintainer review before merging.

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
  `Math.random()` or clocks, only the seed the arbiter generates.

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

## Continuous integration

This repository has one GitHub Actions workflow,
[`.github/workflows/ci.yml`](.github/workflows/ci.yml), triggered on every
push to `main` and every pull request. It runs two jobs:

- **`web-and-server`** — installs dependencies with `npm ci` and runs
  `npm run check` (the same command described above).
- **`contracts`** — fetches Foundry libraries, runs `forge test` against the
  smart contract in `packages/contracts`, then runs the local-chain (anvil)
  end-to-end checks: arbiter/contract EIP-712 digest integration, a full
  payout flow, and a deploy rehearsal.

There is no separate linting or deploy workflow — `npm run check` is the
single source of truth for whether a change is mergeable.

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
